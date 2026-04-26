// Types cho GPMLoginGlobal Local API v1.
// Reference: https://github.com/GPMSoft/GPMLoginGlobalApiDocs

/** Response envelope chuẩn của GPMLoginGlobal */
export interface GPMApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message: string | null;
  sender: string; // "GPMLoginGlobal v0.3.0-beta" / "v1.0.0"
}

/** Pagination wrapper cho list endpoints */
export interface GPMPagedData<T> {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  data: T[];
}

export interface GPMProfileBrowser {
  name: string; // "chrome" | "firefox"
  version: string;
}

/** Profile object trả về từ /api/v1/profiles */
export interface GPMProfile {
  id: string; // UUID
  name: string;
  group_id: string | null;
  storage_path: string;
  raw_proxy: string;
  browser: GPMProfileBrowser;
  os: string; // "windows" | "macos" | ...
  note: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface GPMListProfilesParams {
  groupId?: string;
  page?: number;
  perPage?: number;
  search?: string;
  /** 0 = newest first, 1 = oldest first, 2 = name A-Z, 3 = name Z-A */
  sort?: 0 | 1 | 2 | 3;
}

/** Normalized list result mà client trả ra (sau khi parse pagination wrapper) */
export interface GPMListResponse<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export interface GPMStartProfileOptions {
  /** CDP debugging port. 0 = auto. */
  remoteDebuggingPort?: number;
  /** Window scale, vd 0.8 = 80% */
  windowScale?: number;
  /** "x,y" */
  windowPos?: string;
  /** "width,height" */
  windowSize?: string;
  /** Extra Chrome command-line args */
  additionArgs?: string;
}

/** Raw response data từ /profiles/start/{id} */
export interface GPMStartProfileRawData {
  profile_id: string;
  driver_path: string;
  remote_debugging_port: number;
  /** Có ở v0.3.0-beta+; có thể vắng ở v1.0.0 stable. */
  websocket_debugging_url?: string;
  addition_info?: {
    process_id: number;
    profile_name: string;
    window_handle: number;
    exec_time?: number;
  };
}

/** Normalized result mà client trả ra (đã extract wsEndpoint) */
export interface GPMStartProfileResult {
  profileId: string;
  /** ws://... — puppeteer.connect dùng được luôn. */
  wsEndpoint: string;
  /** "host:port" — fallback nếu cần resolve qua /json/version */
  remote: string;
  port: number;
  driverPath: string;
  processId: number | null;
  profileName: string | null;
  raw: GPMStartProfileRawData;
}
