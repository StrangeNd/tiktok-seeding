// Master URL is settable at runtime (Settings page) and falls back to the
// build-time default injected by vite.config.ts.

declare const __MASTER_URL__: string;

const STORAGE_KEY = 'seedingops:master_url';

export function getMasterUrl(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v?.trim()) return v.trim().replace(/\/+$/, '');
  } catch {
    // ignore
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((typeof __MASTER_URL__ !== 'undefined' && __MASTER_URL__) ||
    'http://127.0.0.1:7000') as string;
}

export function setMasterUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/+$/, ''));
}
