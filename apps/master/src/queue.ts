import type { JobPayload } from '@app/shared';
import { loadEnv } from '@app/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const env = loadEnv();

/**
 * Connection riêng cho BullMQ — KHÔNG share với app code khác để tránh blocking commands.
 * `maxRetriesPerRequest: null` là yêu cầu của BullMQ.
 */
export const queueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const QUEUE_NAMES = {
  liveView: 'live_view',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Producer queue cho live_view job.
 * Worker sẽ create Worker(QUEUE_NAMES.liveView, ...) để consume.
 */
export const liveViewQueue = new Queue<JobPayload>(QUEUE_NAMES.liveView, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 1_000, age: 24 * 3600 },
    removeOnFail: { count: 5_000, age: 7 * 24 * 3600 },
  },
});

export async function closeQueues(): Promise<void> {
  await liveViewQueue.close();
  await queueConnection.quit();
}
