import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../services/audit.js';
import {
  buildProxyImportPreview,
  getProxiesSummary,
  importProxiesFromText,
  listProxies,
  setProxyStatus,
  testProxyConnectivity,
} from '../services/proxies.js';
import { rebalanceProxyAssignments } from '../services/proxy-assignment.js';
import { requirePermission } from './auth.js';

const previewSchema = z.object({ text: z.string().max(2_000_000) });
const importSchema = z.object({ text: z.string().max(2_000_000), confirm: z.literal(true) });
const updateStatusSchema = z.object({
  status: z.enum(['unknown', 'ok', 'failed', 'disabled']),
});

export async function proxyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/proxies', async (req) => {
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    const offset = q.offset ? Number(q.offset) : 0;
    return listProxies({ status: q.status, limit, offset });
  });

  app.get('/proxies/summary', async () => getProxiesSummary());

  app.post('/proxies/import/preview', async (req, reply) => {
    const user = await requirePermission(req, reply, 'proxies:import');
    if (!user) return;
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const result = await buildProxyImportPreview(parsed.data.text);
    await writeAuditLog({
      actor: user,
      action: 'proxy.import.preview',
      entityType: 'proxy',
      metadata: { total: result.total, valid: result.valid, invalid: result.invalid },
    });
    return result;
  });

  app.post('/proxies/import', async (req, reply) => {
    const user = await requirePermission(req, reply, 'proxies:import');
    if (!user) return;
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const result = await importProxiesFromText(parsed.data.text);
    await writeAuditLog({
      actor: user,
      action: 'proxy.import.saved',
      entityType: 'proxy',
      metadata: { inserted: result.inserted, skipped: result.skipped, total: result.total },
    });
    return result;
  });

  app.post('/proxies/rebalance-assignments', async (req, reply) => {
    const user = await requirePermission(req, reply, 'proxies:import');
    if (!user) return;
    return rebalanceProxyAssignments(user);
  });

  app.post('/proxies/:id/test-connectivity', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const out = await testProxyConnectivity(id);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  // Bulk-test convenience: POST /proxies/test-connectivity { ids: number[] }
  app.post('/proxies/test-connectivity', async (req, reply) => {
    const body = req.body as { ids?: number[] };
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.code(400).send({ error: 'invalid_body', message: 'ids[] required' });
    }
    if (body.ids.length > 50) {
      return reply.code(400).send({ error: 'too_many', message: 'max 50 per call' });
    }
    const results = [];
    for (const id of body.ids) {
      results.push(await testProxyConnectivity(id));
    }
    return { results: results.filter(Boolean) };
  });

  app.post('/proxies/:id/status', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const out = await setProxyStatus(id, parsed.data.status);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });
}
