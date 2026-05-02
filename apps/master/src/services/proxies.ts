// Proxy pool service.
//
// Supported input formats per line:
//   host:port
//   host:port:username:password
//   protocol://host:port
//   protocol://username:password@host:port
//
// Connectivity validation:
//   GET PROXY_TEST_URL via the proxy, with PROXY_TEST_TIMEOUT_MS deadline.
//   This is intentionally platform-agnostic — it does NOT contact TikTok.

import { createConnection } from 'node:net';
import { createLogger, loadEnv } from '@app/shared';
import { sql as drizzleSql, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { type Proxy as ProxyRow, proxies } from '../db/schema.js';
import { encryptJson } from '../lib/crypto.js';

const log = createLogger('proxies');
const env = loadEnv();

export interface ParsedProxyRow {
  rowNumber: number;
  raw: string;
  ok: boolean;
  reason?: string;
  protocol?: 'http' | 'https' | 'socks5' | 'socks4';
  host?: string;
  port?: number;
  username?: string;
  hasAuth: boolean;
  // Internal only
  _password?: string;
}

export interface SafeProxyParsedRow {
  rowNumber: number;
  ok: boolean;
  reason?: string;
  protocol?: string;
  host?: string;
  port?: number;
  hasAuth: boolean;
  duplicate?: 'input' | 'db';
}

const PROTOCOLS = new Set(['http', 'https', 'socks5', 'socks4']);

function makeRow(rowNumber: number, raw: string, reason: string): ParsedProxyRow {
  return { rowNumber, raw, ok: false, reason, hasAuth: false };
}

export function parseProxyLine(line: string, rowNumber: number): ParsedProxyRow {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) {
    return makeRow(rowNumber, raw, 'empty_or_comment');
  }

  let protocol: 'http' | 'https' | 'socks5' | 'socks4' = 'http';
  let body = raw;

  // protocol://...
  const protoMatch = raw.match(/^([a-z][a-z0-9+\-.]*):\/\/(.+)$/i);
  if (protoMatch) {
    const p = protoMatch[1]?.toLowerCase() ?? '';
    if (!PROTOCOLS.has(p)) {
      return makeRow(rowNumber, raw, `unsupported_protocol:${p}`);
    }
    protocol = p as 'http' | 'https' | 'socks5' | 'socks4';
    body = protoMatch[2] ?? '';
  }

  let username: string | undefined;
  let password: string | undefined;
  let hostport = body;

  // username:password@host:port
  const atIdx = body.lastIndexOf('@');
  if (atIdx >= 0) {
    const userpass = body.slice(0, atIdx);
    hostport = body.slice(atIdx + 1);
    const colon = userpass.indexOf(':');
    if (colon < 0) {
      return makeRow(rowNumber, raw, 'invalid_userinfo');
    }
    username = userpass.slice(0, colon);
    password = userpass.slice(colon + 1);
  }

  // Could also be host:port:user:pass (legacy 4-part)
  const hpParts = hostport.split(':');
  let host: string;
  let port: number;
  if (atIdx < 0 && hpParts.length === 4) {
    host = hpParts[0] ?? '';
    port = Number(hpParts[1]);
    username = hpParts[2];
    password = hpParts[3];
  } else if (hpParts.length === 2) {
    host = hpParts[0] ?? '';
    port = Number(hpParts[1]);
  } else {
    return makeRow(rowNumber, raw, 'invalid_host_port');
  }

  if (!host || host.length < 1) return makeRow(rowNumber, raw, 'missing_host');
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return makeRow(rowNumber, raw, 'invalid_port');
  }

  return {
    rowNumber,
    raw,
    ok: true,
    protocol,
    host,
    port,
    username: username || undefined,
    hasAuth: !!(username && password),
    _password: password,
  };
}

export function parseProxiesText(text: string): ParsedProxyRow[] {
  return text
    .split(/\r?\n/)
    .map((line, idx) => parseProxyLine(line, idx + 1))
    .filter((r) => r.raw !== '');
}

export interface ProxyParsePreview {
  total: number;
  valid: number;
  invalid: number;
  duplicateInInput: number;
  duplicateInDb: number;
  rows: SafeProxyParsedRow[];
}

function toSafeParsed(r: ParsedProxyRow, duplicate?: 'input' | 'db'): SafeProxyParsedRow {
  return {
    rowNumber: r.rowNumber,
    ok: r.ok && !duplicate,
    reason: duplicate ? `duplicate (${duplicate})` : r.reason,
    protocol: r.protocol,
    host: r.host,
    port: r.port,
    hasAuth: r.hasAuth,
    duplicate,
  };
}

export async function buildProxyImportPreview(text: string): Promise<ProxyParsePreview> {
  const parsed = parseProxiesText(text);

  const valids = parsed.filter((r) => r.ok);
  const hosts = valids.map((r) => r.host ?? '');
  let existingDb = new Set<string>();
  if (hosts.length > 0) {
    const rows = await db
      .select({ host: proxies.host, port: proxies.port })
      .from(proxies)
      .where(inArray(proxies.host, hosts));
    existingDb = new Set(rows.map((r) => `${r.host}:${r.port}`));
  }

  const seenInput = new Set<string>();
  let dupInput = 0;
  let dupDb = 0;
  const safeRows: SafeProxyParsedRow[] = parsed.map((r) => {
    if (!r.ok) return toSafeParsed(r);
    const k = `${r.host}:${r.port}`;
    if (seenInput.has(k)) {
      dupInput += 1;
      return toSafeParsed(r, 'input');
    }
    seenInput.add(k);
    if (existingDb.has(k)) {
      dupDb += 1;
      return toSafeParsed(r, 'db');
    }
    return toSafeParsed(r);
  });

  const valid = safeRows.filter((r) => r.ok).length;
  return {
    total: parsed.length,
    valid,
    invalid: parsed.length - valid,
    duplicateInInput: dupInput,
    duplicateInDb: dupDb,
    rows: safeRows,
  };
}

export interface ProxyImportResult {
  inserted: number;
  skipped: number;
  total: number;
}

export async function importProxiesFromText(text: string): Promise<ProxyImportResult> {
  const parsed = parseProxiesText(text);
  const valids = parsed.filter((r) => r.ok);
  if (valids.length === 0) {
    return { inserted: 0, skipped: parsed.length, total: parsed.length };
  }
  const hosts = valids.map((r) => r.host ?? '');
  const existing = await db
    .select({ host: proxies.host, port: proxies.port })
    .from(proxies)
    .where(inArray(proxies.host, hosts));
  const existingSet = new Set(existing.map((r) => `${r.host}:${r.port}`));

  const seen = new Set<string>();
  const toInsert = [];
  for (const r of valids) {
    const k = `${r.host}:${r.port}`;
    if (seen.has(k) || existingSet.has(k)) continue;
    seen.add(k);
    toInsert.push({
      protocol: r.protocol ?? 'http',
      host: r.host ?? '',
      port: r.port ?? 0,
      username: r.username ?? null,
      secretBlob: r._password ? encryptJson({ password: r._password }) : null,
      hasAuth: r.hasAuth ? 1 : 0,
      status: 'unknown',
    });
  }
  if (toInsert.length === 0) {
    return { inserted: 0, skipped: parsed.length, total: parsed.length };
  }
  await db.insert(proxies).values(toInsert);
  log.info({ inserted: toInsert.length }, 'Proxies imported');
  return {
    inserted: toInsert.length,
    skipped: parsed.length - toInsert.length,
    total: parsed.length,
  };
}

export interface SafeProxy {
  id: number;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  hasAuth: boolean;
  status: string;
  latencyMs: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toSafeProxy(p: ProxyRow): SafeProxy {
  return {
    id: p.id,
    protocol: p.protocol,
    host: p.host,
    port: p.port,
    username: p.username,
    hasAuth: p.hasAuth === 1,
    status: p.status,
    latencyMs: p.latencyMs,
    lastError: p.lastError,
    lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listProxies(
  opts: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: SafeProxy[]; total: number }> {
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const where = opts.status ? eq(proxies.status, opts.status) : undefined;
  const rows = await db
    .select()
    .from(proxies)
    .where(where)
    .orderBy(drizzleSql`${proxies.id} desc`)
    .limit(limit)
    .offset(offset);
  const [countRow] = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(proxies)
    .where(where);
  const count = countRow?.count ?? 0;
  return { items: rows.map(toSafeProxy), total: count };
}

export async function getProxiesSummary(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  withAuth: number;
  avgLatencyMs: number | null;
}> {
  const [totalRow] = await db.select({ total: drizzleSql<number>`count(*)::int` }).from(proxies);
  const total = totalRow?.total ?? 0;
  const byStatusRows = await db
    .select({ status: proxies.status, count: drizzleSql<number>`count(*)::int` })
    .from(proxies)
    .groupBy(proxies.status);
  const [withAuthRow] = await db
    .select({ withAuth: drizzleSql<number>`count(*)::int` })
    .from(proxies)
    .where(eq(proxies.hasAuth, 1));
  const withAuth = withAuthRow?.withAuth ?? 0;
  const [avgRow] = await db
    .select({ avg: drizzleSql<number | null>`avg(latency_ms)::int` })
    .from(proxies)
    .where(eq(proxies.status, 'ok'));
  const avg = avgRow?.avg ?? null;

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r.count;
  return { total, byStatus, withAuth, avgLatencyMs: avg };
}

/**
 * Generic connectivity test: open TCP socket to host:port within timeout,
 * or, if HTTP/S proxy + node fetch, attempt PROXY_TEST_URL via http(s)
 * proxy `CONNECT`. To keep dependencies minimal we only do a TCP-reachability
 * check here. This is sufficient as a "is the proxy alive" smoke test and
 * intentionally not platform-specific.
 */
export async function testProxyConnectivity(id: number): Promise<SafeProxy | null> {
  const [row] = await db.select().from(proxies).where(eq(proxies.id, id)).limit(1);
  if (!row) return null;

  const start = Date.now();
  try {
    await tcpProbe(row.host, row.port, env.PROXY_TEST_TIMEOUT_MS);
    const latency = Date.now() - start;
    const [updated] = await db
      .update(proxies)
      .set({
        status: 'ok',
        latencyMs: latency,
        lastError: null,
        lastCheckedAt: drizzleSql`now()`,
        updatedAt: drizzleSql`now()`,
      })
      .where(eq(proxies.id, id))
      .returning();
    return updated ? toSafeProxy(updated) : null;
  } catch (err) {
    const message = (err as Error).message ?? 'unknown_error';
    const [updated] = await db
      .update(proxies)
      .set({
        status: 'failed',
        latencyMs: null,
        lastError: message.slice(0, 200),
        lastCheckedAt: drizzleSql`now()`,
        updatedAt: drizzleSql`now()`,
      })
      .where(eq(proxies.id, id))
      .returning();
    return updated ? toSafeProxy(updated) : null;
  }
}

function tcpProbe(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const onError = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(() => onError(new Error('tcp_timeout')), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      onError(err);
    });
  });
}

export async function setProxyStatus(id: number, status: string): Promise<SafeProxy | null> {
  const allowed = ['unknown', 'ok', 'failed', 'disabled'];
  if (!allowed.includes(status)) throw new Error('invalid_status');
  const [row] = await db
    .update(proxies)
    .set({ status, updatedAt: drizzleSql`now()` })
    .where(eq(proxies.id, id))
    .returning();
  return row ? toSafeProxy(row) : null;
}
