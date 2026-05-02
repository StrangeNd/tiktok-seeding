import type { CSSProperties, ReactNode } from 'react';

export function Card({
  title,
  actions,
  children,
  pad = true,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="text-sm font-semibold text-text">{title}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = (status || 'unknown').toLowerCase();
  const map: Record<string, string> = {
    available: 'badge-ok',
    in_use: 'badge-info',
    broken: 'badge-danger',
    quarantined: 'badge-warn',

    queued: 'badge-muted',
    running: 'badge-info',
    done: 'badge-ok',
    failed: 'badge-danger',
    cancelled: 'badge-warn',

    pending: 'badge-muted',
    succeeded: 'badge-ok',
    retrying: 'badge-warn',

    active: 'badge-ok',
    disabled: 'badge-muted',
    archived: 'badge-muted',

    ok: 'badge-ok',
    unknown: 'badge-muted',
    present: 'badge-ok',
    missing: 'badge-warn',
    needs_reauth: 'badge-warn',
    dead: 'badge-danger',
    missing_oauth: 'badge-warn',
    token_failed: 'badge-danger',
    code_not_found: 'badge-warn',
    provider_unsupported: 'badge-warn',
    rate_limited: 'badge-warn',

    healthy: 'badge-ok',
    degraded: 'badge-warn',
  };
  const cls = map[s] ?? 'badge-muted';
  return <span className={cls}>{s}</span>;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16">
      <div className="text-text-muted mb-2 text-base">{title}</div>
      {hint && <div className="text-text-subtle text-sm max-w-md">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12">
      <div className="text-danger mb-2 text-sm font-medium">Something went wrong</div>
      <div className="text-text-muted text-sm max-w-md">{message}</div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn mt-4">
          Retry
        </button>
      )}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  const style: CSSProperties = { width: size, height: size, borderWidth: 2 };
  return (
    <span
      style={style}
      className="inline-block rounded-full border-text-subtle border-t-transparent animate-spin"
    />
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'info';
}) {
  const toneClass = {
    default: 'text-text',
    ok: 'text-ok',
    warn: 'text-warn',
    danger: 'text-danger',
    info: 'text-brand',
  }[tone];
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-text-subtle">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}

export function MaskedFlag({ has, label }: { has: boolean; label: string }) {
  return has ? (
    <span className="badge-info" title={`${label} present (encrypted)`}>
      {label} •••
    </span>
  ) : (
    <span className="badge-muted">no {label}</span>
  );
}

export function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}
