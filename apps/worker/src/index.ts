import { type JobPayload, createLogger, loadEnv } from '@app/shared';
import { Worker as BullWorker, type Job as BullJob } from 'bullmq';
import { Redis } from 'ioredis';
import { runLiveViewJob } from './job-runner.js';
import { reportJobFinish, reportJobStart, sendHeartbeat } from './master-client.js';

const env = loadEnv();
const log = createLogger(`worker:${env.WORKER_NAME}`);

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

let activeJobs = 0;
const VERSION = '0.1.0';

const bullWorker = new BullWorker<JobPayload>(
  'live_view',
  async (job: BullJob<JobPayload>) => {
    activeJobs += 1;
    const attempt = job.attemptsMade;
    const maxAttempts = job.opts.attempts ?? 1;
    log.info(
      { jobId: job.data.jobId, profileId: job.data.profileId, attempt },
      'Job started',
    );
    await reportJobStart({
      jobId: job.data.jobId,
      workerName: env.WORKER_NAME,
      attempt,
    }).catch((err) => log.warn({ err }, 'reportJobStart failed (non-fatal)'));

    try {
      const result = await runLiveViewJob({ ...job.data, attempt });
      const willRetry = !result.ok && attempt + 1 < maxAttempts;
      await reportJobFinish({
        jobId: job.data.jobId,
        workerName: env.WORKER_NAME,
        attempt,
        ok: result.ok,
        durationMs: result.durationMs,
        errorCode: result.errorCode,
        errorMessage: result.error,
        willRetry,
      }).catch((err) => log.warn({ err }, 'reportJobFinish failed (non-fatal)'));

      if (!result.ok) {
        // Throw để BullMQ retry theo attempts policy
        const err = new Error(result.error ?? 'job_failed');
        (err as Error & { code?: string }).code = result.errorCode;
        throw err;
      }
      log.info(
        { jobId: job.data.jobId, durationMs: result.durationMs, notes: result.notes },
        'Job done',
      );
      return result;
    } finally {
      activeJobs -= 1;
    }
  },
  {
    connection,
    concurrency: env.CONCURRENCY,
    autorun: true,
  },
);

bullWorker.on('failed', (job, err) => {
  log.warn(
    { jobId: job?.data.jobId, attempts: job?.attemptsMade, err: err.message },
    'Job failed',
  );
});

bullWorker.on('error', (err) => {
  log.error({ err }, 'Worker internal error');
});

// Heartbeat loop: report mỗi 20s
const heartbeatInterval = setInterval(() => {
  void sendHeartbeat({
    name: env.WORKER_NAME,
    capacity: env.CONCURRENCY,
    currentLoad: activeJobs,
    version: VERSION,
  }).catch((err) => log.warn({ err }, 'heartbeat failed'));
}, 20_000);

// Initial heartbeat
void sendHeartbeat({
  name: env.WORKER_NAME,
  capacity: env.CONCURRENCY,
  currentLoad: 0,
  version: VERSION,
}).catch((err) => log.warn({ err }, 'initial heartbeat failed'));

log.info(
  { name: env.WORKER_NAME, concurrency: env.CONCURRENCY, gpm: env.GPM_ENDPOINT },
  '✓ Worker started',
);

// Graceful shutdown
async function shutdown(signal: string) {
  log.info({ signal }, 'Shutting down worker...');
  clearInterval(heartbeatInterval);
  try {
    await bullWorker.close();
    await connection.quit();
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'Shutdown error');
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
