'use client';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import { useToastStore } from '@/stores/toast-store';
import { cn } from '@/lib/utils';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
} as const;

const BORDER = {
  success: 'border-l-green',
  error: 'border-l-red',
  warn: 'border-l-amber',
  info: 'border-l-accent',
} as const;

const ICO_COLOR = {
  success: 'text-green',
  error: 'text-red',
  warn: 'text-amber',
  info: 'text-accent',
} as const;

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="fixed bottom-6 right-6 z-[800] flex flex-col gap-2.5 pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-3 min-w-[260px] max-w-[380px]',
              'px-4 py-3 rounded border border-border border-l-[3px]',
              'bg-[var(--modal-bg)] backdrop-blur-2xl shadow-lg',
              'text-[13px] font-medium animate-toast-in',
              BORDER[t.kind],
            )}
          >
            <Icon className={cn('w-4 h-4 flex-shrink-0', ICO_COLOR[t.kind])} />
            <span className="flex-1">{t.msg}</span>
          </div>
        );
      })}
    </div>
  );
}
