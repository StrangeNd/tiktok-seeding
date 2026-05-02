import { createLogger } from '@app/shared';
import { sql as drizzleSql, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { type Account, accountProxyAssignments, accounts, proxies } from '../db/schema.js';
import { decryptJson, encryptJson, maskSecret } from '../lib/crypto.js';
import { rebalanceProxyAssignments } from './proxy-assignment.js';

const log = createLogger('accounts');

export type AccountStatus = 'active' | 'disabled' | 'broken' | 'quarantined' | 'archived';
export type CookieStatus = 'unknown' | 'present' | 'missing' | 'needs_reauth' | 'dead';
export type MailCodeStatus =
  | 'ok'
  | 'missing_oauth'
  | 'token_failed'
  | 'code_not_found'
  | 'provider_unsupported'
  | 'rate_limited'
  | 'error';

export interface AccountSecrets {
  pass?: string;
  mail?: string;
  passmail?: string;
  refreshtokenmail?: string;
  clientid?: string;
  cookie?: string;
}

export interface ParsedAccountRow {
  rowNumber: number;
  raw: string;
  ok: boolean;
  reason?: string;
  // Parsed fields (only flags surfaced after import; values used internally for encryption)
  username?: string;
  email?: string;
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasMailRefreshToken: boolean;
  hasMailClientId: boolean;
  hasCookie: boolean;
  _secrets?: AccountSecrets;
}

export interface ParsePreview {
  total: number;
  valid: number;
  invalid: number;
  duplicateUsernamesInInput: number;
  duplicateEmailsInInput: number;
  duplicateUsernamesInDb: number;
  duplicateEmailsInDb: number;
  rows: SafeParsedRow[];
}

/** Public-safe view of a parsed row (no secret values). */
export interface SafeParsedRow {
  rowNumber: number;
  ok: boolean;
  reason?: string;
  username?: string;
  email?: string;
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasMailRefreshToken: boolean;
  hasMailClientId: boolean;
  hasCookie: boolean;
  duplicate?: 'username_input' | 'email_input' | 'username_db' | 'email_db';
}

function toSafe(
  r: ParsedAccountRow,
  duplicate?: 'username_input' | 'email_input' | 'username_db' | 'email_db',
): SafeParsedRow {
  return {
    rowNumber: r.rowNumber,
    ok: r.ok && !duplicate,
    reason: duplicate ? `duplicate (${duplicate})` : r.reason,
    username: r.username,
    email: r.email,
    hasPassword: r.hasPassword,
    hasEmailPassword: r.hasEmailPassword,
    hasMailRefreshToken: r.hasMailRefreshToken,
    hasMailClientId: r.hasMailClientId,
    hasCookie: r.hasCookie,
    duplicate,
  };
}

/** Parse one row. Empty strings are treated as missing. */
export function parseAccountLine(line: string, rowNumber: number): ParsedAccountRow {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) {
    return {
      rowNumber,
      raw,
      ok: false,
      reason: 'empty_or_comment',
      hasPassword: false,
      hasEmailPassword: false,
      hasMailRefreshToken: false,
      hasMailClientId: false,
      hasCookie: false,
    };
  }
  const parts = raw.split('|').map((s) => s.trim());
  if (parts.length > 7) {
    return {
      rowNumber,
      raw,
      ok: false,
      reason: 'too_many_fields',
      hasPassword: !!parts[1],
      hasEmailPassword: !!parts[3],
      hasMailRefreshToken: !!parts[4],
      hasMailClientId: !!parts[5],
      hasCookie: !!parts[6],
    };
  }
  while (parts.length < 7) parts.push('');
  const [username, pass, mail, passmail, refreshtokenmail, clientid, cookie] = parts;

  if (!username) {
    return {
      rowNumber,
      raw,
      ok: false,
      reason: 'missing_username',
      hasPassword: !!pass,
      hasEmailPassword: !!passmail,
      hasMailRefreshToken: !!refreshtokenmail,
      hasMailClientId: !!clientid,
      hasCookie: !!cookie,
    };
  }

  return {
    rowNumber,
    raw,
    ok: true,
    username,
    email: mail ? mail.toLowerCase() : undefined,
    hasPassword: !!pass,
    hasEmailPassword: !!passmail,
    hasMailRefreshToken: !!refreshtokenmail,
    hasMailClientId: !!clientid,
    hasCookie: !!cookie,
    _secrets: {
      pass: pass || undefined,
      mail: mail || undefined,
      passmail: passmail || undefined,
      refreshtokenmail: refreshtokenmail || undefined,
      clientid: clientid || undefined,
      cookie: cookie || undefined,
    },
  };
}

export function parseAccountsText(text: string): ParsedAccountRow[] {
  return text
    .split(/\r?\n/)
    .map((line, idx) => parseAccountLine(line, idx + 1))
    .filter((r) => r.raw !== '' || r.reason !== 'empty_or_comment');
}

export async function buildAccountImportPreview(text: string): Promise<ParsePreview> {
  const parsed = parseAccountsText(text);
  const seenUsernames = new Set<string>();
  const seenEmails = new Set<string>();
  const usernames = parsed.filter((r) => r.ok).map((r) => r.username ?? '');
  const emails = parsed.filter((r) => r.ok && r.email).map((r) => r.email?.toLowerCase() ?? '');

  let existingUsernameSet = new Set<string>();
  let existingEmailSet = new Set<string>();
  if (usernames.length > 0) {
    const rows = await db
      .select({ username: accounts.username, email: accounts.email })
      .from(accounts)
      .where(inArray(accounts.username, usernames));
    existingUsernameSet = new Set(rows.map((r) => r.username.toLowerCase()));
  }
  if (emails.length > 0) {
    const rows = await db
      .select({ email: accounts.email })
      .from(accounts)
      .where(inArray(accounts.email, emails));
    existingEmailSet = new Set(rows.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]);
  }

  let duplicateUsernamesInInput = 0;
  let duplicateEmailsInInput = 0;
  let duplicateUsernamesInDb = 0;
  let duplicateEmailsInDb = 0;
  const safeRows: SafeParsedRow[] = parsed.map((r) => {
    if (!r.ok) return toSafe(r);
    const u = (r.username ?? '').toLowerCase();
    const e = r.email?.toLowerCase();
    if (seenUsernames.has(u)) {
      duplicateUsernamesInInput += 1;
      return toSafe(r, 'username_input');
    }
    seenUsernames.add(u);
    if (e && seenEmails.has(e)) {
      duplicateEmailsInInput += 1;
      return toSafe(r, 'email_input');
    }
    if (e) seenEmails.add(e);
    if (existingUsernameSet.has(u)) {
      duplicateUsernamesInDb += 1;
      return toSafe(r, 'username_db');
    }
    if (e && existingEmailSet.has(e)) {
      duplicateEmailsInDb += 1;
      return toSafe(r, 'email_db');
    }
    return toSafe(r);
  });

  const valid = safeRows.filter((r) => r.ok).length;
  const invalid = safeRows.length - valid;

  return {
    total: parsed.length,
    valid,
    invalid,
    duplicateUsernamesInInput,
    duplicateEmailsInInput,
    duplicateUsernamesInDb,
    duplicateEmailsInDb,
    rows: safeRows,
  };
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  total: number;
}

export async function importAccountsFromText(text: string): Promise<ImportResult> {
  const parsed = parseAccountsText(text);
  const validRows = parsed.filter((r) => r.ok);

  if (validRows.length === 0) {
    return { inserted: 0, skipped: parsed.length, total: parsed.length };
  }

  const usernames = validRows.map((r) => r.username ?? '');
  const emails = validRows.filter((r) => r.email).map((r) => r.email?.toLowerCase() ?? '');
  const existing = await db
    .select({ username: accounts.username, email: accounts.email })
    .from(accounts)
    .where(inArray(accounts.username, usernames));
  const existingUsernameSet = new Set(existing.map((r) => r.username.toLowerCase()));
  let existingEmailSet = new Set<string>();
  if (emails.length > 0) {
    const rows = await db
      .select({ email: accounts.email })
      .from(accounts)
      .where(inArray(accounts.email, emails));
    existingEmailSet = new Set(rows.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[]);
  }

  const toInsert = [];
  const inputSeenUsernames = new Set<string>();
  const inputSeenEmails = new Set<string>();
  for (const r of validRows) {
    const u = (r.username ?? '').toLowerCase();
    const e = r.email?.toLowerCase();
    if (inputSeenUsernames.has(u) || existingUsernameSet.has(u)) continue;
    if (e && (inputSeenEmails.has(e) || existingEmailSet.has(e))) continue;
    inputSeenUsernames.add(u);
    if (e) inputSeenEmails.add(e);
    toInsert.push({
      username: r.username ?? '',
      email: r.email ?? null,
      status: 'active',
      secretBlob: r._secrets ? encryptJson(r._secrets) : null,
      hasPassword: r.hasPassword ? 1 : 0,
      hasEmailPassword: r.hasEmailPassword ? 1 : 0,
      hasMailRefreshToken: r.hasMailRefreshToken ? 1 : 0,
      hasMailClientId: r.hasMailClientId ? 1 : 0,
      hasCookie: r.hasCookie ? 1 : 0,
      cookieStatus: r.hasCookie ? 'present' : 'missing',
    });
  }

  if (toInsert.length === 0) {
    return { inserted: 0, skipped: parsed.length, total: parsed.length };
  }

  await db.insert(accounts).values(toInsert);
  await rebalanceProxyAssignments();
  log.info({ inserted: toInsert.length }, 'Accounts imported');
  return {
    inserted: toInsert.length,
    skipped: parsed.length - toInsert.length,
    total: parsed.length,
  };
}

export interface SafeAccount {
  id: number;
  username: string;
  email: string | null;
  maskedEmail: string | null;
  status: string;
  hasPassword: boolean;
  hasEmailPassword: boolean;
  hasMailRefreshToken: boolean;
  hasMailClientId: boolean;
  hasCookie: boolean;
  cookieStatus: string;
  lastMailCodeStatus: string | null;
  lastMailCodeError: string | null;
  lastMailCodeCheckedAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedProxy: { id: number; label: string; status: string } | null;
}

export function toSafeAccount(a: Account): SafeAccount {
  return {
    id: a.id,
    username: a.username,
    email: a.email,
    maskedEmail: maskEmail(a.email),
    status: a.status,
    hasPassword: a.hasPassword === 1,
    hasEmailPassword: a.hasEmailPassword === 1,
    hasMailRefreshToken: a.hasMailRefreshToken === 1,
    hasMailClientId: a.hasMailClientId === 1,
    hasCookie: a.hasCookie === 1,
    cookieStatus: a.cookieStatus,
    lastMailCodeStatus: a.lastMailCodeStatus,
    lastMailCodeError: a.lastMailCodeError,
    lastMailCodeCheckedAt: a.lastMailCodeCheckedAt ? a.lastMailCodeCheckedAt.toISOString() : null,
    lastError: a.lastError,
    lastCheckedAt: a.lastCheckedAt ? a.lastCheckedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    assignedProxy: null,
  };
}

function safeProxyLabel(p: { protocol: string; host: string; port: number }): string {
  return `${p.protocol}://${p.host}:${p.port}`;
}

export async function listAccounts(
  opts: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: SafeAccount[]; total: number }> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const where = opts.status ? eq(accounts.status, opts.status) : undefined;
  const rows = await db
    .select({ account: accounts, proxy: proxies })
    .from(accounts)
    .leftJoin(accountProxyAssignments, eq(accountProxyAssignments.accountId, accounts.id))
    .leftJoin(proxies, eq(accountProxyAssignments.proxyId, proxies.id))
    .where(where)
    .orderBy(drizzleSql`${accounts.id} desc`)
    .limit(limit)
    .offset(offset);
  const [countRow] = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(accounts)
    .where(where);
  const count = countRow?.count ?? 0;
  return {
    items: rows.map((row) => ({
      ...toSafeAccount(row.account),
      assignedProxy: row.proxy
        ? { id: row.proxy.id, label: safeProxyLabel(row.proxy), status: row.proxy.status }
        : null,
    })),
    total: count,
  };
}

export async function getAccount(id: number): Promise<SafeAccount | null> {
  const [row] = await db
    .select({ account: accounts, proxy: proxies })
    .from(accounts)
    .leftJoin(accountProxyAssignments, eq(accountProxyAssignments.accountId, accounts.id))
    .leftJoin(proxies, eq(accountProxyAssignments.proxyId, proxies.id))
    .where(eq(accounts.id, id))
    .limit(1);
  return row
    ? {
        ...toSafeAccount(row.account),
        assignedProxy: row.proxy
          ? { id: row.proxy.id, label: safeProxyLabel(row.proxy), status: row.proxy.status }
          : null,
      }
    : null;
}

export async function getAccountsSummary(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  withCookie: number;
  withMailRefreshToken: number;
}> {
  const [totalRow] = await db.select({ total: drizzleSql<number>`count(*)::int` }).from(accounts);
  const total = totalRow?.total ?? 0;
  const byStatusRows = await db
    .select({ status: accounts.status, count: drizzleSql<number>`count(*)::int` })
    .from(accounts)
    .groupBy(accounts.status);
  const [withCookieRow] = await db
    .select({ withCookie: drizzleSql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.hasCookie, 1));
  const withCookie = withCookieRow?.withCookie ?? 0;
  const [withMailRefreshTokenRow] = await db
    .select({ withMailRefreshToken: drizzleSql<number>`count(*)::int` })
    .from(accounts)
    .where(eq(accounts.hasMailRefreshToken, 1));
  const withMailRefreshToken = withMailRefreshTokenRow?.withMailRefreshToken ?? 0;

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r.count;
  return { total, byStatus, withCookie, withMailRefreshToken };
}

export async function updateAccountState(
  id: number,
  patch: { status?: AccountStatus; cookieStatus?: CookieStatus; lastError?: string | null },
): Promise<SafeAccount | null> {
  const allowed = ['active', 'disabled', 'broken', 'quarantined', 'archived'];
  if (patch.status && !allowed.includes(patch.status)) throw new Error('invalid_status');
  const allowedCookie = ['unknown', 'present', 'missing', 'needs_reauth', 'dead'];
  if (patch.cookieStatus && !allowedCookie.includes(patch.cookieStatus)) {
    throw new Error('invalid_cookie_status');
  }
  const [row] = await db
    .update(accounts)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.cookieStatus ? { cookieStatus: patch.cookieStatus } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      updatedAt: drizzleSql`now()`,
    })
    .where(eq(accounts.id, id))
    .returning();
  return row ? toSafeAccount(row) : null;
}

export async function setAccountStatus(
  id: number,
  status: AccountStatus,
): Promise<SafeAccount | null> {
  return updateAccountState(id, { status });
}

export async function getAccountSecretsForMailbox(id: number): Promise<{
  account: Account;
  secrets: AccountSecrets;
}> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  if (!account) throw new Error('account_not_found');
  const secrets = account.secretBlob ? decryptJson<AccountSecrets>(account.secretBlob) : {};
  return { account, secrets };
}

export async function recordMailCodeStatus(
  id: number,
  status: MailCodeStatus,
  error?: string | null,
): Promise<void> {
  await db
    .update(accounts)
    .set({
      lastMailCodeStatus: status,
      lastMailCodeError: error ? sanitizeError(error) : null,
      lastMailCodeCheckedAt: drizzleSql`now()`,
      updatedAt: drizzleSql`now()`,
    })
    .where(eq(accounts.id, id));
}

function sanitizeError(message: string): string {
  return message.replace(/[A-Za-z0-9+/=_-]{20,}/g, '[redacted]').slice(0, 240);
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return maskSecret(email);
  const shown = local.length <= 2 ? `${local[0] ?? '*'}***` : `${local.slice(0, 2)}***`;
  return `${shown}@${domain}`;
}
