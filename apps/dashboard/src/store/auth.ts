import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrentUser } from '../lib/api';

interface AuthState {
  apiKey: string | null;
  user: CurrentUser | null;
  isAuthenticated: boolean;
  login: (key: string) => void;
  setUser: (user: CurrentUser | null) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get): AuthState => ({
      apiKey: null,
      user: null,
      isAuthenticated: false,
      login: (key: string) => set({ apiKey: key, isAuthenticated: true }),
      setUser: (user: CurrentUser | null) => set({ user, isAuthenticated: !!user }),
      logout: () => set({ apiKey: null, user: null, isAuthenticated: false }),
      hasPermission: (permission: string) => get().user?.permissions.includes(permission) ?? false,
    }),
    { name: 'seedingops:auth' },
  ),
);
