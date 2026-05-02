import { useToasts } from '../store/toast';

export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[360px] max-w-[90vw]">
      {toasts.map((t) => {
        const tone =
          t.kind === 'success'
            ? 'border-ok/40 bg-ok/10'
            : t.kind === 'warn'
              ? 'border-warn/40 bg-warn/10'
              : t.kind === 'error'
                ? 'border-danger/40 bg-danger/10'
                : 'border-border bg-bg-card';
        const icon =
          t.kind === 'success' ? '✓' : t.kind === 'error' ? '✕' : t.kind === 'warn' ? '!' : 'i';
        return (
          <div key={t.id} className={`card border ${tone} p-3.5 shadow-lg flex items-start gap-3`}>
            <div className="text-sm font-semibold w-5 h-5 flex items-center justify-center shrink-0 rounded-full bg-bg-card border border-border">
              {icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text">{t.title}</div>
              {t.message && (
                <div className="text-xs text-text-muted mt-0.5 whitespace-pre-wrap break-words">
                  {t.message}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-text-subtle hover:text-text text-xs"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
