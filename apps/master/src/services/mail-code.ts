import { createLogger, loadEnv } from '@app/shared';
import { getAccountSecretsForMailbox, maskEmail, recordMailCodeStatus } from './accounts.js';

const log = createLogger('mail-code');
const env = loadEnv();

export interface MailCodeResult {
  code: string;
  maskedSourceEmail: string | null;
  subjectSnippet: string;
  receivedAt: string;
  provider: string;
}

export interface MailCodeProvider {
  name: string;
  getLatestCode(input: MailCodeProviderInput): Promise<MailCodeResult>;
}

export interface MailCodeProviderInput {
  email: string;
  refreshToken: string;
  clientId: string;
  lookbackMinutes: number;
  maxResults: number;
  allowedSenders: string[];
  subjectHints: string[];
}

interface GraphMessage {
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  bodyPreview?: string;
}

const requestCooldown = new Map<number, number>();

export async function getLatestCodeForAccount(accountId: number): Promise<MailCodeResult> {
  const now = Date.now();
  const cooldownMs = env.MAIL_CODE_REQUEST_COOLDOWN_SECONDS * 1000;
  const last = requestCooldown.get(accountId) ?? 0;
  if (cooldownMs > 0 && now - last < cooldownMs) {
    await recordMailCodeStatus(accountId, 'rate_limited', 'mail_code_rate_limited');
    throw new MailCodeError('rate_limited', 'Please wait before requesting another code.');
  }
  requestCooldown.set(accountId, now);

  const { account, secrets } = await getAccountSecretsForMailbox(accountId);
  const refreshToken = secrets.refreshtokenmail;
  const clientId = secrets.clientid;
  const email = account.email ?? secrets.mail;

  if (!email || !refreshToken || !clientId) {
    await recordMailCodeStatus(
      accountId,
      'missing_oauth',
      'missing mailbox OAuth2 refresh token/client id',
    );
    log.warn(
      { accountId, email: maskEmail(email) },
      'Mail code retrieval skipped: missing OAuth fields',
    );
    throw new MailCodeError(
      'missing_oauth',
      'Account is missing mailbox email, OAuth2 refresh token, or client id.',
    );
  }

  const provider = getProvider(env.MAIL_PROVIDER);
  try {
    const result = await provider.getLatestCode({
      email,
      refreshToken,
      clientId,
      lookbackMinutes: env.MAIL_CODE_LOOKBACK_MINUTES,
      maxResults: env.MAIL_CODE_MAX_RESULTS,
      allowedSenders: parseCsv(env.MAIL_CODE_ALLOWED_SENDERS),
      subjectHints: parseCsv(env.MAIL_CODE_SUBJECT_HINTS),
    });
    await recordMailCodeStatus(accountId, 'ok', null);
    log.info(
      { accountId, email: maskEmail(email), provider: result.provider },
      'Mail code retrieved',
    );
    return result;
  } catch (e) {
    const err = normalizeMailError(e);
    await recordMailCodeStatus(accountId, err.code, err.message);
    log.warn({ accountId, email: maskEmail(email), code: err.code }, 'Mail code retrieval failed');
    throw err;
  }
}

function getProvider(name: string): MailCodeProvider {
  if (name === 'microsoft') return new MicrosoftGraphMailCodeProvider();
  if (name === 'gmail') return new UnsupportedMailCodeProvider('gmail');
  return new UnsupportedMailCodeProvider(name);
}

class UnsupportedMailCodeProvider implements MailCodeProvider {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  async getLatestCode(): Promise<MailCodeResult> {
    throw new MailCodeError(
      'provider_unsupported',
      `MAIL_PROVIDER=${this.name} is not configured for mailbox retrieval.`,
    );
  }
}

class MicrosoftGraphMailCodeProvider implements MailCodeProvider {
  name = 'microsoft';

  async getLatestCode(input: MailCodeProviderInput): Promise<MailCodeResult> {
    const accessToken = await this.refreshAccessToken(input.refreshToken, input.clientId);
    const messages = await this.fetchRecentMessages(accessToken, input);
    const found = findCode(messages, input);
    if (!found) {
      throw new MailCodeError(
        'code_not_found',
        'No 4-8 digit verification code found in recent mailbox messages.',
      );
    }
    return { ...found, provider: this.name };
  }

  private async refreshAccessToken(refreshToken: string, clientId: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://graph.microsoft.com/.default offline_access',
    });
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!res.ok || !body.access_token) {
      throw new MailCodeError('token_failed', body.error || `token_exchange_failed_${res.status}`);
    }
    return body.access_token;
  }

  private async fetchRecentMessages(
    accessToken: string,
    input: MailCodeProviderInput,
  ): Promise<GraphMessage[]> {
    const since = new Date(Date.now() - input.lookbackMinutes * 60_000).toISOString();
    const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
    const top = Math.min(input.maxResults, 50);
    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&$filter=${filter}&$select=subject,receivedDateTime,from,bodyPreview`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = (await res.json().catch(() => ({}))) as {
      value?: GraphMessage[];
      error?: { message?: string };
    };
    if (!res.ok || !Array.isArray(body.value)) {
      throw new MailCodeError(
        'error',
        body.error?.message || `message_search_failed_${res.status}`,
      );
    }
    return body.value;
  }
}

function findCode(
  messages: GraphMessage[],
  input: MailCodeProviderInput,
): Omit<MailCodeResult, 'provider'> | null {
  for (const message of messages) {
    const sender = message.from?.emailAddress?.address ?? '';
    const subject = message.subject ?? '';
    const preview = message.bodyPreview ?? '';
    if (!senderAllowed(sender, input.allowedSenders)) continue;
    if (!subjectAllowed(subject, input.subjectHints)) continue;
    const code = extractCode(`${subject}\n${preview}`);
    if (!code) continue;
    return {
      code,
      maskedSourceEmail: maskEmail(sender),
      subjectSnippet: snippet(subject),
      receivedAt: message.receivedDateTime ?? new Date().toISOString(),
    };
  }
  return null;
}

function extractCode(text: string): string | null {
  const matches = text.match(/(?<!\d)\d{4,8}(?!\d)/g) ?? [];
  return matches[0] ?? null;
}

function senderAllowed(sender: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const lower = sender.toLowerCase();
  return allowed.some((item) => lower.includes(item.toLowerCase()));
}

function subjectAllowed(subject: string, hints: string[]): boolean {
  if (hints.length === 0) return true;
  const lower = subject.toLowerCase();
  return hints.some((item) => lower.includes(item.toLowerCase()));
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function snippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function normalizeMailError(e: unknown): MailCodeError {
  if (e instanceof MailCodeError) return e;
  return new MailCodeError('error', (e as Error).message || 'mail_code_error');
}

export class MailCodeError extends Error {
  code:
    | 'missing_oauth'
    | 'token_failed'
    | 'code_not_found'
    | 'provider_unsupported'
    | 'rate_limited'
    | 'error';

  constructor(code: MailCodeError['code'], message: string) {
    super(message.replace(/[A-Za-z0-9+/=_-]{20,}/g, '[redacted]').slice(0, 240));
    this.code = code;
  }
}
