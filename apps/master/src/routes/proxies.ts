import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildProxyImportPreview,
  getProxiesSummary,
  importProxiesFromText,
  listProxies,
  setProxyStatus,
  testProxyConnectivity,
} from '../services/proxies.js';

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
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    return buildProxyImportPreview(parsed.data.text);
  });

  app.post('/proxies/import', async (req, reply) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    return importProxiesFromText(parsed.data.text);
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
