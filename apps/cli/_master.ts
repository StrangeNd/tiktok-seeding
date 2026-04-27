import { loadEnv } from '@app/shared';

const env = loadEnv();
const baseUrl = `http://127.0.0.1:${env.MASTER_PORT}`;

export async function masterFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const needsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const body = init.body ?? (needsBody ? '{}' : undefined);

  let r: Response;
  try {
    r = await fetch(`${baseUrl}${path}`, {
      ...init,
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.MASTER_API_KEY,
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      console.error(`\nERROR: Cannot reach master at ${baseUrl}`);
      console.error('Is the master running? Start it with: pnpm master');
      console.error(`Check: curl ${baseUrl}/health\n`);
      process.exit(1);
    }
    throw err;
  }

  if (!r.ok) {
    const text = await r.text();
    if (r.status === 401) {
      console.error('\nERROR: Unauthorized (HTTP 401). Check MASTER_API_KEY in .env');
      process.exit(1);
    }
    throw new Error(`${method} ${path} HTTP ${r.status}: ${text}`);
  }
  return r;
}
