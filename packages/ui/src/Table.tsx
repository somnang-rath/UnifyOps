'use client';
import * as React from 'react';
import { cn } from './cn';

/**
 * Dense data table (docs/plan/02-design-system.md §3).
 *
 * 32px rows, 28px sticky header, tabular numerals. The wrapper owns the
 * horizontal scroll so a wide table never makes the *page* scroll sideways —
 * that is the difference between a table you can read and a layout that breaks.
 */
export function Table({
  className,
  children,
  ...p
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-md border border-border">
      <table
        className={cn('w-full border-collapse text-sm tabular', className)}
        {...p}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({
  className,
  ...p
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'sticky top-0 z-10 bg-bg-subtle [&_th]:h-7 [&_th]:px-2.5',
        '[&_th]:text-left [&_th]:text-2xs [&_th]:font-medium [&_th]:text-text-muted',
        '[&_th]:border-b [&_th]:border-border [&_th]:whitespace-nowrap',
        className,
      )}
      {...p}
    />
  );
}

export function TBody({
  className,
  ...p
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        '[&_td]:h-row [&_td]:px-2.5 [&_td]:border-b [&_td]:border-border',
        '[&_tr:last-child_td]:border-0',
        '[&_tr]:transition-colors [&_tr]:duration-[var(--dur)]',
        className,
      )}
      {...p}
    />
  );
}

export function TRow({
  selected,
  className,
  ...p
}: { selected?: boolean } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      aria-selected={selected}
      className={cn(
        'hover:bg-bg-hover',
        selected && 'bg-accent-50 hover:bg-accent-50',
        className,
      )}
      {...p}
    />
  );
}
