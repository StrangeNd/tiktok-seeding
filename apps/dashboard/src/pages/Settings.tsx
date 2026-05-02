import { useState } from 'react';
import { Card } from '../components/ui';
import { getMasterUrl, setMasterUrl } from '../lib/config';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';

export function Settings() {
  const [url, setUrl] = useState(getMasterUrl());
  const apiKey = useAuth((s) => s.apiKey);
  const logout = useAuth((s) => s.logout);

  function save() {
    const v = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(v)) {
      toast.error('Invalid URL', 'Master URL must start with http:// or https://');
      return;
    }
    setMasterUrl(v);
    toast.success('Master URL saved', v);
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-text-muted">Local browser settings and quick references.</p>
      </div>

      <Card title="Master connection">
        <div className="space-y-3">
          <div>
            <label htmlFor="master-url" className="label">
              Master URL
            </label>
            <input
              id="master-url"
              className="input font-mono"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              spellCheck={false}
            />
            <div className="text-xs text-text-subtle mt-1">
              Stored in localStorage on this browser only.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-primary" onClick={save}>
              Save
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                logout();
                toast.info('Signed out');
              }}
            >
              Sign out and clear API key
            </button>
          </div>
        </div>
      </Card>

      <Card title="Authentication">
        <div className="text-sm text-text-muted">
          API key currently stored:&nbsp;
          {apiKey ? (
            <span className="kbd">
              {apiKey.slice(0, 2)}***{apiKey.slice(-2)} ({apiKey.length} chars)
            </span>
          ) : (
            <span className="badge-warn">none</span>
          )}
        </div>
      </Card>

      <Card title="Where things live">
        <ul className="text-sm text-text-muted space-y-1">
          <li>
            <span className="kbd">.env</span> — backend config (master/worker/db/redis/gpm)
          </li>
          <li>
            <span className="kbd">.secrets/accounts.txt</span> — your account list (gitignored)
          </li>
          <li>
            <span className="kbd">.secrets/proxies.txt</span> — your proxy list (gitignored)
          </li>
          <li>
            <span className="kbd">.runtime/master.log</span> — master log tail
          </li>
          <li>
            <span className="kbd">.runtime/worker.log</span> — worker log tail
          </li>
          <li>
            <span className="kbd">docs/RUNBOOK_WINDOWS.md</span> — operator runbook
          </li>
        </ul>
      </Card>

      <Card title="Safety reminders">
        <ul className="text-sm text-text-muted space-y-1 list-disc list-inside">
          <li>Sensitive secrets are encrypted at rest and never returned by the API.</li>
          <li>The dashboard does not log credentials, cookies, or proxy passwords.</li>
          <li>
            Connectivity tests use a neutral endpoint (configurable via{' '}
            <span className="kbd">PROXY_TEST_URL</span>) and do not target any specific platform.
          </li>
          <li>Account validation is offline only — no automated TikTok login is performed.</li>
        </ul>
      </Card>
    </div>
  );
}
