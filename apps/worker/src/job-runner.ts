import { GPMProfileInUseError, createGPMClient } from '@app/gpm-client';
import { ErrorCode, type JobPayload, type JobResult, createLogger, loadEnv } from '@app/shared';
import { liveView } from '@app/tiktok-actions';
import puppeteer, { type Browser } from 'puppeteer-core';

const env = loadEnv();
const log = createLogger('job-runner');
const isMock = env.GPM_MODE === 'mock';

const gpm = createGPMClient(env.GPM_MODE, {
  baseUrl: env.GPM_ENDPOINT,
  prefix: env.GPM_API_PREFIX,
  apiKey: env.GPM_API_KEY,
});

export interface RunJobOptions {
  signal?: AbortSignal;
}

/** Buffer added on top of `watchSeconds` for nav + cleanup before hard-timeout. */
const HARD_TIMEOUT_BUFFER_SEC = 90;

/** Puppeteer.connect has no built-in timeout; race it against this. */
const PUPPETEER_CONNECT_TIMEOUT_MS = 30_000;

/**
 * Mock implementation: skip GPM + Puppeteer, return synthetic success.
 */
async function runMockJob(payload: JobPayload): Promise<JobResult> {
  const t0 = Date.now();
  log.info({ jobId: payload.jobId, profileId: payload.profileId }, 'Mock job — simulating');
  await gpm.startProfile(payload.profileId);
  // Simulate a short watch
  const watchMs = Math.min(payload.watchSeconds, 2) * 1000;
  await new Promise((r) => setTimeout(r, watchMs));
  await gpm.closeProfile(payload.profileId);
  return {
    ok: true,
    durationMs: Date.now() - t0,
    notes: `mock nav=0ms watched=${Math.min(payload.watchSeconds, 2)}s`,
  };
}

/**
 * Race a promise against a timeout. On timeout, signal abort and reject.
 * The losing promise keeps running in background; caller's `finally` block must
 * still own resource cleanup.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(tid);
        resolve(v);
      },
      (e) => {
        clearTimeout(tid);
        reject(e);
      },
    );
  });
}

/**
 * Chạy 1 job live_view: start GPM profile → connect Puppeteer → action → cleanup.
 * Idempotent ở mức cleanup: dù lỗi giữa chừng vẫn cố gọi closeProfile.
 *
 * Defence in depth:
 *   - Puppeteer.connect raced against PUPPETEER_CONNECT_TIMEOUT_MS.
 *   - Whole job raced against hard timeout = (watchSeconds + buffer) seconds.
 *     If hard timeout fires, AbortController triggers liveView's signal-aware
 *     loop to bail; cleanup still runs in finally; result reported as JobTimeout.
 */
export async function runLiveViewJob(
  payload: JobPayload,
  opts: RunJobOptions = {},
): Promise<JobResult> {
  if (isMock) return runMockJob(payload);

  const t0 = Date.now();
  const hardTimeoutMs = (payload.watchSeconds + HARD_TIMEOUT_BUFFER_SEC) * 1000;

  // Combine caller-provided signal (worker shutdown) with our hard-timeout signal.
  const ac = new AbortController();
  const onCallerAbort = () => ac.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const hardTimeoutHandle = setTimeout(() => {
    log.warn({ jobId: payload.jobId, hardTimeoutMs }, 'Hard timeout fired, aborting job');
    ac.abort();
  }, hardTimeoutMs);

  let browser: Browser | null = null;
  let profileStarted = false;

  try {
    // 1. Start GPM profile
    const started = await gpm.startProfile(payload.profileId);
    profileStarted = true;
    log.debug(
      {
        jobId: payload.jobId,
        profileId: payload.profileId,
        port: started.port,
        pid: started.processId,
      },
      'Profile started',
    );

    // 2. Puppeteer connect with explicit timeout race
    browser = await withTimeout(
      puppeteer.connect({
        browserWSEndpoint: started.wsEndpoint,
        defaultViewport: null,
      }),
      PUPPETEER_CONNECT_TIMEOUT_MS,
      'puppeteer_connect',
    );
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());

    // 3. Action
    const result = await liveView(page, {
      url: payload.targetUrl,
      watchSeconds: payload.watchSeconds,
      signal: ac.signal,
    });

    // If the hard timeout fired DURING liveView, the in-loop signal check
    // returns ok:true with truncated watchedSeconds. Promote to JobTimeout.
    if (ac.signal.aborted && !opts.signal?.aborted) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: `job exceeded hard timeout (${hardTimeoutMs}ms)`,
        errorCode: ErrorCode.JobTimeout,
        notes: `nav=${result.navMs}ms watched=${result.watchedSeconds}s`,
      };
    }

    if (!result.ok) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: result.notes ?? 'liveView returned not ok',
        errorCode: result.captchaDetected ? ErrorCode.TikTokCaptcha : ErrorCode.Unknown,
        notes: `nav=${result.navMs}ms watched=${result.watchedSeconds}s`,
      };
    }

    return {
      ok: true,
      durationMs: Date.now() - t0,
      notes: `nav=${result.navMs}ms watched=${result.watchedSeconds}s`,
    };
  } catch (err) {
    if (err instanceof GPMProfileInUseError) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: err.message,
        errorCode: ErrorCode.ProfileInUse,
      };
    }
    const e = err as Error;
    if (e.message === 'puppeteer_connect_timeout') {
      log.warn({ jobId: payload.jobId }, 'Puppeteer connect timed out');
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: 'puppeteer connect timeout',
        errorCode: ErrorCode.PuppeteerConnectFailed,
      };
    }
    if (ac.signal.aborted && !opts.signal?.aborted) {
      return {
        ok: false,
        durationMs: Date.now() - t0,
        error: `job exceeded hard timeout (${hardTimeoutMs}ms): ${e.message}`,
        errorCode: ErrorCode.JobTimeout,
      };
    }
    log.warn({ err, jobId: payload.jobId }, 'Job failed');
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: e.message,
      errorCode: ErrorCode.Unknown,
    };
  } finally {
    clearTimeout(hardTimeoutHandle);
    if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort);

    // Cleanup: disconnect puppeteer trước, đợi 1s, rồi close profile.
    if (browser) {
      try {
        await browser.disconnect();
      } catch {
        // ignore
      }
    }
    if (profileStarted) {
      // Đợi 1s để GPM register browser disconnect, tránh stuck InUse
      await new Promise((r) => setTimeout(r, 1_000));
      try {
        await gpm.closeProfile(payload.profileId);
      } catch (e) {
        log.warn({ err: e, profileId: payload.profileId }, 'closeProfile failed (non-fatal)');
      }
    }
  }
}
