import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getMasterUrl } from '../lib/config';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: '◇', end: true },
  { to: '/profiles', label: 'Profiles', icon: '⊡' },
  { to: '/accounts', label: 'Accounts', icon: '☰' },
  { to: '/proxies', label: 'Proxies', icon: '⇌' },
  { to: '/orders', label: 'Orders', icon: '➜' },
  { to: '/jobs', label: 'Activity', icon: '◈' },
  { to: '/admin', label: 'Admin', icon: '⚒' },
  { to: '/users', label: 'Users', icon: '◎' },
  { to: '/audit-logs', label: 'Audit', icon: '◷' },
  { to: '/settings', label: 'Settings', icon: '✎' },
];

export function AppShell() {
  const logout = useAuth((s) => s.logout);
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [healthy, setHealthy] = useState<null | boolean>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ ok: boolean }>('/health/deep', { throwOnError: false });
        if (!stop) setHealthy(!!r?.ok);
      } catch {
        if (!stop) setHealthy(false);
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const masterUrl = getMasterUrl();

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 bg-bg-subtle border-r border-border flex flex-col shrink-0">
        <div className="px-5 py-4 border-b border-border">
          <div className="font-semibold text-text">Seeding Operator</div>
          <div className="text-xs text-text-subtle mt-0.5">Console v0.1</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.filter((n) => (n.to === '/users' ? user?.role === 'admin' : true)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-bg-hover text-text'
                    : 'text-text-muted hover:text-text hover:bg-bg-hover/50'
                }`
              }
            >
              <span className="text-text-subtle w-4 text-center">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-border text-xs text-text-subtle">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                healthy === true
                  ? 'bg-ok'
                  : healthy === false
                    ? 'bg-danger'
                    : 'bg-warn animate-pulse'
              }`}
            />
            <span>
              {healthy === true ? 'Master OK' : healthy === false ? 'Master DOWN' : '...'}
            </span>
          </div>
          <div className="mt-1 truncate" title={masterUrl}>
            {masterUrl}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-bg-subtle flex items-center justify-between px-6 shrink-0">
          <div className="text-sm text-text-muted">TikTok seeding orchestrator</div>
          <div className="flex items-center gap-2">
            {user && (
              <div className="text-xs text-text-muted">
                {user.displayName} <span className="badge-info">{user.role}</span>
              </div>
            )}
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                void api('/auth/logout', { method: 'POST', throwOnError: false });
                logout();
                toast.info('Logged out');
                navigate('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-bg">
          <div className="max-w-[1400px] mx-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
