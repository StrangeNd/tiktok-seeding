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
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().default(sql`now()`),
});

/**
 * `accounts` — TikTok account pool. Sensitive secret material is stored encrypted
 * in `secret_blob` (AES-256-GCM ciphertext, base64). The dashboard NEVER reads
 * plaintext back; only presence flags are exposed.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: serial('id').primaryKey(),
    username: text('username').notNull(),
    email: text('email'),
    /** active | disabled | broken | quarantined | archived */
    status: text('status').notNull().default('active'),
    /** Encrypted JSON blob: { pass, mail, passmail, refreshtokenmail, clientid, cookie } */
    secretBlob: text('secret_blob'),
    /** Quick-glance flags; do NOT replicate raw secret values. */
    hasPassword: integer('has_password').notNull().default(0),
    hasEmailPassword: integer('has_email_password').notNull().default(0),
    hasMailRefreshToken: integer('has_mail_refresh_token').notNull().default(0),
    hasMailClientId: integer('has_mail_client_id').notNull().default(0),
    hasCookie: integer('has_cookie').notNull().default(0),
    /** unknown | present | missing | needs_reauth | dead */
    cookieStatus: text('cookie_status').notNull().default('unknown'),
    /** ok | missing_oauth | token_failed | code_not_found | provider_unsupported | error */
    lastMailCodeStatus: text('last_mail_code_status'),
    lastMailCodeError: text('last_mail_code_error'),
    lastMailCodeCheckedAt: timestamp('last_mail_code_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usernameIdx: index('accounts_username_idx').on(t.username),
    emailIdx: index('accounts_email_idx').on(t.email),
    statusIdx: index('accounts_status_idx').on(t.status),
    cookieStatusIdx: index('accounts_cookie_status_idx').on(t.cookieStatus),
  }),
);

/**
 * `proxies` — Proxy pool. Password is stored encrypted in `secret_blob` (AES-256-GCM).
 * Dashboard receives only `hasAuth` flag and masked username, never the password.
 */
export const proxies = pgTable(
  'proxies',
  {
    id: serial('id').primaryKey(),
    /** http | https | socks5 | socks4 */
    protocol: text('protocol').notNull().default('http'),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    username: text('username'),
    /** Encrypted password (AES-256-GCM, base64). */
    secretBlob: text('secret_blob'),
    hasAuth: integer('has_auth').notNull().default(0),
    /** unknown | ok | failed | disabled */
    status: text('status').notNull().default('unknown'),
    latencyMs: integer('latency_ms'),
    lastError: text('last_error'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hostPortIdx: index('proxies_host_port_idx').on(t.host, t.port),
    statusIdx: index('proxies_status_idx').on(t.status),
  }),
);

// Helper types ─ Drizzle infer từ schema
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Worker = typeof workers.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Proxy = typeof proxies.$inferSelect;
export type NewProxy = typeof proxies.$inferInsert;
