import { GPMError, GPMProfileInUseError } from './errors.js';
import { httpJson } from './http.js';
import type {
  GPMApiResponse,
  GPMListProfilesParams,
  GPMListResponse,
  GPMPagedData,
  GPMProfile,
  GPMStartProfileOptions,
  GPMStartProfileRawData,
  GPMStartProfileResult,
} from './types.js';

export interface GPMClientOptions {
  baseUrl: string;
  prefix?: string;
  apiKey?: string;
  /** Default timeout cho mọi request không phải startProfile. */
  timeoutMs?: number;
}

/**
 * Wrapper type-safe cho GPMLoginGlobal Local API v1.
 * Doc: https://github.com/GPMSoft/GPMLoginGlobalApiDocs
 */
export class GPMClient {
  private readonly baseUrl: string;
  private readonly prefix: string;
  private readonly headers: Record<string, string>;
  private readonly defaultTimeoutMs: number;

  constructor(opts: GPMClientOptions) {
    if (!opts.baseUrl) throw new Error('GPMClient: baseUrl required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.prefix = opts.prefix ?? '/api/v1';
    const headers: Record<string, string> = {};
    if (opts.apiKey) {
      headers['X-API-Key'] = opts.apiKey;
      headers.Authorization = `Bearer ${opts.apiKey}`;
    }
    this.headers = headers;
    this.defaultTimeoutMs = opts.timeoutMs ?? 10_000;
  }

  private url(p: string): string {
    return `${this.baseUrl}${this.prefix}${p}`;
  }

  /** GET /api/v1/profiles — paged list */
  async listProfiles(params: GPMListProfilesParams = {}): Promise<GPMListResponse<GPMProfile>> {
    const qs = new URLSearchParams();
    if (params.groupId) qs.set('group_id', params.groupId);
    qs.set('page', String(params.page ?? 1));
    qs.set('per_page', String(params.perPage ?? 30));
    if (params.sort !== undefined) qs.set('sort', String(params.sort));
    if (params.search) qs.set('search', params.search);

    const r = await httpJson<GPMApiResponse<GPMPagedData<GPMProfile>>>(
      `${this.url('/profiles')}?${qs.toString()}`,
      { headers: this.headers, timeoutMs: this.defaultTimeoutMs },
    );
    if (r.status !== 200) {
      throw new GPMError(`listProfiles HTTP ${r.status}`, { status: r.status, raw: r.body });
    }
    if (!r.body?.success) {
      throw new GPMError('listProfiles failed', { raw: r.body });
    }
    const d = r.body.data;
    const items = Array.isArray(d?.data) ? d.data : [];
    return {
      items,
      total: d?.total ?? items.length,
      page: d?.current_page ?? params.page ?? 1,
      perPage: d?.per_page ?? params.perPage ?? 30,
      lastPage: d?.last_page ?? 1,
    };
  }

  /** GET /api/v1/profiles/{id} */
  async getProfile(id: string): Promise<GPMProfile> {
    const r = await httpJson<GPMApiResponse<GPMProfile>>(
      this.url(`/profiles/${encodeURIComponent(id)}`),
      { headers: this.headers, timeoutMs: this.defaultTimeoutMs },
    );
    if (r.status !== 200 || !r.body?.success) {
      throw new GPMError(`getProfile failed for ${id}`, { status: r.status, raw: r.body });
    }
    return r.body.data;
  }

  /**
   * GET /api/v1/profiles/start/{id}
   * Throws GPMProfileInUseError nếu profile đang được dùng (caller nên backoff retry).
   */
  async startProfile(
    id: string,
    options: GPMStartProfileOptions = {},
  ): Promise<GPMStartProfileResult> {
    const qs = new URLSearchParams();
    if (options.remoteDebuggingPort !== undefined)
      qs.set('remote_debugging_port', String(options.remoteDebuggingPort));
    if (options.windowScale !== undefined) qs.set('window_scale', String(options.windowScale));
    if (options.windowPos) qs.set('window_pos', options.windowPos);
    if (options.windowSize) qs.set('window_size', options.windowSize);
    if (options.additionArgs) qs.set('addition_args', options.additionArgs);
    const queryStr = qs.toString();
    const url =
      this.url(`/profiles/start/${encodeURIComponent(id)}`) + (queryStr ? `?${queryStr}` : '');

    const r = await httpJson<GPMApiResponse<GPMStartProfileRawData>>(url, {
      method: 'GET',
      headers: this.headers,
      timeoutMs: 60_000, // GPM start có thể tốn 2-30s khi nhiều profile cùng lúc
    });
    if (r.status !== 200 || !r.body) {
      throw new GPMError(`startProfile HTTP ${r.status}`, { status: r.status, raw: r.body });
    }
    if (!r.body.success) {
      const msg = r.body.message ?? '';
      if (/ProfileInUse/i.test(msg)) {
        throw new GPMProfileInUseError(id, r.body);
      }
      throw new GPMError(`startProfile failed: ${msg}`, { raw: r.body });
    }

    const data = r.body.data;
    const wsEndpoint =
      data.websocket_debugging_url ||
      (data.remote_debugging_port ? `ws://127.0.0.1:${data.remote_debugging_port}` : '');
    if (!wsEndpoint) {
      throw new GPMError(
        `startProfile: thiếu websocket_debugging_url và remote_debugging_port. data=${JSON.stringify(data)}`,
        { raw: r.body },
      );
    }

    return {
      profileId: data.profile_id || id,
      wsEndpoint,
      remote: data.remote_debugging_port ? `127.0.0.1:${data.remote_debugging_port}` : '',
      port: data.remote_debugging_port ?? 0,
      driverPath: data.driver_path,
      processId: data.addition_info?.process_id ?? null,
      profileName: data.addition_info?.profile_name ?? null,
      raw: data,
    };
  }

  /**
   * GET /api/v1/profiles/stop/{id}
   * Idempotent: nếu đã đóng từ trước, server trả success=false nhưng OK → coi như thành công.
   */
  async closeProfile(id: string): Promise<{ alreadyClosed: boolean }> {
    const r = await httpJson<GPMApiResponse<unknown>>(
      this.url(`/profiles/stop/${encodeURIComponent(id)}`),
      { method: 'GET', headers: this.headers, timeoutMs: 30_000 },
    );
    if (
      !r.body ||
      typeof r.body !== 'object' ||
      (r.body as GPMApiResponse<string>).data === 'GPMLogin Global API'
    ) {
      throw new GPMError('closeProfile: invalid response (banner)', { raw: r.body });
    }
    return { alreadyClosed: !r.body.success };
  }
}
