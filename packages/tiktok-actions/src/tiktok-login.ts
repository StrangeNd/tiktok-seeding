import type { Page } from 'puppeteer-core';

/**
 * Minimal types for code chạy trong page.evaluate (browser context).
 * Tránh phải bật DOM lib toàn workspace.
 */
interface BrowserElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
}
interface BrowserDocument {
  querySelector(selector: string): BrowserElement | null;
  querySelectorAll(selector: string): ArrayLike<BrowserElement>;
}
declare const document: BrowserDocument;

const TIKTOK_BASE = 'https://www.tiktok.com';
const LOGIN_URL = 'https://www.tiktok.com/login/phone-or-email/email';

/**
 * Selectors used to detect a logged-in session. TikTok DOM thay đổi thường xuyên
 * nên tốt nhất là kiểm tra nhiều selector "đặc trưng cho user đã login".
 */
const LOGGED_IN_SELECTORS = [
  '[data-e2e="profile-icon"]',
  '[data-e2e="nav-profile"]',
  '[data-e2e="user-avatar"]',
  'a[href^="/@"]',
];

/**
 * Selectors used to detect the "Log in" / "Sign up" CTA — i.e. NOT logged in.
 */
const LOGGED_OUT_SELECTORS = [
  '[data-e2e="top-login-button"]',
  '[data-e2e="nav-login"]',
  'a[href*="/login"]',
];

/** Captcha selectors — same set used by live-view.ts to keep behaviour consistent. */
const CAPTCHA_SELECTORS = [
  'div[id*="captcha"]',
  'iframe[src*="captcha"]',
  'div[class*="captcha"]',
  'div[class*="verify"]',
];

/**
 * Selectors for the username input on the email-login page. TikTok hay xoay
 * các thuộc tính `name` / `placeholder` nên giữ nhiều fallback.
 */
const USERNAME_INPUT_SELECTORS = [
  'input[name="username"]',
  'input[type="text"][autocomplete="username"]',
  'input[placeholder*="Email" i]',
  'input[placeholder*="username" i]',
];

const PASSWORD_INPUT_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
];

const LOGIN_SUBMIT_SELECTORS = [
  'button[data-e2e="login-button"]',
  'button[type="submit"]',
  'button.css-y0ev1k-Button-StyledButton',
];

/**
 * 2FA / verification-code input selectors (page hiện ra sau khi submit username+password
 * nếu TikTok yêu cầu mail code).
 */
const TWOFA_INPUT_SELECTORS = [
  'input[name="code"]',
  'input[data-e2e="verification-code-input"]',
  'input[placeholder*="code" i]',
  'input[autocomplete="one-time-code"]',
];

const TWOFA_SUBMIT_SELECTORS = [
  'button[data-e2e="verification-code-submit"]',
  'button[type="submit"]',
];

export interface LoginState {
  loggedIn: boolean;
  username?: string;
}

export interface LoginOptions {
  username: string;
  password: string;
  /** Abort khi worker shutdown / hard timeout. */
  signal?: AbortSignal;
  /** Tổng timeout cho login flow (ms). Default 60s. */
  timeoutMs?: number;
}

export interface LoginResult {
  ok: boolean;
  needs2FA: boolean;
  captchaDetected: boolean;
  error?: string;
}

/**
 * Random delay (ms) trong khoảng [min, max] để giả lập gõ phím / suy nghĩ của người dùng.
 */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, ms));
}

function abortError(signal?: AbortSignal): Error | null {
  return signal?.aborted ? new Error('aborted') : null;
}

/**
 * Trả về handle của element đầu tiên match một trong các selector.
 * Đợi tối đa `timeoutMs` cho đến khi xuất hiện. `null` nếu không tìm thấy.
 */
async function waitForFirstSelector(
  page: Page,
  selectors: string[],
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const handle = await page.$(sel);
      if (handle) {
        await handle.dispose();
        return sel;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function detectCaptcha(page: Page): Promise<boolean> {
  return page.evaluate((selectors) => {
    return selectors.some((sel) => document.querySelector(sel) !== null);
  }, CAPTCHA_SELECTORS);
}

async function detectLoggedIn(page: Page): Promise<boolean> {
  return page.evaluate((selectors) => {
    return selectors.some((sel) => document.querySelector(sel) !== null);
  }, LOGGED_IN_SELECTORS);
}

async function detectLoggedOut(page: Page): Promise<boolean> {
  return page.evaluate((selectors) => {
    return selectors.some((sel) => document.querySelector(sel) !== null);
  }, LOGGED_OUT_SELECTORS);
}

async function readDisplayUsername(page: Page): Promise<string | undefined> {
  const value = await page.evaluate(() => {
    const link = document.querySelector('a[href^="/@"]');
    if (!link) return null;
    const href = link.getAttribute('href');
    if (!href) return null;
    const match = href.match(/\/@([^/?#]+)/);
    return match ? match[1] : null;
  });
  return value ?? undefined;
}

/**
 * Navigate tới TikTok homepage và check user đã login chưa.
 * Logic ưu tiên: nếu thấy login CTA → loggedOut. Nếu thấy avatar/profile → loggedIn.
 * Nếu không match cả 2 (DOM lạ) → fallback: coi như chưa login để ép re-auth (an toàn hơn).
 */
export async function checkLoginState(page: Page): Promise<LoginState> {
  await page.goto(TIKTOK_BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Cho TikTok chút thời gian render header (login button / avatar).
  await new Promise((r) => setTimeout(r, 2_000));

  const [loggedOut, loggedIn] = await Promise.all([detectLoggedOut(page), detectLoggedIn(page)]);

  if (loggedOut && !loggedIn) {
    return { loggedIn: false };
  }
  if (loggedIn) {
    const username = await readDisplayUsername(page);
    return { loggedIn: true, username };
  }
  return { loggedIn: false };
}

/**
 * Click element bằng cách query từng selector trong list. Trả về true nếu click thành công.
 */
async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const handle = await page.$(sel);
    if (handle) {
      try {
        await handle.click({ delay: 50 + Math.floor(Math.random() * 100) });
        await handle.dispose();
        return true;
      } catch {
        await handle.dispose();
      }
    }
  }
  return false;
}

/**
 * Fill input bằng cách focus + clear + type với delay ngẫu nhiên giữa các phím
 * để giả lập gõ tay. Trả về true nếu fill thành công.
 */
async function typeIntoFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const handle = await page.$(sel);
    if (handle) {
      try {
        await handle.click({ clickCount: 3 });
        await handle.type(value, { delay: 60 + Math.floor(Math.random() * 80) });
        await handle.dispose();
        return true;
      } catch {
        await handle.dispose();
      }
    }
  }
  return false;
}

/**
 * Auto-login bằng username + password. Bước:
 *   1. Navigate tới `/login/phone-or-email/email`.
 *   2. Detect captcha → bỏ cuộc luôn.
 *   3. Fill username, password (random delay giả lập user).
 *   4. Click submit, đợi DOM thay đổi.
 *   5. Phân loại kết quả: 2FA cần code / captcha xuất hiện sau submit / login thành công / fail.
 *
 * KHÔNG retry trong function này — caller (job-runner) tự retry nếu cần để giữ control flow rõ ràng.
 */
export async function loginWithCredentials(page: Page, opts: LoginOptions): Promise<LoginResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  if (abortError(opts.signal))
    return { ok: false, needs2FA: false, captchaDetected: false, error: 'aborted' };

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (e) {
    return {
      ok: false,
      needs2FA: false,
      captchaDetected: false,
      error: `nav_failed: ${(e as Error).message}`,
    };
  }

  if (await detectCaptcha(page)) {
    return { ok: false, needs2FA: false, captchaDetected: true, error: 'captcha_on_login_page' };
  }

  // Đợi username input xuất hiện (tối đa 15s).
  const usernameSel = await waitForFirstSelector(page, USERNAME_INPUT_SELECTORS, 15_000);
  if (!usernameSel) {
    return {
      ok: false,
      needs2FA: false,
      captchaDetected: false,
      error: 'username_input_not_found',
    };
  }

  await randomDelay(800, 1_800);
  if (!(await typeIntoFirst(page, [usernameSel], opts.username))) {
    return { ok: false, needs2FA: false, captchaDetected: false, error: 'username_fill_failed' };
  }

  await randomDelay(600, 1_600);
  if (!(await typeIntoFirst(page, PASSWORD_INPUT_SELECTORS, opts.password))) {
    return { ok: false, needs2FA: false, captchaDetected: false, error: 'password_fill_failed' };
  }

  await randomDelay(800, 2_000);
  if (abortError(opts.signal))
    return { ok: false, needs2FA: false, captchaDetected: false, error: 'aborted' };

  if (!(await clickFirst(page, LOGIN_SUBMIT_SELECTORS))) {
    return { ok: false, needs2FA: false, captchaDetected: false, error: 'login_submit_not_found' };
  }

  // Sau khi submit, poll DOM cho 1 trong các signal:
  //   - 2FA input xuất hiện → cần mail code.
  //   - Captcha xuất hiện → fail (caller mark needs_reauth).
  //   - URL chuyển khỏi /login → coi như login thành công.
  //   - Error message hiện ra (sai pass, account bị khoá...).
  while (Date.now() < deadline) {
    if (abortError(opts.signal)) {
      return { ok: false, needs2FA: false, captchaDetected: false, error: 'aborted' };
    }

    if (await detectCaptcha(page)) {
      return {
        ok: false,
        needs2FA: false,
        captchaDetected: true,
        error: 'captcha_after_submit',
      };
    }

    if (await page.$(TWOFA_INPUT_SELECTORS.join(', '))) {
      return { ok: false, needs2FA: true, captchaDetected: false };
    }

    const url = page.url();
    if (!url.includes('/login')) {
      // Cross-check bằng cách quét DOM sau khi đã rời /login.
      const loggedIn = await detectLoggedIn(page);
      if (loggedIn) return { ok: true, needs2FA: false, captchaDetected: false };
      // Vẫn có thể là intermediate redirect — tiếp tục poll thêm 1 nhịp.
    }

    const errMsg = await page.evaluate(() => {
      const el =
        document.querySelector('[data-e2e="login-error"]') ??
        document.querySelector('div[class*="error"]');
      return el?.textContent?.trim() ?? null;
    });
    if (errMsg && errMsg.length > 0 && errMsg.length < 200) {
      return {
        ok: false,
        needs2FA: false,
        captchaDetected: false,
        error: `tiktok_error: ${errMsg}`,
      };
    }

    await new Promise((r) => setTimeout(r, 1_000));
  }

  return {
    ok: false,
    needs2FA: false,
    captchaDetected: false,
    error: 'login_timeout',
  };
}

/**
 * Sau khi `loginWithCredentials` trả về `needs2FA: true`, caller fetch mail code rồi gọi vào đây.
 *
 * Steps: fill code input → submit → đợi rời /login → cross-check loggedIn DOM.
 */
export async function submit2FACode(
  page: Page,
  code: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  if (abortError(opts.signal)) return { ok: false, error: 'aborted' };

  const inputSel = await waitForFirstSelector(page, TWOFA_INPUT_SELECTORS, 10_000);
  if (!inputSel) return { ok: false, error: '2fa_input_not_found' };

  await randomDelay(500, 1_200);
  if (!(await typeIntoFirst(page, [inputSel], code))) {
    return { ok: false, error: '2fa_fill_failed' };
  }

  await randomDelay(400, 1_000);
  if (abortError(opts.signal)) return { ok: false, error: 'aborted' };

  if (!(await clickFirst(page, TWOFA_SUBMIT_SELECTORS))) {
    return { ok: false, error: '2fa_submit_not_found' };
  }

  while (Date.now() < deadline) {
    if (abortError(opts.signal)) return { ok: false, error: 'aborted' };

    if (await detectCaptcha(page)) {
      return { ok: false, error: 'captcha_after_2fa' };
    }
    const url = page.url();
    if (!url.includes('/login')) {
      const loggedIn = await detectLoggedIn(page);
      if (loggedIn) return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  return { ok: false, error: '2fa_timeout' };
}
