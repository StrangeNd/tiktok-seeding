import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { workers } from '../db/schema.js';

const heartbeatSchema = z.object({
  name: z.string().min(1).max(64),
  capacity: z.number().int().min(0).max(500),
  currentLoad: z.number().int().min(0).max(500),
  version: z.string().optional(),
});

export async function workerRoutes(app: FastifyInstance): Promise<void> {
  // POST /workers/heartbeat — worker báo cáo trạng thái
  app.post('/workers/heartbeat', async (req, reply) => {
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { name, capacity, currentLoad, version } = parsed.data;
    await db
      .insert(workers)
      .values({ name, capacity, currentLoad, version })
      .onConflictDoUpdate({
        target: workers.name,
        set: {
          capacity,
          currentLoad,
          version: version ?? null,
          lastSeenAt: drizzleSql`now()`,
        },
      });
    return { ok: true };
  });

  // GET /workers — danh sách worker + thời gian heartbeat gần nhất
  app.get('/workers', async () => {
    const list = await db.select().from(workers);
    return { workers: list };
  });
}
