'use client';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export interface DistributionRow {
  key: string;
  label: string;
  count: number;
  /** Swatch + bar fill; defaults to `var(--a)`. */
  color?: string;
  /** Assignee rows render an Avatar instead of a swatch. */
  avatar?: { name: string; src?: string | null };
  /** "Unassigned" row: dashed swatch, muted label. */
  muted?: boolean;
}

export interface DistributionListProps {
  rows: DistributionRow[];
  /** Collapse beyond this with a "Show all (N)" toggle. */
  maxRows?: number;
}

/**
 * The one breakdown component: swatch/avatar · label · track bar · count · %.
 * Percent is of the section's own total, computed client-side. Zero-count rows
 * still render (a state with 0 items is information); bar width 0.
 */
export function DistributionList({ rows, maxRows }: DistributionListProps) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-[12.5px] text-text-muted text-center">
        No data for this range
      </p>
    );
  }

  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const collapsed = maxRows !== undefined && !expanded && rows.length > maxRows;
  const visible = collapsed ? rows.slice(0, maxRows) : rows;

  return (
    <div className="flex flex-col">
      {visible.map((r) => {
        const pct = total ? Math.round((r.count / total) * 100) : 0;
        return (
          <div
            key={r.key}
            className="flex items-center gap-2.5 px-4 py-2 border-t border-border first:border-t-0"
          >
            {r.avatar ? (
              <Avatar name={r.avatar.name} src={r.avatar.src} size="xs" />
            ) : (
              <span
                aria-hidden
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  background: r.color ?? 'var(--a)',
                  ...(r.muted && {
                    background: 'transparent',
                    border: '1.5px dashed var(--text-muted)',
                  }),
                }}
              />
            )}
            <span className={cn('text-[12.5px] truncate w-24 shrink-0', r.muted && 'text-text-muted')}>
              {r.label}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-bg-subtle overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: r.color ?? 'var(--a)' }}
              />
            </div>
            <span className="tabular text-[12px] font-semibold w-8 text-right">{r.count}</span>
            <span className="tabular text-[10.5px] text-text-muted w-9 text-right">{pct}%</span>
          </div>
        );
      })}
      {collapsed && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="px-4 py-2 border-t border-border text-left text-[12px] text-accent hover:underline"
        >
          Show all ({rows.length})
        </button>
      )}
    </div>
  );
}
