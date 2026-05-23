import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';
export interface Toast {
  id: string;
  msg: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  show: (msg: string, kind?: ToastKind) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (msg, kind = 'info') => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, msg, kind }] }));
    setTimeout(
      () =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      3000,
    );
  },
  remove: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (msg: string, kind?: ToastKind) =>
  useToastStore.getState().show(msg, kind);
