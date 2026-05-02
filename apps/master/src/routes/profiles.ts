import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { jobs, orders, profiles, workers } from '../db/schema.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/profiles', async (req) => {
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = Math.min(q.limit ? Number(q.limit) : 200, 1000);
    const offset = q.offset ? Number(q.offset) : 0;
    const where = q.status ? eq(profiles.status, q.status) : undefined;
    const rows = await db
      .select()
      .from(profiles)
      .where(where)
      .orderBy(drizzleSql`${profiles.name} asc`)
      .limit(limit)
      .offset(offset);
    const [countRow] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(profiles)
      .where(where);
    const count = countRow?.count ?? 0;
    return { items: rows, total: count };
  });

  app.get('/profiles/summary', async () => {
    const rows = await db
      .select({ status: profiles.status, count: drizzleSql<number>`count(*)::int` })
      .from(profiles)
      .groupBy(profiles.status);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }
    return { total, byStatus };
  });

  // System overview snapshot for dashboard top-level page.
  app.get('/system/summary', async () => {
    const profileRows = await db
      .select({ status: profiles.status, count: drizzleSql<number>`count(*)::int` })
      .from(profiles)
      .groupBy(profiles.status);
    const profilesByStatus: Record<string, number> = {};
    for (const r of profileRows) profilesByStatus[r.status] = r.count;

    const orderRows = await db
      .select({ status: orders.status, count: drizzleSql<number>`count(*)::int` })
      .from(orders)
      .groupBy(orders.status);
    const ordersByStatus: Record<string, number> = {};
    for (const r of orderRows) ordersByStatus[r.status] = r.count;

    const jobRows = await db
      .select({ status: jobs.status, count: drizzleSql<number>`count(*)::int` })
      .from(jobs)
      .groupBy(jobs.status);
    const jobsByStatus: Record<string, number> = {};
    for (const r of jobRows) jobsByStatus[r.status] = r.count;

    const workerRows = await db.select().from(workers);

    return {
      profiles: { byStatus: profilesByStatus },
      orders: { byStatus: ordersByStatus },
      jobs: { byStatus: jobsByStatus },
      workers: workerRows.map((w) => ({
        name: w.name,
        capacity: w.capacity,
        currentLoad: w.currentLoad,
        version: w.version,
        lastSeenAt: w.lastSeenAt.toISOString(),
      })),
    };
  });
}
