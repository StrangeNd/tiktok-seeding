import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { clearApiKey } from '../lib/api';

const links = [
  { to: '/', label: 'Overview' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/orders', label: 'Orders' },
  { to: '/admin', label: 'Admin' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-6">
              <span className="text-base font-bold text-gray-900">
                TikTok Seeding
              </span>
              <div className="flex gap-1">
                {links.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    className={({ isActive }) =>
                      `px-3 py-2 rounded text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-gray-900 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`
                    }
                    end={l.to === '/'}
                  >
                    {l.label}
                  </NavLink>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                clearApiKey();
                window.location.reload();
              }}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>
    </div>
  );
}
