import { type FormEvent, useState } from 'react';
import { fetchHealth, setApiKey } from '../lib/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError('');
    setApiKey(key.trim());
    try {
      await fetchHealth();
      onLogin();
    } catch {
      setError('Cannot reach master API. Verify the API is running on :7000.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-1">TikTok Seeding</h1>
        <p className="text-sm text-gray-500 mb-6">Enter your Master API key to continue.</p>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            API Key
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="dev-key-change-me"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-normal focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </label>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="mt-4 w-full bg-gray-900 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Connecting...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
