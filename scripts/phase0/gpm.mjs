// gpm.mjs — Wrapper cho GPMLoginGlobal Local API.
// Doc chính thức: https://github.com/GPMSoft/GPMLoginGlobalApiDocs
//
// API endpoints (v1) — verified từ docs/profiles.md:
//   GET  /                                       → banner
//   GET  /api/v1/profiles?page&per_page&search&sort
//   GET  /api/v1/profiles/{id}
//   POST /api/v1/profiles/create                  body: ProfileRequest
//   POST /api/v1/profiles/update/{id}             body: ProfileRequest
//   GET  /api/v1/profiles/delete/{id}?mode=soft|hard
//   GET  /api/v1/profiles/start/{id}?remote_debugging_port&window_scale&window_pos&window_size&addition_args
//   GET  /api/v1/profiles/stop/{id}
//   /api/v1/groups, /api/v1/proxies, /api/v1/extensions — CRUD tương tự
//
// Lưu ý quan trọng:
//   - GPMLoginGlobal là phiên bản MỚI, KHÔNG cùng API path với GPMLogin cũ (vốn dùng /api/v3).
//   - Port mặc định: 9495 (xem trong Settings → API Gateway của app).
//   - Endpoint cụ thể trong v1 (start/close/list) tham khảo doc github.

import http from 'node:http';

// Các port phổ biến — sắp xếp theo xác suất (mới nhất trước).
const DEFAULT_PORTS = [9495, 19995, 19999, 19996, 8080];
const DEFAULT_HOSTS = ['127.0.0.1'];

/**
 * HTTP JSON request đơn giản (Node 18+ có thể dùng fetch, nhưng dùng http giảm overhead).
 */
export function httpJson(url, { method = 'GET', body, timeoutMs = 10000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(data ? { 'Content-Length': data.length } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
          resolve({ status: res.statusCode, headers: res.headers, body: json ?? text });
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error(`timeout ${timeoutMs}ms`)); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Detect xem endpoint có phải GPMLogin Global API không thông qua banner ở "/".
 * Banner: { success: true, data: "GPMLogin Global API", sender: "GPMLoginGlobal vX.Y.Z" }
 */
async function isGPMEndpoint(baseUrl) {
  try {
    const r = await httpJson(`${baseUrl}/`, { timeoutMs: 1500 });
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') return null;
    const banner = r.body;
    const isGPM =
      banner.sender?.toString().toLowerCase().includes('gpmlogin') ||
      banner.data?.toString().toLowerCase().includes('gpmlogin');
    if (!isGPM) return null;
    return {
      sender: banner.sender ?? null,
      banner: banner.data ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Tìm GPMLogin endpoint đang chạy.
 * Strategy:
 *   1. Probe banner "/" trên các port phổ biến.
 *   2. Nếu match GPMLogin → verify thêm bằng cách gọi list profile.
 */
export async function discoverGPM({ hosts = DEFAULT_HOSTS, ports = DEFAULT_PORTS, apiKey } = {}) {
  for (const host of hosts) {
    for (const port of ports) {
      const baseUrl = `http://${host}:${port}`;
      const banner = await isGPMEndpoint(baseUrl);
      if (!banner) continue;

      // Verify list endpoint thật sự work
      const listUrl = `${baseUrl}/api/v1/profiles?page=1&per_page=1`;
      try {
        const r = await httpJson(listUrl, {
          timeoutMs: 5000,
          headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
        });
        // Response GPMLoginGlobal v1: { success, data: { current_page, per_page, total, last_page, data: [...] }, message, sender }
        const list = Array.isArray(r.body?.data?.data) ? r.body.data.data : null;
        if (r.status === 200 && r.body?.success && list) {
          return {
            baseUrl,
            prefix: '/api/v1',
            sender: banner.sender,
            banner: banner.banner,
            listEndpoint: listUrl,
            sampleResponse: r.body,
            total: r.body.data.total,
          };
        }
        return {
          baseUrl,
          prefix: '/api/v1',
          sender: banner.sender,
          banner: banner.banner,
          listEndpoint: listUrl,
          sampleResponse: r.body,
          warning: `List endpoint structure lạ. Body: ${JSON.stringify(r.body).slice(0, 200)}`,
        };
      } catch (e) {
        return {
          baseUrl,
          prefix: '/api/v1',
          sender: banner.sender,
          banner: banner.banner,
          warning: `List endpoint lỗi: ${e.message}`,
        };
      }
    }
  }
  return null;
}

/**
 * Client gọi GPMLogin API sau khi đã discover được endpoint.
 */
export class GPMClient {
  constructor({ baseUrl, prefix = '/api/v1', apiKey } = {}) {
    if (!baseUrl) throw new Error('baseUrl required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.prefix = prefix;
    this.headers = apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {};
  }

  url(p) { return `${this.baseUrl}${this.prefix}${p}`; }

  /**
   * GET /api/v1/profiles
   * Params: group_id, page, per_page, sort, search
   * Raw response: { success, data: { current_page, per_page, total, last_page, data: [...] }, message, sender }
   * Trả về normalized: { items, total, page, perPage, lastPage, raw }
   */
  async listProfiles({ groupId, page = 1, perPage = 50, sort, search } = {}) {
    const qs = new URLSearchParams();
    if (groupId) qs.set('group_id', groupId);
    qs.set('page', String(page));
    qs.set('per_page', String(perPage));
    if (sort !== undefined) qs.set('sort', String(sort));
    if (search) qs.set('search', search);

    const r = await httpJson(`${this.url('/profiles')}?${qs.toString()}`, { headers: this.headers });
    if (r.status !== 200) throw new Error(`listProfiles HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    if (!r.body?.success) throw new Error(`listProfiles failed: ${JSON.stringify(r.body)}`);

    const d = r.body.data ?? {};
    const items = Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []);
    return {
      items,
      total: d.total ?? items.length,
      page: d.current_page ?? page,
      perPage: d.per_page ?? perPage,
      lastPage: d.last_page ?? 1,
      raw: r.body,
    };
  }

  /**
   * GET /api/v1/profiles/{id}
   */
  async getProfile(profileId) {
    const r = await httpJson(this.url(`/profiles/${encodeURIComponent(profileId)}`), { headers: this.headers });
    if (r.status !== 200 || !r.body?.success) throw new Error(`getProfile failed: ${JSON.stringify(r.body)}`);
    return r.body.data;
  }

  /**
   * GET /api/v1/profiles/start/{id}
   * Optional query: addination_args, win_scale, win_pos, win_size
   * Response data: { profile_id, browser_location, remote_debugging_address, driver_path }
   *   - remote_debugging_address dạng "127.0.0.1:53378"
   */
  async startProfile(profileId, opts = {}) {
    const qs = new URLSearchParams();
    if (opts.remoteDebuggingPort !== undefined) qs.set('remote_debugging_port', String(opts.remoteDebuggingPort));
    // Chấp nhận cả camelCase và snake_case cho tiện
    const winScale = opts.windowScale ?? opts.window_scale ?? opts.win_scale;
    const winPos = opts.windowPos ?? opts.window_pos ?? opts.win_pos;
    const winSize = opts.windowSize ?? opts.window_size ?? opts.win_size;
    const addArgs = opts.additionArgs ?? opts.addition_args ?? opts.addination_args;
    if (winScale !== undefined) qs.set('window_scale', String(winScale));
    if (winPos) qs.set('window_pos', winPos);
    if (winSize) qs.set('window_size', winSize);
    if (addArgs) qs.set('addition_args', addArgs);
    const queryStr = qs.toString();
    const url = this.url(`/profiles/start/${encodeURIComponent(profileId)}`) + (queryStr ? `?${queryStr}` : '');

    const r = await httpJson(url, { method: 'GET', headers: this.headers, timeoutMs: 60000 });
    if (r.status !== 200 || !r.body) throw new Error(`startProfile HTTP ${r.status}: ${JSON.stringify(r.body)}`);
    if (!r.body.success) throw new Error(`startProfile failed: ${JSON.stringify(r.body)}`);

    const data = r.body.data ?? {};
    // GPMLoginGlobal v1: { websocket_debugging_url, remote_debugging_port, driver_path, addition_info: {...} }
    // (Bản v3 cũ: remote_debugging_address dạng "host:port")
    const wsEndpoint =
      data.websocket_debugging_url ||
      (data.remote_debugging_port ? `ws://127.0.0.1:${data.remote_debugging_port}` : null);
    const remote =
      data.remote_debugging_address ||
      (data.remote_debugging_port ? `127.0.0.1:${data.remote_debugging_port}` : null);

    if (!wsEndpoint && !remote) {
      throw new Error(`startProfile: thiếu cả websocket_debugging_url lẫn remote_debugging_port. data=${JSON.stringify(data)}`);
    }
    return {
      raw: r.body,
      profileId: data.profile_id ?? profileId,
      wsEndpoint,                                  // ws://... (puppeteer connect được luôn)
      remote,                                      // "host:port" (fallback nếu chỉ có port)
      port: data.remote_debugging_port ?? null,
      browserLocation: data.browser_location,
      driverPath: data.driver_path,
      processId: data.addition_info?.process_id ?? null,
      profileName: data.addition_info?.profile_name ?? null,
    };
  }

  /**
   * GET /api/v1/profiles/stop/{id}  — dừng trình duyệt (không xóa profile)
   */
  async closeProfile(profileId) {
    const r = await httpJson(this.url(`/profiles/stop/${encodeURIComponent(profileId)}`), {
      method: 'GET', headers: this.headers, timeoutMs: 30000,
    });
    // Idempotent: nếu profile đã đóng từ trước, server trả success=false nhưng OK.
    // Chỉ throw khi response không hợp lệ (vd banner GPMLogin Global API).
    if (!r.body || typeof r.body !== 'object' || r.body.data === 'GPMLogin Global API') {
      throw new Error(`closeProfile invalid response: ${JSON.stringify(r.body)}`);
    }
    return { success: true, alreadyClosed: !r.body.success, raw: r.body };
  }
}

/**
 * Convert "host:port" → ws://host:port/devtools/browser/<id>
 * Sử dụng /json/version để lấy webSocketDebuggerUrl mà puppeteer-core cần.
 */
export async function resolveWsEndpoint(remote) {
  if (!remote) throw new Error('empty remote address');
  if (remote.startsWith('ws://') || remote.startsWith('wss://')) return remote;
  const r = await httpJson(`http://${remote}/json/version`, { timeoutMs: 10000 });
  if (r.status !== 200 || !r.body || !r.body.webSocketDebuggerUrl) {
    throw new Error(`resolve ws endpoint failed for ${remote}: ${JSON.stringify(r.body)}`);
  }
  return r.body.webSocketDebuggerUrl;
}
