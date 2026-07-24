'use client';
import * as React from 'react';
import { cn } from './cn';

/**
 * Sidebar navigation (docs/plan/02-design-system.md §3 Tier 3, §4 shell).
 *
 * Presentational only: no router, no stores. Apps pass `active`, `collapsed`,
 * and render links via the polymorphic `as` prop (`as={Link} href=…`), so the
 * same item works with next/link in web, admin, and space.
 */

export function SidebarNav({
  className,
  ...p
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        'flex-1 overflow-y-auto px-2.5 pb-4 flex flex-col gap-0.5',
        className,
      )}
      {...p}
    />
  );
}

export interface SidebarSectionProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Section heading; hidden while the sidebar is an icon rail. */
  label?: React.ReactNode;
  collapsed?: boolean;
}

export function SidebarSection({
  label,
  collapsed,
  className,
  children,
  ...p
}: SidebarSectionProps) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)} {...p}>
      {label && !collapsed && (
        <span className="px-2.5 pt-3 pb-1.5 text-micro font-bold uppercase tracking-[.08em] text-text-muted select-none">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

type PolymorphicProps<E extends React.ElementType> = {
  as?: E;
} & Omit<React.ComponentPropsWithoutRef<E>, 'as'>;

export type SidebarItemProps<E extends React.ElementType = 'button'> =
  PolymorphicProps<E> & {
    /** Pre-sized icon node (14–16px). Colour is inherited — don't set text-*. */
    icon?: React.ReactNode;
    label: React.ReactNode;
    active?: boolean;
    collapsed?: boolean;
    /** Count bubble; > 99 renders "99+". 0/undefined renders nothing. */
    badge?: number;
    /** Trailing slot (kbd hint, chevron) — hidden while collapsed. */
    trailing?: React.ReactNode;
  };

/**
 * One nav row: active accent bar + tint, icon that recolours on active/hover,
 * a count badge that migrates onto the icon when collapsed, and a title
 * attribute so the icon rail still has labels.
 */
export function SidebarItem<E extends React.ElementType = 'button'>({
  as,
  icon,
  label,
  active,
  collapsed,
  badge,
  trailing,
  className,
  ...rest
}: SidebarItemProps<E>) {
  const Comp = (as ?? 'button') as React.ElementType;
  const count = badge ?? 0;
  const bubble = count > 99 ? '99+' : String(count);

  return (
    <Comp
      className={cn(
        'group relative flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-sm font-medium text-text-sub w-full text-left',
        'transition-all duration-[var(--dur)] hover:bg-bg-hover hover:text-text',
        active &&
          'bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.15)] dark:text-[var(--a-200)]',
        collapsed && 'justify-center px-2',
        className,
      )}
      title={collapsed && typeof label === 'string' ? label : undefined}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      {active && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-[2px] bg-accent" />
      )}
      {icon && (
        <span
          className={cn(
            'relative flex-shrink-0 flex items-center justify-center transition-colors duration-[var(--dur)]',
            active
              ? 'text-accent dark:text-[var(--a-400)]'
              : 'text-text-muted group-hover:text-text',
          )}
        >
          {icon}
          {collapsed && count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-accent text-white text-[9px] font-bold px-[3px]">
              {bubble}
            </span>
          )}
        </span>
      )}
      {!collapsed && <span className="flex-1 min-w-0 truncate">{label}</span>}
      {!collapsed && count > 0 && (
        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-white text-micro font-bold px-1">
          {bubble}
        </span>
      )}
      {!collapsed && trailing}
    </Comp>
  );
}
