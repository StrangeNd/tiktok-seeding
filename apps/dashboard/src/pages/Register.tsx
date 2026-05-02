import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { registerUser } from '../lib/api';
import { getMasterUrl, setMasterUrl } from '../lib/config';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';

export function Register() {
  const isAuth = useAuth((s) => s.isAuthenticated);
  const navigate = useNavigate();
  const [masterUrl, setUrl] = useState(getMasterUrl());
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (isAuth) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const url = masterUrl.trim().replace(/\/+$/, '');
      setMasterUrl(url);
      const result = await registerUser(url, { username, displayName, password });
      toast.success(
        result.firstAdmin ? 'Admin created' : 'User registered',
        result.user.status === 'pending' ? 'Waiting for admin approval.' : 'You can sign in now.',
      );
      navigate('/login', { replace: true });
    } catch (e) {
      const m = (e as Error).message || 'Registration failed';
      setErr(m);
      toast.error('Registration failed', m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="card w-[440px] max-w-full">
        <div className="px-6 py-5 border-b border-border">
          <div className="text-lg font-semibold text-text">Create operator account</div>
          <div className="text-sm text-text-muted mt-0.5">
            Local/private use only. First user becomes admin.
          </div>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="master-url" className="label">
              Master URL
            </label>
            <input
              id="master-url"
              className="input font-mono"
              value={masterUrl}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="username" className="label">
              Username
            </label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="display-name" className="label">
              Display name
            </label>
            <input
              id="display-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
            />
          </div>
          {err && (
            <div className="border border-danger/40 bg-danger/10 text-danger px-3 py-2 rounded-md text-sm">
              {err}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Creating...' : 'Register'}
          </button>
          <div className="text-xs text-text-subtle text-center pt-2">
            <Link className="text-accent hover:underline" to="/login">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
