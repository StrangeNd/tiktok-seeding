import { loadEnv } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { sql } from '../db/client.js';
import { queueConnection } from '../queue.js';

const env = loadEnv();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    ok: true,
    ts: new Date().toISOString(),
    gpmMode: env.GPM_MODE,
    version: '0.1.0',
  }));

  app.get('/health/deep', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {};

    try {
      await sql`select 1`;
      checks.postgres = { ok: true };
    } catch (e) {
      checks.postgres = { ok: false, error: (e as Error).message };
    }

    try {
      const pong = await queueConnection.ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (e) {
      checks.redis = { ok: false, error: (e as Error).message };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    return reply.code(allOk ? 200 : 503).send({
      ok: allOk,
      gpmMode: env.GPM_MODE,
      version: '0.1.0',
      checks,
    });
  });
}
