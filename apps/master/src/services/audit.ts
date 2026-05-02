import { desc, sql as drizzleSql, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';
import type { AuthUser } from './auth.js';

export interface AuditInput {
  actor?: AuthUser | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const sensitiveKeys = /password|pass|secret|token|cookie|credential|key|proxy/i;

function sanitizeValue(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sensitiveKeys.test(key) ? '[redacted]' : sanitizeValue(nested);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  return value;
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: input.actor && input.actor.id > 0 ? input.actor.id : null,
    actorUsername: input.actor?.username ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId == null ? null : String(input.entityId),
    metadataJson: input.metadata ? JSON.stringify(sanitizeValue(input.metadata)) : null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export async function listAuditLogs(opts: { actorUserId?: number; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const where = opts.actorUserId ? eq(auditLogs.actorUserId, opts.actorUserId) : undefined;
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  const [countRow] = await db
    .select({ count: drizzleSql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);
  return {
    items: rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorUsername: row.actorUsername,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    })),
    total: countRow?.count ?? 0,
  };
}
