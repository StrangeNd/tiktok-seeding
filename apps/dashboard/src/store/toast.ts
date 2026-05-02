import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let counter = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = counter++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => get().dismiss(id), 5000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = {
  info: (title: string, message?: string) =>
    useToasts.getState().push({ kind: 'info', title, message }),
  success: (title: string, message?: string) =>
    useToasts.getState().push({ kind: 'success', title, message }),
  warn: (title: string, message?: string) =>
    useToasts.getState().push({ kind: 'warn', title, message }),
  error: (title: string, message?: string) =>
    useToasts.getState().push({ kind: 'error', title, message }),
};
