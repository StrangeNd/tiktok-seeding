import { GPMClient, GPMProfileInUseError } from '@app/gpm-client';
import { ErrorCode, type JobPayload, type JobResult, createLogger, loadEnv } from '@app/shared';
import { liveView } from '@app/tiktok-actions';
import puppeteer, { type Browser } from 'puppeteer-core';

const env = loadEnv();
const log = createLogger('job-runner');

const gpm = new GPMClient({
  baseUrl: env.GPM_ENDPOINT,
  prefix: env.GPM_API_PREFIX,
  apiKey: env.GPM_API_KEY,
});

export interface RunJobOptions {
  signal?: AbortSignal;
}

/**
 * Chạy 1 job live_view: start GPM profile → connect Puppeteer → action → cleanup.
 * Idempotent ở mức cleanup: dù lỗi giữa chừng vẫn cố gọi closeProfile.
 */
export async function runLiveViewJob(payload: JobPayload, opts: RunJobOptions = {}): Promise<JobResult> {
  const t0 = Date.now();
  let browser: Browser | null = null;
  let profileStarted = false;

  try {
    // 1. Start GPM profile
    const started = await gpm.startProfile(payload.profileId);
    profileStarted = true;
    log.debug(
      { jobId: payload.jobId, profileId: payload.profileId, port: started.port, pid: started.processId },
      'Profile started',
    );

    // 2. Puppeteer connect
    browser = await puppeteer.connect({
      browserWSEndpoint: started.wsEndpoint,
      defaultViewport: null,
    });
    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());

    // 3. Action
    const result = await liveView(page, {
      url: payload.targetUrl,
      watchSeconds: payload.watchSeconds,
      signal: opts.signal,
    });

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
    log.warn({ err, jobId: payload.jobId }, 'Job failed');
    return {
      ok: false,
      durationMs: Date.now() - t0,
      error: e.message,
      errorCode: ErrorCode.Unknown,
    };
  } finally {
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
