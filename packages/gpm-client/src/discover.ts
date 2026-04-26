import { httpJson } from './http.js';
import type { GPMApiResponse, GPMPagedData, GPMProfile } from './types.js';

const DEFAULT_PORTS = [9495, 19995, 19999, 19996, 8080] as const;
const DEFAULT_HOSTS = ['127.0.0.1'] as const;

export interface DiscoveryResult {
  baseUrl: string;
  prefix: string;
  sender: string | null;
  banner: string | null;
  total?: number;
  warning?: string;
}

interface BannerData {
  sender: string | null;
  banner: string | null;
}

async function probeBanner(baseUrl: string): Promise<BannerData | null> {
  try {
    const r = await httpJson<GPMApiResponse<string>>(`${baseUrl}/`, { timeoutMs: 1500 });
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') return null;
    const banner = r.body;
    const senderStr = String(banner.sender ?? '');
    const dataStr = String(banner.data ?? '');
    const isGpm =
      senderStr.toLowerCase().includes('gpmlogin') ||
      dataStr.toLowerCase().includes('gpmlogin');
    if (!isGpm) return null;
    return {
      sender: banner.sender,
      banner: dataStr || null,
    };
  } catch {
    return null;
  }
}

/**
 * Tìm GPMLoginGlobal Local API endpoint đang chạy trên máy.
 * Probe banner "/" trên các port phổ biến → verify list endpoint trả pagination chuẩn.
 */
export async function discoverGPM(opts: {
  hosts?: readonly string[];
  ports?: readonly number[];
  apiKey?: string;
} = {}): Promise<DiscoveryResult | null> {
  const hosts = opts.hosts ?? DEFAULT_HOSTS;
  const ports = opts.ports ?? DEFAULT_PORTS;
  const headers: Record<string, string> = {};
  if (opts.apiKey) {
    headers['X-API-Key'] = opts.apiKey;
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }

  for (const host of hosts) {
    for (const port of ports) {
      const baseUrl = `http://${host}:${port}`;
      const banner = await probeBanner(baseUrl);
      if (!banner) continue;

      const listUrl = `${baseUrl}/api/v1/profiles?page=1&per_page=1`;
      try {
        const r = await httpJson<GPMApiResponse<GPMPagedData<GPMProfile>>>(listUrl, {
          timeoutMs: 5_000,
          headers,
        });
        const isPaged =
          r.status === 200 &&
          r.body?.success &&
          r.body.data &&
          typeof r.body.data === 'object' &&
          Array.isArray((r.body.data as GPMPagedData<GPMProfile>).data);
        if (isPaged) {
          return {
            baseUrl,
            prefix: '/api/v1',
            sender: banner.sender,
            banner: banner.banner,
            total: (r.body.data as GPMPagedData<GPMProfile>).total,
          };
        }
        return {
          baseUrl,
          prefix: '/api/v1',
          sender: banner.sender,
          banner: banner.banner,
          warning: `List endpoint structure lạ: ${JSON.stringify(r.body).slice(0, 200)}`,
        };
      } catch (e) {
        return {
          baseUrl,
          prefix: '/api/v1',
          sender: banner.sender,
          banner: banner.banner,
          warning: `List endpoint lỗi: ${(e as Error).message}`,
        };
      }
    }
  }
  return null;
}
