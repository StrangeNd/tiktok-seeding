import { loadEnv } from '@app/shared';

const env = loadEnv();
const masterUrl = `http://127.0.0.1:${env.MASTER_PORT}`;

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'X-API-Key': env.MASTER_API_KEY };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${masterUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    throw new Error(`master ${method} ${path} HTTP ${r.status}: ${await r.text()}`);
  }
  // Master endpoints all return JSON; tolerate empty body for consistency.
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  return request('POST', path, body);
}

export async function reportJobStart(input: {
  jobId: number;
  workerName: string;
  attempt: number;
}): Promise<void> {
  await postJson('/jobs/start', input);
}

export async function reportJobFinish(input: {
  jobId: number;
  workerName: string;
  attempt: number;
  ok: boolean;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  willRetry?: boolean;
}): Promise<void> {
  await postJson('/jobs/finish', input);
}

export async function sendHeartbeat(input: {
  name: string;
  capacity: number;
  currentLoad: number;
  version: string;
}): Promise<void> {
  await postJson('/workers/heartbeat', input);
}

export interface LoginCredentials {
  username: string;
  password: string;
  cookie?: string;
}

/**
 * Fetch decrypted username/password (and optional cookie) for an account.
 * Worker calls this only when `checkLoginState` reports the GPM browser is
 * NOT logged in. The endpoint is API-key gated and never exposed to the dashboard.
 */
export async function fetchLoginCredentials(accountId: number): Promise<LoginCredentials> {
  const out = (await request('GET', `/internal/accounts/${accountId}/login-credentials`)) as {
    username: string;
    password: string;
    cookie?: string;
  } | null;
  if (!out) throw new Error('login_credentials_empty_response');
  return out;
}

export interface MailCodeResponse {
  code: string;
}

/**
 * Trigger master to fetch the latest verification code from the linked mailbox
 * for `accountId`. Master handles OAuth refresh + Graph search internally.
 */
export async function fetchMailCode(accountId: number): Promise<MailCodeResponse> {
  const out = (await request('POST', `/internal/accounts/${accountId}/mail-code`)) as {
    code: string;
  } | null;
  if (!out) throw new Error('mail_code_empty_response');
  return out;
}

export type CookieStatus = 'unknown' | 'present' | 'missing' | 'needs_reauth' | 'dead';

/**
 * Report the outcome of an auto-login attempt so master can persist
 * `cookie_status` / `last_error` on the account.
 */
export async function reportLoginResult(
  accountId: number,
  result: { ok: boolean; cookieStatus: CookieStatus; error?: string },
): Promise<void> {
  await request('PATCH', `/internal/accounts/${accountId}/login-result`, result);
}
