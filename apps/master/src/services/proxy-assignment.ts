import { asc, sql as drizzleSql, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accountProxyAssignments, accounts, proxies } from '../db/schema.js';
import { writeAuditLog } from './audit.js';
import type { AuthUser } from './auth.js';

export interface ProxyAssignmentResult {
  strategy: 'round_robin_stable';
  accountCount: number;
  proxyCount: number;
  assigned: number;
}

export async function rebalanceProxyAssignments(
  actor?: AuthUser | null,
): Promise<ProxyAssignmentResult> {
  const accountRows = await db.select({ id: accounts.id }).from(accounts).orderBy(asc(accounts.id));
  const proxyRows = await db
    .select({ id: proxies.id })
    .from(proxies)
    .where(drizzleSql`${proxies.status} != 'disabled'`)
    .orderBy(asc(proxies.id));
  await db.delete(accountProxyAssignments);
  if (accountRows.length === 0 || proxyRows.length === 0) {
    const empty = {
      strategy: 'round_robin_stable' as const,
      accountCount: accountRows.length,
      proxyCount: proxyRows.length,
      assigned: 0,
    };
    await writeAuditLog({
      actor,
      action: 'proxy.assignment.rebalanced',
      entityType: 'proxy_assignment',
      metadata: empty,
    });
    return empty;
  }
  const values = accountRows.map((account, idx) => ({
    accountId: account.id,
    proxyId: proxyRows[idx % proxyRows.length]?.id ?? proxyRows[0]!.id,
    strategy: 'round_robin_stable',
  }));
  await db.insert(accountProxyAssignments).values(values);
  const result = {
    strategy: 'round_robin_stable' as const,
    accountCount: accountRows.length,
    proxyCount: proxyRows.length,
    assigned: values.length,
  };
  await writeAuditLog({
    actor,
    action: 'proxy.assignment.rebalanced',
    entityType: 'proxy_assignment',
    metadata: {
      strategy: result.strategy,
      accountCount: result.accountCount,
      proxyCount: result.proxyCount,
      assigned: result.assigned,
    },
  });
  return result;
}

export async function getAssignmentForAccount(accountId: number) {
  const [row] = await db
    .select({ proxy: proxies })
    .from(accountProxyAssignments)
    .innerJoin(proxies, eq(accountProxyAssignments.proxyId, proxies.id))
    .where(eq(accountProxyAssignments.accountId, accountId))
    .limit(1);
  return row?.proxy ?? null;
}
