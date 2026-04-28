import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // GET /profiles — list all profiles (newest sync first)
  app.get('/profiles', async () => {
    const list = await db
      .select()
      .from(profiles)
      .orderBy(profiles.syncedAt)
      .limit(500);
    return { profiles: list.reverse() };
  });

  // GET /profiles/summary — counts grouped by status
  app.get('/profiles/summary', async () => {
    const rows = await db.execute<{ status: string; count: string }>(drizzleSql`
      SELECT status, COUNT(*)::text AS count
      FROM profiles
      GROUP BY status
    `);
    const summary: Record<string, number> = {};
    for (const r of rows) {
      summary[r.status] = Number(r.count);
    }
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    return { total, summary };
  });
}
