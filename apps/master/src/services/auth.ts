import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { loadEnv } from '@app/shared';
import { and, sql as drizzleSql, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { type Permission, type UserRole, permissionsForRole } from './permissions.js';

const scrypt = promisify(scryptCb);
const SESSION_DAYS = 7;

export type UserStatus = 'active' | 'pending' | 'disabled';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  permissions: Permission[];
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const actual = Buffer.from(hash, 'base64url');
  const candidate = (await scrypt(password, salt, actual.length)) as Buffer;
  return candidate.length === actual.length && timingSafeEqual(candidate, actual);
}

export function hashSessionToken(token: string): string {
  const env = loadEnv();
  return createHash('sha256').update(`${env.AUTH_SESSION_SECRET}:${token}`).digest('hex');
}

export function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  const role = row.role === 'admin' ? 'admin' : 'user';
  const status = row.status === 'pending' || row.status === 'disabled' ? row.status : 'active';
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role,
    status,
    permissions: permissionsForRole(role),
  };
}

export async function countUsers(): Promise<number> {
  const [row] = await db.select({ count: drizzleSql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}

export async function createUser(input: {
  username: string;
  displayName?: string;
  password: string;
  role?: UserRole;
  status?: UserStatus;
}): Promise<AuthUser> {
  const username = normalizeUsername(input.username);
  const displayName = (input.displayName?.trim() || username).slice(0, 80);
  const [row] = await db
    .insert(users)
    .values({
      username,
      displayName,
      passwordHash: await hashPassword(input.password),
      role: input.role ?? 'user',
      status: input.status ?? 'active',
    })
    .returning();
  if (!row) throw new Error('user_create_failed');
  return toAuthUser(row);
}

export async function registerUser(input: {
  username: string;
  displayName?: string;
  password: string;
}): Promise<{ user: AuthUser; firstAdmin: boolean }> {
  const env = loadEnv();
  const existing = await countUsers();
  if (existing > 0 && !env.AUTH_ALLOW_SELF_REGISTER) throw new Error('self_register_disabled');
  const firstAdmin = existing === 0;
  const status: UserStatus = firstAdmin || !env.AUTH_REQUIRE_ADMIN_APPROVAL ? 'active' : 'pending';
  const user = await createUser({
    username: input.username,
    displayName: input.displayName,
    password: input.password,
    role: firstAdmin ? 'admin' : 'user',
    status,
  });
  return { user, firstAdmin };
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

export async function getUserBySessionToken(
  token: string | null | undefined,
): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const user = toAuthUser(row.user);
  return user.status === 'active' ? user : user;
}

export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db
    .update(sessions)
    .set({ revokedAt: drizzleSql`now()` })
    .where(eq(sessions.tokenHash, hashSessionToken(token)));
}

export async function loginUser(username: string, password: string): Promise<AuthUser> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.username, normalizeUsername(username)))
    .limit(1);
  if (!row || !(await verifyPassword(password, row.passwordHash))) throw new Error('invalid_login');
  const user = toAuthUser(row);
  if (user.status !== 'active') throw new Error(`user_${user.status}`);
  await db.update(users).set({ lastLoginAt: drizzleSql`now()` }).where(eq(users.id, user.id));
  return user;
}

export async function listUsers() {
  const rows = await db.select().from(users).orderBy(users.id);
  return {
    items: rows.map((row) => {
      const user = toAuthUser(row);
      return {
        ...user,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      };
    }),
  };
}

export async function updateUser(id: number, patch: { role?: UserRole; status?: UserStatus }) {
  const [row] = await db
    .update(users)
    .set({ ...patch, updatedAt: drizzleSql`now()` })
    .where(eq(users.id, id))
    .returning();
  return row ? toAuthUser(row) : null;
}
