import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  apiKey: string | null;
  isAuthenticated: boolean;
  login: (key: string) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      apiKey: null,
      isAuthenticated: false,
      login: (key: string) => set({ apiKey: key, isAuthenticated: true }),
      logout: () => set({ apiKey: null, isAuthenticated: false }),
    }),
    { name: 'seedingops:auth' },
  ),
);
