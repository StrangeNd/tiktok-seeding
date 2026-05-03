import { loadEnv } from '@app/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildAccountImportPreview,
  getAccount,
  getAccountSecretsForMailbox,
  getAccountsSummary,
  importAccountsFromText,
  listAccounts,
  setAccountStatus,
  updateAccountState,
} from '../services/accounts.js';
import { writeAuditLog } from '../services/audit.js';
import { MailCodeError, getLatestCodeForAccount } from '../services/mail-code.js';
import { requirePermission } from './auth.js';

/**
 * Guard for internal worker-only endpoints. Only the master API key may call these
 * — never a dashboard session — because they expose decrypted credentials.
 */
function requireInternalApiKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const env = loadEnv();
  if (req.headers['x-api-key'] === env.MASTER_API_KEY) return true;
  reply.code(401).send({ error: 'unauthorized' });
  return false;
}

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
    const user = await requirePermission(req, reply, 'accounts:import');
    if (!user) return;
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const result = await buildAccountImportPreview(parsed.data.text);
    await writeAuditLog({
      actor: user,
      action: 'account.import.preview',
      entityType: 'account',
      metadata: { total: result.total, valid: result.valid, invalid: result.invalid },
    });
    return result;
  });

  app.post('/accounts/import', async (req, reply) => {
    const user = await requirePermission(req, reply, 'accounts:import');
    if (!user) return;
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const result = await importAccountsFromText(parsed.data.text);
    await writeAuditLog({
      actor: user,
      action: 'account.import.saved',
      entityType: 'account',
      metadata: { inserted: result.inserted, skipped: result.skipped, total: result.total },
    });
    return result;
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

  // ---------------------------------------------------------------------------
  // Internal worker-only endpoints. Auth: MASTER_API_KEY only.
  //
  // These return decrypted secret material and MUST NOT be exposed to the
  // dashboard or any user-bearer-token caller. Each handler explicitly enforces
  // the API key check via `requireInternalApiKey`.
  // ---------------------------------------------------------------------------

  /**
   * GET /internal/accounts/:id/login-credentials
   * Worker uses this to fetch decrypted username/password (and optional cookie)
   * before driving an auto-login flow on the GPM browser.
   */
  app.get('/internal/accounts/:id/login-credentials', async (req, reply) => {
    if (!requireInternalApiKey(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    try {
      const { account, secrets } = await getAccountSecretsForMailbox(id);
      if (!secrets.pass) {
        return reply.code(404).send({ error: 'missing_password' });
      }
      await writeAuditLog({
        actor: {
          id: 0,
          username: 'internal-worker',
          displayName: 'Internal Worker',
          role: 'admin',
          status: 'active',
          permissions: [],
        },
        action: 'account.login_credentials.fetched',
        entityType: 'account',
        entityId: id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      return {
        username: account.username,
        password: secrets.pass,
        cookie: secrets.cookie,
      };
    } catch (e) {
      if ((e as Error).message === 'account_not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply
        .code(500)
        .send({ error: 'login_credentials_failed', message: (e as Error).message });
    }
  });

  /**
   * POST /internal/accounts/:id/mail-code
   * Worker uses this when TikTok login flow asks for a 2FA / verification code
   * delivered to the linked mailbox. Wraps `getLatestCodeForAccount` with API-key auth.
   */
  app.post('/internal/accounts/:id/mail-code', async (req, reply) => {
    if (!requireInternalApiKey(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const exists = await getAccount(id);
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    try {
      const result = await getLatestCodeForAccount(id);
      await writeAuditLog({
        actor: {
          id: 0,
          username: 'internal-worker',
          displayName: 'Internal Worker',
          role: 'admin',
          status: 'active',
          permissions: [],
        },
        action: 'mail_code.requested.internal',
        entityType: 'account',
        entityId: id,
        metadata: { provider: result.provider, receivedAt: result.receivedAt },
      });
      return result;
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

  /**
   * PATCH /internal/accounts/:id/login-result
   * Worker reports the outcome of an auto-login attempt so master can update
   * `cookie_status` / `last_error`. Body shape mirrors the worker's `LoginReport`.
   */
  app.patch('/internal/accounts/:id/login-result', async (req, reply) => {
    if (!requireInternalApiKey(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = z
      .object({
        ok: z.boolean(),
        cookieStatus: z.enum(['unknown', 'present', 'missing', 'needs_reauth', 'dead']),
        error: z.string().max(500).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const out = await updateAccountState(id, {
      cookieStatus: parsed.data.cookieStatus,
      lastError: parsed.data.error ?? null,
    });
    if (!out) return reply.code(404).send({ error: 'not_found' });
    await writeAuditLog({
      actor: {
        id: 0,
        username: 'internal-worker',
        displayName: 'Internal Worker',
        role: 'admin',
        status: 'active',
        permissions: [],
      },
      action: parsed.data.ok ? 'account.auto_login.success' : 'account.auto_login.failed',
      entityType: 'account',
      entityId: id,
      metadata: { cookieStatus: parsed.data.cookieStatus, error: parsed.data.error ?? null },
    });
    return out;
  });

  app.post('/accounts/:id/mail-code', async (req, reply) => {
    const user = await requirePermission(req, reply, 'accounts:view_masked');
    if (!user) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const exists = await getAccount(id);
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    try {
      const result = await getLatestCodeForAccount(id);
      await writeAuditLog({
        actor: user,
        action: 'mail_code.requested',
        entityType: 'account',
        entityId: id,
        metadata: { provider: result.provider, receivedAt: result.receivedAt },
      });
      return result;
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
