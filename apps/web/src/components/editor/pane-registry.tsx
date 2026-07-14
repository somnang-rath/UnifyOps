import type { ComponentType } from 'react';
import WikiPageRoute from '@/app/(app)/wiki/page';
import { NotesView } from '@/app/(app)/notes/_components/notes-view';
import ReportsPage from '@/app/(app)/reports/page';

/**
 * Native pane registry (the "native" half of the hybrid split editor).
 *
 * Each entry maps a route to a React component that renders that route's
 * content *in place* — no iframe, so it shares the auth store, TanStack Query
 * cache and theme with the rest of the app. Routes with no entry fall back to
 * an <iframe> in {@link PaneContent}.
 *
 * To promote a route to native: add an entry here. The component must fill its
 * container (a page that hard-codes `100vh` needs a container-aware variant
 * first — that's why Notes/Reports still use the iframe fallback).
 */
export interface PaneViewProps {
  route: string;
}

interface Entry {
  match: (path: string) => boolean;
  Component: ComponentType<PaneViewProps>;
  /** Wrap the view in the standard page padding (default true). */
  padded?: boolean;
}

const registry: Entry[] = [
  // Wiki has no outer padding of its own, so keep the standard page padding.
  { match: (p) => p === '/wiki', Component: () => <WikiPageRoute /> },
  // Notes fills its container in `embedded` mode; it manages its own padding.
  { match: (p) => p === '/notes', Component: () => <NotesView embedded />, padded: false },
  // Reports already uses `p-6 max-w-6xl mx-auto`, so no extra padding.
  { match: (p) => p === '/reports', Component: () => <ReportsPage />, padded: false },
];

/** Resolve the native pane entry for a route, or null to use the iframe fallback. */
export function resolvePaneView(route: string): Entry | null {
  const path = route.split('?')[0];
  return registry.find((e) => e.match(path)) ?? null;
}
