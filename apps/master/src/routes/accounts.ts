import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildAccountImportPreview,
  getAccount,
  getAccountsSummary,
  importAccountsFromText,
  listAccounts,
  setAccountStatus,
  updateAccountState,
} from '../services/accounts.js';
import { MailCodeError, getLatestCodeForAccount } from '../services/mail-code.js';

const previewSchema = z.object({
  text: z.string().max(2_000_000),
});

const importSchema = z.object({
  text: z.string().max(2_000_000),
  confirm: z.literal(true),
});

const updateStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'broken', 'quarantined', 'archived']).optional(),
  cookieStatus: z.enum(['unknown', 'present', 'missing', 'needs_reauth', 'dead']).optional(),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/accounts', async (req) => {
    const q = req.query as { status?: string; limit?: string; offset?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    const offset = q.offset ? Number(q.offset) : 0;
    return listAccounts({ status: q.status, limit, offset });
  });

  app.get('/accounts/summary', async () => getAccountsSummary());

  app.get('/accounts/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const out = await getAccount(id);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  app.post('/accounts/import/preview', async (req, reply) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    return buildAccountImportPreview(parsed.data.text);
  });

  app.post('/accounts/import', async (req, reply) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    return importAccountsFromText(parsed.data.text);
  });

  app.patch('/accounts/:id/status', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    if (!parsed.data.status && !parsed.data.cookieStatus) {
      return reply
        .code(400)
        .send({ error: 'invalid_body', message: 'status or cookieStatus required' });
    }
    const out = await updateAccountState(id, parsed.data);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  app.post('/accounts/:id/status', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = z
      .object({ status: z.enum(['active', 'disabled', 'broken', 'quarantined', 'archived']) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const out = await setAccountStatus(id, parsed.data.status);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  app.post('/accounts/:id/mark-cookie-dead', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const out = await updateAccountState(id, { cookieStatus: 'dead' });
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  app.post('/accounts/:id/mail-code', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const exists = await getAccount(id);
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    try {
      return await getLatestCodeForAccount(id);
    } catch (e) {
      if (e instanceof MailCodeError) {
        const status =
          e.code === 'missing_oauth'
            ? 400
            : e.code === 'provider_unsupported'
              ? 400
              : e.code === 'rate_limited'
                ? 429
                : e.code === 'code_not_found'
                  ? 404
                  : 502;
        return reply.code(status).send({ error: e.code, message: e.message });
      }
      return reply.code(500).send({ error: 'mail_code_failed', message: 'mail_code_failed' });
    }
  });
}
