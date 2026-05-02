import { and, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { jobs, orders, profiles } from '../db/schema.js';

// (route-level) recent jobs list for dashboard activity view

const startSchema = z.object({
  jobId: z.number().int().positive(),
  workerName: z.string().min(1),
  attempt: z.number().int().min(0),
});

const finishSchema = z.object({
  jobId: z.number().int().positive(),
  workerName: z.string().min(1),
  attempt: z.number().int().min(0),
  ok: z.boolean(),
  durationMs: z.number().int().min(0).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  /** True nếu BullMQ sẽ retry job này (attempt < maxAttempts). */
  willRetry: z.boolean().default(false),
});

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  // Worker báo job bắt đầu chạy
  app.post('/jobs/start', async (req, reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { jobId, workerName, attempt } = parsed.data;
    await db
      .update(jobs)
      .set({
        status: 'running',
        attempt,
        workerName,
        startedAt: drizzleSql`now()`,
      })
      .where(eq(jobs.id, jobId));

    // Cũng đánh dấu order = running nếu chưa
    await db
      .update(orders)
      .set({ status: 'running', startedAt: drizzleSql`now()` })
      .where(
        and(
          eq(orders.id, drizzleSql<number>`(select order_id from jobs where id = ${jobId})`),
          eq(orders.status, 'queued'),
        ),
      );

    return { ok: true };
  });

  // Worker báo job kết thúc (thành công hoặc thất bại final)
  app.post('/jobs/finish', async (req, reply) => {
    const parsed = finishSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { jobId, ok, durationMs, errorCode, errorMessage, willRetry } = parsed.data;

    // Tra cứu order_id và profile_id để update tổng + giải phóng profile
    const [job] = await db
      .select({ orderId: jobs.orderId, profileId: jobs.profileId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const status = ok ? 'succeeded' : willRetry ? 'retrying' : 'failed';

    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({
          status,
          durationMs: durationMs ?? null,
          errorCode: errorCode ?? null,
          errorMessage: errorMessage ?? null,
          finishedAt: drizzleSql`now()`,
        })
        .where(eq(jobs.id, jobId));

      // Chỉ giải phóng profile khi job đã final (không retry nữa)
      if (!willRetry) {
        await tx
          .update(profiles)
          .set({ status: 'available' })
          .where(eq(profiles.id, job.profileId));

        // Update counter của order
        await tx
          .update(orders)
          .set(
            ok
              ? { completedJobs: drizzleSql`${orders.completedJobs} + 1` }
              : { failedJobs: drizzleSql`${orders.failedJobs} + 1` },
          )
          .where(eq(orders.id, job.orderId));

        // Mark order done nếu tất cả job đã final (succeed + fail = count)
        await tx.execute(drizzleSql`
          update orders
          set
            status = case
              when completed_jobs + failed_jobs >= count and failed_jobs = 0 then 'done'
              when completed_jobs + failed_jobs >= count then 'done'
              else status
            end,
            completed_at = case
              when completed_jobs + failed_jobs >= count and completed_at is null then now()
              else completed_at
            end
          where id = ${job.orderId}
        `);
      }
    });

    return { ok: true, status };
  });

  // GET /jobs — list recent jobs (newest first) for activity view
  app.get('/jobs', async (req) => {
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = Math.min(q.limit ? Number(q.limit) : 50, 200);
    const offset = q.offset ? Number(q.offset) : 0;
    const where = q.status ? eq(jobs.status, q.status) : undefined;
    const rows = await db
      .select()
      .from(jobs)
      .where(where)
      .orderBy(drizzleSql`${jobs.id} desc`)
      .limit(limit)
      .offset(offset);
    const [countRow] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(jobs)
      .where(where);
    const count = countRow?.count ?? 0;
    return { items: rows, total: count };
  });
}
