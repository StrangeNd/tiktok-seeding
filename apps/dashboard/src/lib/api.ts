// Thin fetch wrapper around the master REST API.
//
// Auth: dashboard uses HttpOnly session cookies. x-api-key remains optional for internal/API-key flows.

import { useAuth } from '../store/auth';
import { getMasterUrl } from './config';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Throw on non-2xx (default true). Set false to inspect status manually. */
  throwOnError?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, throwOnError = true } = opts;
  const url = `${getMasterUrl()}${path}`;
  const apiKey = useAuth.getState().apiKey;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) headers['x-api-key'] = apiKey;

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body:
      body !== undefined
        ? JSON.stringify(body)
        : ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())
          ? '{}'
          : undefined,
    signal,
  });

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    // Auto-logout on 401
    if (res.status === 401 && apiKey) {
      useAuth.getState().logout();
    }
    if (throwOnError) {
      const msg =
        (parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : null) || `HTTP ${res.status}`;
      throw new ApiError(res.status, msg, parsed);
    }
  }
  return parsed as T;
}

// Auth probe used at login.
export async function checkAuth(masterUrl: string, apiKey: string): Promise<boolean> {
  const res = await fetch(`${masterUrl.replace(/\/+$/, '')}/auth/check`, {
    headers: { 'x-api-key': apiKey },
    credentials: 'include',
  });
  return res.status === 200;
}

export interface CurrentUser {
  id: number;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'pending' | 'disabled';
  permissions: string[];
}

export async function loginWithPassword(masterUrl: string, username: string, password: string) {
  const res = await fetch(`${masterUrl.replace(/\/+$/, '')}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  return body as { user: CurrentUser };
}

export async function registerUser(
  masterUrl: string,
  input: { username: string; displayName?: string; password: string },
) {
  const res = await fetch(`${masterUrl.replace(/\/+$/, '')}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  return body as { user: CurrentUser; firstAdmin: boolean };
}
