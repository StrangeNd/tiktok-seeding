import { loadEnv } from '@app/shared';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const env = loadEnv();

/**
 * Postgres pool dùng `postgres` driver (lighter than pg).
 * 1 pool dùng chung cho cả master process; close khi shutdown.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(sql, { schema, casing: 'snake_case' });

export type DB = typeof db;
export { schema };

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
