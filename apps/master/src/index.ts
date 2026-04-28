import { createLogger, loadEnv } from '@app/shared';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { closeDb } from './db/client.js';
import { closeQueues } from './queue.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { orderRoutes } from './routes/orders.js';
import { workerRoutes } from './routes/workers.js';
import { resetStuckProfiles } from './services/recovery.js';

const env = loadEnv();
const log = createLogger('master');

const app = Fastify({
  loggerInstance: log,
  bodyLimit: 1024 * 1024, // 1 MB
  disableRequestLogging: env.NODE_ENV === 'production',
});

// Sensible defaults: app.httpErrors helpers, ETag, etc.
await app.register(sensible);

// Simple API key middleware (Phase 1 single-key)
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0] ?? '';
  if (path === '/health' || path === '/health/deep') return;
  const key = req.headers['x-api-key'];
  if (key !== env.MASTER_API_KEY) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});

await app.register(healthRoutes);
await app.register(orderRoutes);
await app.register(workerRoutes);
await app.register(jobRoutes);

// Graceful shutdown
async function shutdown(signal: string) {
  log.info({ signal }, 'Shutting down...');
  try {
    await app.close();
    await closeQueues();
    await closeDb();
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'Shutdown error');
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  // Recover stuck `in_use` profiles from a previous crash before accepting traffic.
  // Safe even if a worker is mid-job: only releases profiles whose linked jobs are
  // ALL in terminal state (succeeded/failed/cancelled), never an active one.
  try {
    const recovered = await resetStuckProfiles();
    if (recovered.released > 0) {
      log.warn(
        { released: recovered.released },
        'Startup recovery: released stuck in_use profiles',
      );
    }
  } catch (err) {
    log.error({ err }, 'Startup recovery failed (continuing anyway)');
  }

  await app.listen({ port: env.MASTER_PORT, host: '0.0.0.0' });
  log.info(`✓ Master API listening on :${env.MASTER_PORT}`);
} catch (err) {
  log.error({ err }, 'Listen failed');
  process.exit(1);
}
