import type { Page } from 'puppeteer-core';

/**
 * Minimal types cho code chạy trong page.evaluate (browser context).
 * Tránh phải bật DOM lib toàn workspace.
 */
interface BrowserDocument {
  querySelector(selector: string): unknown;
}
declare const document: BrowserDocument;

export interface LiveViewOptions {
  /** URL TikTok cần xem. Vd: https://www.tiktok.com/@xxx/live */
  url: string;
  /** Số giây hold tab sau khi navigate xong. */
  watchSeconds: number;
  /** Timeout cho navigation (ms). Default 60s. */
  navTimeoutMs?: number;
  /** AbortSignal để dừng sớm khi worker shutdown. */
  signal?: AbortSignal;
}

export interface LiveViewResult {
  ok: boolean;
  navMs: number;
  watchedSeconds: number;
  finalUrl: string;
  /** Có dấu hiệu captcha trong DOM không */
  captchaDetected: boolean;
  notes?: string;
}

const CAPTCHA_SELECTORS = [
  'div[id*="captcha"]',
  'iframe[src*="captcha"]',
  'div[class*="captcha"]',
  'div[class*="verify"]',
];

/**
 * Action: mở 1 URL TikTok và "watch" trong N giây.
 * Caller (job-runner) đảm bảo session đã login trước khi gọi: hoặc cookie GPM
 * còn valid, hoặc auto-login đã chạy thành công (xem `tiktok-login.ts`).
 * Phase 2+ sẽ thêm: scroll FYP, click follow, comment...
 */
export async function liveView(page: Page, opts: LiveViewOptions): Promise<LiveViewResult> {
  const navTimeout = opts.navTimeoutMs ?? 60_000;
  const t0 = Date.now();

  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  const navMs = Date.now() - t0;

  // Detect captcha sớm để fail fast (không hold N giây vô ích)
  const captchaDetected = await page.evaluate((selectors) => {
    return selectors.some((sel) => document.querySelector(sel) !== null);
  }, CAPTCHA_SELECTORS);

  if (captchaDetected) {
    return {
      ok: false,
      navMs,
      watchedSeconds: 0,
      finalUrl: page.url(),
      captchaDetected: true,
      notes: 'Captcha detected — abort sớm',
    };
  }

  // Hold tab — chia thành chunks 1s để có thể abort sớm
  const totalMs = opts.watchSeconds * 1000;
  const start = Date.now();
  let watched = 0;
  while (Date.now() - start < totalMs) {
    if (opts.signal?.aborted) {
      watched = Math.round((Date.now() - start) / 1000);
      return {
        ok: true,
        navMs,
        watchedSeconds: watched,
        finalUrl: page.url(),
        captchaDetected: false,
        notes: 'Aborted by signal',
      };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  watched = opts.watchSeconds;

  return {
    ok: true,
    navMs,
    watchedSeconds: watched,
    finalUrl: page.url(),
    captchaDetected: false,
  };
}
