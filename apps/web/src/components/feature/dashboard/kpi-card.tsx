'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tone-mapped stat card, extracted from `app/(app)/home/home-user.tsx` so home
 * and analytics share one implementation. Stays in apps/web (renders
 * `next/link` — routing is banned from `packages/ui`).
 */

export type KpiTone = 'violet' | 'red' | 'amber' | 'pink' | 'green' | 'blue';

const TONE_BG: Record<KpiTone, string> = {
  violet: 'bg-[rgba(139,92,246,.1)] text-violet',
  red:    'bg-[rgba(239,68,68,.1)] text-red',
  amber:  'bg-[rgba(245,158,11,.1)] text-amber',
  pink:   'bg-[rgba(236,72,153,.1)] text-pink',
  green:  'bg-[rgba(16,185,129,.1)] text-green',
  blue:   'bg-[rgba(59,130,246,.1)] text-blue',
};

const TONE_NUM: Record<KpiTone, string> = {
  violet: 'text-violet',
  red:    'text-red',
  amber:  'text-amber',
  pink:   'text-pink',
  green:  'text-green',
  blue:   'text-blue',
};

export function KpiCard({
  label,
  value,
  Icon,
  tone,
  href,
  danger,
}: {
  label: string;
  value: number;
  Icon: React.ComponentType<{ className?: string }>;
  tone: KpiTone;
  href?: string;
  danger?: boolean;
}) {
  const body = (
    <div
      className={cn(
        'group flex flex-col gap-3 p-4 bg-bg-card border rounded-xl transition-all duration-[var(--dur)]',
        danger
          ? 'border-[rgba(239,68,68,.45)] shadow-[0_0_0_3px_rgba(239,68,68,.07)]'
          : 'border-border hover:-translate-y-[2px] hover:shadow-lg hover:border-accent',
        href && 'cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', TONE_BG[tone])}>
          <Icon className="w-[16px] h-[16px]" />
        </div>
        {href && (
          <ArrowRight className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <div className="leading-none">
        <div className={cn('text-[28px] font-bold tracking-[-.03em]', TONE_NUM[tone])}>{value}</div>
        <div className="text-[11.5px] text-text-muted mt-1">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
