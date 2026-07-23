'use client';
import { cn } from '@/lib/utils';
import { ANALYTICS_RANGES, type AnalyticsRange } from '@/hooks/use-analytics';

/**
 * Page-local segmented control for the time range (`Tabs` is for panel
 * switching; this is a value picker). Buttons are individually tabbable and
 * Enter/Space works by default.
 */
export function RangeToggle({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (r: AnalyticsRange) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex items-center rounded-lg border border-border bg-bg-card p-0.5"
    >
      {ANALYTICS_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn(
            'h-[calc(var(--ctl-sm)-6px)] px-2.5 rounded-md text-[11.5px] font-medium transition-colors duration-[var(--dur)]',
            value === r
              ? 'bg-accent-50 text-accent-700'
              : 'text-text-muted hover:text-text hover:bg-bg-hover',
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
