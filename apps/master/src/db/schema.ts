// DB schema cho Phase 1 MVP — chỉ gồm tables tối thiểu để chạy live_view end-to-end.
// Phase 2+ sẽ bổ sung: accounts (login state, cookie), proxies, action_logs chi tiết.

import { sql } from 'drizzle-orm';
import { index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `profiles` — mirror các GPM profile có trong app GPM Login.
 * Sync định kỳ từ GET /api/v1/profiles.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: text('id').primaryKey(), // GPM UUID
    name: text('name').notNull(),
    browserType: text('browser_type'),
    browserVersion: text('browser_version'),
    groupId: text('group_id'),
    rawProxy: text('raw_proxy'),
    /** available | in_use | broken | quarantined */
    status: text('status').notNull().default('available'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('profiles_status_idx').on(t.status),
    lastUsedIdx: index('profiles_last_used_idx').on(t.lastUsedAt),
  }),
);

/**
 * `orders` — mỗi order là 1 yêu cầu seeding (vd: 50 view trong 5 phút).
 */
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // 'live_view'
  targetUrl: text('target_url').notNull(),
  count: integer('count').notNull(),
  watchSeconds: integer('watch_seconds').notNull(),
  spreadSeconds: integer('spread_seconds').notNull().default(0),
  /** queued | running | done | failed | cancelled */
  status: text('status').notNull().default('queued'),
  completedJobs: integer('completed_jobs').notNull().default(0),
  failedJobs: integer('failed_jobs').notNull().default(0),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * `jobs` — mỗi sub-job thuộc 1 order, chạy trên 1 profile.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id),
    /** pending | running | succeeded | failed | retrying | cancelled */
    status: text('status').notNull().default('pending'),
    attempt: integer('attempt').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    workerName: text('worker_name'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('jobs_order_idx').on(t.orderId),
    statusIdx: index('jobs_status_idx').on(t.status),
    profileIdx: index('jobs_profile_idx').on(t.profileId),
  }),
);

/**
 * `workers` — heartbeat của worker để master biết worker nào còn alive.
 */
export const workers = pgTable('workers', {
  name: text('name').primaryKey(),
  capacity: integer('capacity').notNull().default(0),
  currentLoad: integer('current_load').notNull().default(0),
  version: text('version'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Helper types ─ Drizzle infer từ schema
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Worker = typeof workers.$inferSelect;
