import { loadEnv } from '@app/shared';

const env = loadEnv();
const masterUrl = env.MASTER_URL ?? `http://127.0.0.1:${env.MASTER_PORT}`;

async function postJson(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${masterUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.MASTER_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`master ${path} HTTP ${r.status}: ${await r.text()}`);
  }
  return r.json();
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
