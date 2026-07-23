'use client';
import * as React from 'react';
import { cn } from './cn';

/**
 * The shared app frame (docs/plan/02-design-system.md §4): fixed sidebar
 * (220px, 48px as an icon rail, hideable) + sticky 40px topbar + content.
 *
 * Presentational: the app owns collapse/hide state (store, localStorage) and
 * passes it in; the shell owns the geometry — widths from tokens
 * (`--sidebar-w`/`--sidebar-collapsed-w`/`--topbar-h`), the margin handoff,
 * and the width/margin transition, so web and admin can't drift apart.
 *
 * Apps with an existing sidebar surface treatment keep it by defining
 * `--sidebar-bg`/`--sidebar-border`/`--topbar-bg`; otherwise tokens fall back
 * to the shared surfaces.
 */
export interface AppShellProps {
  /** Full sidebar column content (header, nav, footer) — laid out flex-col. */
  sidebar: React.ReactNode;
  /** Topbar row content. Omit to render no topbar (e.g. full-screen editors). */
  topbar?: React.ReactNode;
  /** Icon-rail mode (220px → 48px). */
  collapsed?: boolean;
  /** Sidebar fully off-screen (⌘B). */
  sidebarHidden?: boolean;
  /**
   * Classes for the <main> content element. Defaults to `px-6 py-5`; passing
   * anything replaces the default entirely (full-screen editors need zero
   * padding, which class-merging can't express).
   */
  mainClassName?: string;
  children: React.ReactNode;
}

export function AppShell({
  sidebar,
  topbar,
  collapsed,
  sidebarHidden,
  mainClassName,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col h-screen border-r',
          'border-[color:var(--sidebar-border,var(--border))] bg-[color:var(--sidebar-bg,var(--bg-subtle))]',
          'backdrop-blur-xl transition-[width,transform] duration-300 ease-[cubic-bezier(.4,0,.2,1)]',
          collapsed ? 'w-sb-collapsed' : 'w-sb',
          sidebarHidden && '-translate-x-full',
        )}
        aria-hidden={sidebarHidden}
      >
        {sidebar}
      </aside>

      <div
        className={cn(
          'transition-[margin] duration-300 ease-[cubic-bezier(.4,0,.2,1)]',
          sidebarHidden ? 'ml-0' : collapsed ? 'ml-sb-collapsed' : 'ml-sb',
        )}
      >
        {topbar != null && (
          <header className="sticky top-0 z-30 h-tb border-b border-border bg-[color:var(--topbar-bg,var(--bg-subtle))] backdrop-blur-xl">
            {topbar}
          </header>
        )}
        <main className={mainClassName ?? 'px-6 py-5'}>{children}</main>
      </div>
    </div>
  );
}
