import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { checkAuth } from '../lib/api';
import { getMasterUrl, setMasterUrl } from '../lib/config';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';

export function Login() {
  const isAuth = useAuth((s) => s.isAuthenticated);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [masterUrl, setUrl] = useState(getMasterUrl());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isAuth) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const url = masterUrl.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Master URL must start with http:// or https://');
      }
      if (!apiKey.trim()) {
        throw new Error('API key is required');
      }
      setMasterUrl(url);
      const ok = await checkAuth(url, apiKey.trim());
      if (!ok) {
        throw new Error('Invalid API key (server returned 401)');
      }
      login(apiKey.trim());
      toast.success('Signed in');
      navigate('/', { replace: true });
    } catch (e) {
      const m = (e as Error).message || 'Login failed';
      setErr(m);
      toast.error('Login failed', m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="card w-[440px] max-w-full">
        <div className="px-6 py-5 border-b border-border">
          <div className="text-lg font-semibold text-text">Seeding Operator Console</div>
          <div className="text-sm text-text-muted mt-0.5">
            Sign in with your master API key to continue.
          </div>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="master-url" className="label">
              Master URL
            </label>
            <input
              id="master-url"
              type="text"
              className="input font-mono"
              value={masterUrl}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
            <div className="text-xs text-text-subtle mt-1">
              Default reads from <span className="kbd">.env</span> via vite. Override per machine if
              needed.
            </div>
          </div>
          <div>
            <label htmlFor="api-key" className="label">
              Master API key
            </label>
            <input
              id="api-key"
              type="password"
              className="input font-mono"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              placeholder="dev-key-change-me"
            />
          </div>
          {err && (
            <div className="border border-danger/40 bg-danger/10 text-danger px-3 py-2 rounded-md text-sm">
              {err}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Verifying...' : 'Sign in'}
          </button>
          <div className="text-xs text-text-subtle text-center pt-2">
            Your key is stored locally in this browser only. Never paste it into chat or commit it.
          </div>
        </form>
      </div>
    </div>
  );
}
