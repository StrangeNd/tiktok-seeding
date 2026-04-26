import type { GPMApiResponse } from './types.js';

/** Lỗi base từ GPM API. Giữ raw response để debug. */
export class GPMError extends Error {
  readonly status: number;
  readonly raw: unknown;

  constructor(message: string, opts: { status?: number; raw?: unknown } = {}) {
    super(message);
    this.name = 'GPMError';
    this.status = opts.status ?? 0;
    this.raw = opts.raw;
  }
}

/**
 * Đặc biệt cho lỗi `ProfileInUse` — caller có thể retry với backoff.
 * GPM giữ flag InUse khoảng 30-60s sau khi browser disconnect.
 */
export class GPMProfileInUseError extends GPMError {
  readonly profileId: string;
  constructor(profileId: string, raw: GPMApiResponse<unknown>) {
    super(`Profile ${profileId} đang InUse`, { raw });
    this.name = 'GPMProfileInUseError';
    this.profileId = profileId;
  }
}
