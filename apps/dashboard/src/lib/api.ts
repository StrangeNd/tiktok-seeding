const BASE = '/api';

function getApiKey(): string {
  return localStorage.getItem('apiKey') ?? '';
}

export function setApiKey(key: string): void {
  localStorage.setItem('apiKey', key);
}

export function getStoredApiKey(): string {
  return getApiKey();
}

export function clearApiKey(): void {
  localStorage.removeItem('apiKey');
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'x-api-key': getApiKey(),
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (options.body && typeof options.body === 'string') {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// Health
export interface HealthResponse {
  ok: boolean;
  ts: string;
}

export interface DeepHealthResponse {
  ok: boolean;
  checks: Record<string, { ok: boolean; error?: string }>;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request('/health');
}

export function fetchDeepHealth(): Promise<DeepHealthResponse> {
  return request('/health/deep');
}

// Profiles
export interface Profile {
  id: string;
  name: string;
  browserType: string | null;
  browserVersion: string | null;
  groupId: string | null;
  rawProxy: string | null;
  status: string;
  lastUsedAt: string | null;
  syncedAt: string;
  createdAt: string;
}

export interface ProfileSummary {
  total: number;
  summary: Record<string, number>;
}

export function fetchProfiles(): Promise<{ profiles: Profile[] }> {
  return request('/profiles');
}

export function fetchProfileSummary(): Promise<ProfileSummary> {
  return request('/profiles/summary');
}

export function syncProfiles(): Promise<{ total: number; upserted: number }> {
  return request('/admin/sync-profiles', { method: 'POST' });
}

// Orders
export interface Order {
  id: number;
  type: string;
  targetUrl: string;
  count: number;
  watchSeconds: number;
  spreadSeconds: number;
  status: string;
  completedJobs: number;
  failedJobs: number;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Job {
  id: number;
  status: string;
  profileId: string;
  attempt: number;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export function fetchOrders(): Promise<{ orders: Order[] }> {
  return request('/orders');
}

export function fetchOrder(id: number): Promise<{ order: Order; jobs: Job[] }> {
  return request(`/orders/${id}`);
}

export interface CreateOrderPayload {
  type: 'live_view';
  targetUrl: string;
  count: number;
  watchSeconds: number;
  spreadSeconds?: number;
}

export function createOrder(payload: CreateOrderPayload): Promise<unknown> {
  return request('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Workers
export interface Worker {
  name: string;
  capacity: number;
  currentLoad: number;
  version: string | null;
  lastSeenAt: string;
}

export function fetchWorkers(): Promise<{ workers: Worker[] }> {
  return request('/workers');
}

// Admin
export function resetStuckProfiles(): Promise<{ released: number; ids: string[] }> {
  return request('/admin/reset-stuck-profiles', { method: 'POST' });
}
