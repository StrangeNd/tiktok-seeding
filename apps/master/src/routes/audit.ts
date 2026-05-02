import type { FastifyInstance } from 'fastify';
import { listAuditLogs } from '../services/audit.js';
import { requireAuth, requirePermission } from './auth.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audit-logs', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    if (user.role === 'admin') return listAuditLogs();
    await requirePermission(req, reply, 'logs:view');
    return listAuditLogs({ actorUserId: user.id });
  });
}
