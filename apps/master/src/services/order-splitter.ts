import type { CreateOrderPayload, JobPayload } from '@app/shared';
import { createLogger } from '@app/shared';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { jobs, orders, profiles } from '../db/schema.js';
import { liveViewQueue } from '../queue.js';

const log = createLogger('order-splitter');

export interface DispatchResult {
  orderId: number;
  jobIds: number[];
  leasedProfiles: number;
  shortage: number;
}

/**
 * Tạo order + N sub-job, lease N profile khả dụng, push lên BullMQ.
 *
 * Lease dùng `SELECT ... FOR UPDATE SKIP LOCKED` trong transaction
 * → an toàn khi có nhiều API request tạo order cùng lúc.
 */
export async function createOrderAndDispatch(
  payload: CreateOrderPayload,
): Promise<DispatchResult> {
  const { orderId, jobRows, shortage } = await db.transaction(async (tx) => {
    // 1. Lease N profile available, lock SKIP LOCKED để concurrent calls không đụng nhau
    const candidates = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.status, 'available'))
      .orderBy(profiles.lastUsedAt)
      .limit(payload.count)
      .for('update', { skipLocked: true });

    if (candidates.length === 0) {
      throw new Error('Không có profile khả dụng. Sync profile từ GPM trước.');
    }

    const ids = candidates.map((c) => c.id);
    const shortage = Math.max(0, payload.count - ids.length);

    // 2. Đánh dấu in_use cho đúng các profile đã lease
    await tx
      .update(profiles)
      .set({ status: 'in_use', lastUsedAt: new Date() })
      .where(inArray(profiles.id, ids));

    // 3. Insert order
    const [order] = await tx
      .insert(orders)
      .values({
        type: payload.type,
        targetUrl: payload.targetUrl,
        count: payload.count,
        watchSeconds: payload.watchSeconds,
        spreadSeconds: payload.spreadSeconds ?? 0,
        status: 'queued',
      })
      .returning({ id: orders.id });
    if (!order) throw new Error('Failed to insert order');

    // 4. Insert sub-jobs
    const jobRows = await tx
      .insert(jobs)
      .values(
        ids.map((pid) => ({
          orderId: order.id,
          profileId: pid,
          status: 'pending' as const,
        })),
      )
      .returning({ id: jobs.id, profileId: jobs.profileId });

    return { orderId: order.id, jobRows, shortage };
  });

  // 5. Push BullMQ NGOÀI transaction (BullMQ ack không rollback DB được)
  const spreadMs = (payload.spreadSeconds ?? 0) * 1000;
  const last = Math.max(jobRows.length - 1, 1);
  const bullJobs = jobRows.map((r, i) => ({
    name: `live_view_${r.id}`,
    data: {
      jobId: r.id,
      orderId,
      type: payload.type,
      accountId: 0,
      profileId: r.profileId,
      targetUrl: payload.targetUrl,
      watchSeconds: payload.watchSeconds,
      attempt: 0,
    } satisfies JobPayload,
    opts: spreadMs > 0 ? { delay: Math.floor((spreadMs * i) / last) } : undefined,
  }));

  await liveViewQueue.addBulk(bullJobs);

  log.info(
    { orderId, jobs: jobRows.length, shortage },
    'Order dispatched',
  );

  return {
    orderId,
    jobIds: jobRows.map((r) => r.id),
    leasedProfiles: jobRows.length,
    shortage,
  };
}
