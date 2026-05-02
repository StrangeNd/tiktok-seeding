import { loadEnv } from '@app/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { writeAuditLog } from '../services/audit.js';
import {
  type AuthUser,
  type UserStatus,
  createSession,
  getUserBySessionToken,
  listUsers,
  loginUser,
  registerUser,
  revokeSession,
  updateUser,
} from '../services/auth.js';
import { type Permission, type UserRole, hasPermission } from '../services/permissions.js';

const COOKIE_NAME = 'seeding_session';
const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().max(80).optional(),
  password: z.string().min(8).max(200),
});
const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });
const patchUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  status: z.enum(['active', 'pending', 'disabled']).optional(),
});

export function getSessionToken(req: FastifyRequest): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.header(
    'set-cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`,
  );
}

function clearSessionCookie(reply: FastifyReply) {
  reply.header('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function getRequestUser(req: FastifyRequest): Promise<AuthUser | null> {
  return getUserBySessionToken(getSessionToken(req));
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const user = await getRequestUser(req);
  if (!user) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  if (user.status !== 'active') {
    reply.code(403).send({ error: `user_${user.status}` });
    return null;
  }
  return user;
}

export async function requirePermission(
  req: FastifyRequest,
  reply: FastifyReply,
  permission: Permission,
): Promise<AuthUser | null> {
  const env = loadEnv();
  if (req.headers['x-api-key'] === env.MASTER_API_KEY) {
    return {
      id: 0,
      username: 'internal-api-key',
      displayName: 'Internal API Key',
      role: 'admin',
      status: 'active',
      permissions: [
        'users:manage',
        'audit:view_all',
        'logs:view',
        'accounts:import',
        'accounts:view',
        'proxies:import',
        'proxies:view',
        'orders:create',
        'orders:view',
        'jobs:view',
        'dashboard:view',
        'admin:recovery',
        'backup:view_docs',
        'settings:view',
      ],
    };
  }
  const user = await requireAuth(req, reply);
  if (!user) return null;
  if (!hasPermission(user.role, permission)) {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return user;
}

function reqMeta(req: FastifyRequest) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] ?? null };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      const { user, firstAdmin } = await registerUser(parsed.data);
      await writeAuditLog({
        actor: user,
        action: 'user.registered',
        entityType: 'user',
        entityId: user.id,
        metadata: { firstAdmin, role: user.role, status: user.status },
        ...reqMeta(req),
      });
      return reply.code(201).send({ user, firstAdmin });
    } catch (e) {
      const msg = (e as Error).message;
      const status = msg.includes('duplicate') ? 409 : msg === 'self_register_disabled' ? 403 : 400;
      return reply.code(status).send({ error: msg });
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      const user = await loginUser(parsed.data.username, parsed.data.password);
      const session = await createSession(user.id);
      setSessionCookie(reply, session.token, session.expiresAt);
      await writeAuditLog({
        actor: user,
        action: 'user.login',
        entityType: 'user',
        entityId: user.id,
        ...reqMeta(req),
      });
      return { user };
    } catch (e) {
      return reply.code(401).send({ error: (e as Error).message || 'invalid_login' });
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const user = await getRequestUser(req);
    await revokeSession(getSessionToken(req));
    clearSessionCookie(reply);
    if (user)
      await writeAuditLog({
        actor: user,
        action: 'user.logout',
        entityType: 'user',
        entityId: user.id,
        ...reqMeta(req),
      });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const user = await getRequestUser(req);
    return { user: user?.status === 'active' ? user : null };
  });

  app.get('/admin/users', async (req, reply) => {
    const user = await requirePermission(req, reply, 'users:manage');
    if (!user) return;
    return listUsers();
  });

  app.patch('/admin/users/:id', async (req, reply) => {
    const actor = await requirePermission(req, reply, 'users:manage');
    if (!actor) return;
    const id = Number((req.params as { id: string }).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid_id' });
    const parsed = patchUserSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const updated = await updateUser(id, parsed.data as { role?: UserRole; status?: UserStatus });
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    await writeAuditLog({
      actor,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: parsed.data,
      ...reqMeta(req),
    });
    return { user: updated };
  });

  app.post('/admin/users/:id/approve', async (req, reply) => {
    const actor = await requirePermission(req, reply, 'users:manage');
    if (!actor) return;
    const id = Number((req.params as { id: string }).id);
    const updated = await updateUser(id, { status: 'active' });
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    await writeAuditLog({
      actor,
      action: 'user.approved',
      entityType: 'user',
      entityId: id,
      ...reqMeta(req),
    });
    return { user: updated };
  });

  app.post('/admin/users/:id/disable', async (req, reply) => {
    const actor = await requirePermission(req, reply, 'users:manage');
    if (!actor) return;
    const id = Number((req.params as { id: string }).id);
    const updated = await updateUser(id, { status: 'disabled' });
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    await writeAuditLog({
      actor,
      action: 'user.disabled',
      entityType: 'user',
      entityId: id,
      ...reqMeta(req),
    });
    return { user: updated };
  });

  app.post('/admin/users/:id/role', async (req, reply) => {
    const actor = await requirePermission(req, reply, 'users:manage');
    if (!actor) return;
    const id = Number((req.params as { id: string }).id);
    const parsed = z.object({ role: z.enum(['admin', 'user']) }).safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const updated = await updateUser(id, { role: parsed.data.role });
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    await writeAuditLog({
      actor,
      action: 'user.role_changed',
      entityType: 'user',
      entityId: id,
      metadata: { role: parsed.data.role },
      ...reqMeta(req),
    });
    return { user: updated };
  });
}
