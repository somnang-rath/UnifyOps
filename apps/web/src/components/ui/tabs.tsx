'use client';
import { cn } from '@/lib/utils';

export interface TabItem<V extends string = string> {
  value: V;
  label: string;
  count?: number;
}

export function Tabs<V extends string>({
  value,
  onChange,
  items,
}: {
  value: V;
  onChange: (v: V) => void;
  items: TabItem<V>[];
}) {
  return (
    <div className="flex gap-px p-[3px] bg-bg-card border border-border rounded-sm">
      {items.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'flex items-center gap-1.5 px-3.5 py-1.5 rounded-[5px] text-[12px] font-medium transition-all duration-[var(--dur)]',
              active
                ? 'bg-accent text-white shadow-xs'
                : 'text-text-muted hover:text-text',
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={cn(
                  'text-[10px] font-bold px-1.5 py-px rounded-full',
                  active
                    ? 'bg-white/20 text-white'
                    : 'bg-border text-text-sub',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
