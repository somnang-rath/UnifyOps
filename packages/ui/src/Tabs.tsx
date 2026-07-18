'use client';
import * as React from 'react';
import { cn } from './cn';

export interface TabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onValueChange: (v: T) => void;
  /** `line` for page-level navigation, `pill` for filters inside a panel. */
  variant?: 'line' | 'pill';
  className?: string;
  'aria-label'?: string;
}

/**
 * Tabs (docs/plan/02-design-system.md §3).
 *
 * Implements the WAI-ARIA tab pattern: arrow keys move between tabs, Home/End
 * jump to the ends, and only the active tab is in the page's tab order. Without
 * that, a keyboard user has to Tab through every tab to reach the panel.
 */
export function Tabs<T extends string = string>({
  items,
  value,
  onValueChange,
  variant = 'line',
  className,
  'aria-label': ariaLabel,
}: TabsProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, dir: 1 | -1 | 'home' | 'end') => {
    const enabled = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !it.disabled);
    if (!enabled.length) return;

    let target: number;
    if (dir === 'home') target = enabled[0].i;
    else if (dir === 'end') target = enabled[enabled.length - 1].i;
    else {
      const pos = enabled.findIndex(({ i }) => i === from);
      const next = (pos + dir + enabled.length) % enabled.length;
      target = enabled[next].i;
    }
    refs.current[target]?.focus();
    onValueChange(items[target].value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex items-center gap-0.5',
        variant === 'line' && 'border-b border-border',
        variant === 'pill' && 'p-0.5 bg-bg-subtle rounded-md w-fit',
        className,
      )}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={item.disabled}
            // Roving tabindex: the tablist is one stop, arrows do the rest.
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(i, 1);
              else if (e.key === 'ArrowLeft') move(i, -1);
              else if (e.key === 'Home') move(i, 'home');
              else if (e.key === 'End') move(i, 'end');
              else return;
              e.preventDefault();
            }}
            className={cn(
              'relative inline-flex items-center gap-1.5 h-ctl-md px-2.5 text-sm font-medium',
              'transition-colors duration-[var(--dur)] whitespace-nowrap',
              'disabled:opacity-50 disabled:pointer-events-none',
              variant === 'line' &&
                cn(
                  'border-b-2 -mb-px',
                  active
                    ? 'border-accent text-text'
                    : 'border-transparent text-text-muted hover:text-text',
                ),
              variant === 'pill' &&
                cn(
                  'rounded-sm h-ctl-sm',
                  active
                    ? 'bg-bg-card text-text shadow-xs'
                    : 'text-text-muted hover:text-text',
                ),
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'tabular text-2xs',
                  active ? 'text-text-sub' : 'text-text-muted',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
