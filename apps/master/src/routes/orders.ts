import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { jobs, orders } from '../db/schema.js';
import { createOrderAndDispatch } from '../services/order-splitter.js';
import { syncProfilesFromGpm } from '../services/profile-sync.js';

const createOrderSchema = z.object({
  type: z.literal('live_view'), // Phase 1
  targetUrl: z.string().url(),
  count: z.number().int().min(1).max(500),
  watchSeconds: z.number().int().min(10).max(3600),
  spreadSeconds: z.number().int().min(0).max(600).optional(),
});

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  // POST /orders — tạo order + dispatch
  app.post('/orders', async (req, reply) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    try {
      const result = await createOrderAndDispatch(parsed.data);
      return reply.code(201).send(result);
    } catch (e) {
      app.log.error({ err: e }, 'createOrder failed');
      return reply.code(500).send({ error: 'create_failed', message: (e as Error).message });
    }
  });

  // GET /orders/:id — order + counts
  app.get('/orders/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });

    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return reply.code(404).send({ error: 'not_found' });

    const subJobs = await db
      .select({
        id: jobs.id,
        status: jobs.status,
        profileId: jobs.profileId,
        attempt: jobs.attempt,
        errorCode: jobs.errorCode,
        errorMessage: jobs.errorMessage,
        durationMs: jobs.durationMs,
        startedAt: jobs.startedAt,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(eq(jobs.orderId, id));

    return { order, jobs: subJobs };
  });

  // GET /orders — list (latest first)
  app.get('/orders', async () => {
    const list = await db.select().from(orders).orderBy(orders.id).limit(50);
    return { orders: list.reverse() };
  });

  // POST /admin/sync-profiles — pull profile từ GPM
  app.post('/admin/sync-profiles', async (_req, reply) => {
    try {
      const result = await syncProfilesFromGpm();
      return result;
    } catch (e) {
      return reply.code(500).send({ error: 'sync_failed', message: (e as Error).message });
    }
  });
}
