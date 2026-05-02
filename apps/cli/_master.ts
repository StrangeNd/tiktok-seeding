import { loadEnv } from '@app/shared';

const env = loadEnv();
const baseUrl = env.MASTER_URL ?? `http://127.0.0.1:${env.MASTER_PORT}`;

export async function masterFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const needsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const body = init.body ?? (needsBody ? '{}' : undefined);
  const r = await fetch(`${baseUrl}${path}`, {
    ...init,
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.MASTER_API_KEY,
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${init.method ?? 'GET'} ${path} HTTP ${r.status}: ${text}`);
  }
  return r;
}
