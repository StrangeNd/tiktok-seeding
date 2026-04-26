// Domain types dùng chung giữa master, worker, và CLI scripts.

export type JobType = 'live_view'; // Phase 1: chỉ live view; Phase 2+ sẽ thêm comment, like, ...

export type JobStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'cancelled';

export type OrderStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobPayload {
  jobId: number;
  orderId: number;
  type: JobType;
  accountId: number;
  profileId: string; // GPM profile UUID
  targetUrl: string;
  watchSeconds: number;
  attempt: number;
}

export interface JobResult {
  ok: boolean;
  durationMs: number;
  error?: string;
  errorCode?: string; // 'ProfileInUse' | 'PuppeteerTimeout' | ...
  notes?: string;
}

export interface CreateOrderPayload {
  type: JobType;
  targetUrl: string;
  count: number;
  watchSeconds: number;
  /** Rải job trong N giây để tránh burst spawn. Default 0 = không rải. */
  spreadSeconds?: number;
}

export interface OrderSummary {
  id: number;
  type: JobType;
  status: OrderStatus;
  targetUrl: string;
  count: number;
  watchSeconds: number;
  createdAt: string;
  completedJobs: number;
  failedJobs: number;
}

/**
 * Mã lỗi chuẩn hoá để classify khi retry / quarantine acc.
 */
export const ErrorCode = {
  ProfileInUse: 'ProfileInUse',
  ProfileNotFound: 'ProfileNotFound',
  GpmStartFailed: 'GpmStartFailed',
  PuppeteerConnectFailed: 'PuppeteerConnectFailed',
  NavigationTimeout: 'NavigationTimeout',
  TikTokCaptcha: 'TikTokCaptcha',
  AccountLoggedOut: 'AccountLoggedOut',
  ProxyDead: 'ProxyDead',
  Unknown: 'Unknown',
} as const;

export type ErrorCodeT = (typeof ErrorCode)[keyof typeof ErrorCode];
