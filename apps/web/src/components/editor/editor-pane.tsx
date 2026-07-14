'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { PaneNode } from '@/stores/layout-store';
import { useLayoutStore } from '@/stores/layout-store';
import { PaneContent } from './pane-content';
import { cn } from '@/lib/utils';

type Leaf = PaneNode & { type: 'leaf' };

/** Routes a pane can be pointed at from its header picker. */
const OPENABLE: { path: string; label: string }[] = [
  { path: '/wiki', label: 'Wiki' },
  { path: '/notes', label: 'Notes' },
  { path: '/reports', label: 'Reports' },
  { path: '/tables', label: 'Tables' },
  { path: '/issues', label: 'Tasks' },
  { path: '/kanban', label: 'Board' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/files', label: 'Storage' },
  { path: '/home', label: 'Home' },
];

/** Turn a route path into a short human label for the pane header. */
function labelFor(route: string): string {
  if (route === '__current__') return 'Current';
  const known = OPENABLE.find((o) => o.path === route.split('?')[0]);
  if (known) return known.label;
  const seg = route.split('?')[0].split('/').filter(Boolean);
  if (seg.length === 0) return 'Home';
  return seg
    .slice(-2)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' / ');
}

/**
 * A single editor pane: a header (route picker + close) plus its content, which
 * {@link PaneContent} renders as the live route, a native view, or an iframe.
 */
export function EditorPane({
  node,
  liveContent,
  showChrome,
}: {
  node: Leaf;
  liveContent: React.ReactNode;
  /** Whether to show the pane header + focus ring (only when the layout is split). */
  showChrome: boolean;
}) {
  const active = useLayoutStore((s) => s.activePaneId === node.id);
  const setActive = useLayoutStore((s) => s.setActive);
  const closePane = useLayoutStore((s) => s.closePane);
  const isLive = node.route === '__current__';

  return (
    <div
      onMouseDown={() => setActive(node.id)}
      className={cn(
        'flex flex-col min-w-0 min-h-0 h-full w-full overflow-hidden bg-bg',
        showChrome && 'border border-transparent',
        showChrome && active && 'border-accent/50',
      )}
    >
      {showChrome && (
        <div
          className={cn(
            'flex items-center gap-2 h-8 px-2.5 flex-shrink-0 border-b border-border text-[12px]',
            active ? 'bg-bg-subtle text-text' : 'bg-bg text-text-muted',
          )}
        >
          {isLive ? (
            // The live pane always mirrors the app's real route — not switchable.
            <span className="flex-1 truncate">{labelFor(node.route)}</span>
          ) : (
            <RoutePicker node={node} />
          )}
          {/* The live pane is never closable — it's the app's real route. */}
          {!isLive && (
            <button
              type="button"
              title="Close pane"
              onClick={(e) => {
                e.stopPropagation();
                closePane(node.id);
              }}
              className="w-5 h-5 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <PaneContent
          route={node.route}
          liveContent={liveContent}
          title={labelFor(node.route)}
        />
      </div>
    </div>
  );
}

/** Header dropdown that re-points a pane at a different route. */
function RoutePicker({ node }: { node: Leaf }) {
  const setRoute = useLayoutStore((s) => s.setRoute);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = node.route.split('?')[0];

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex items-center gap-1 max-w-full rounded-sm px-1 -mx-1 hover:bg-bg-hover"
        title="Open a different view in this pane"
      >
        <span className="truncate">{labelFor(node.route)}</span>
        <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-[180px] bg-bg-card border border-border rounded-md shadow-lg p-1 z-50 animate-slide-up">
          {OPENABLE.map((o) => (
            <button
              key={o.path}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setRoute(node.id, o.path);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-[13px] text-text-sub hover:bg-bg-hover hover:text-text"
            >
              <span className="flex-1 text-left">{o.label}</span>
              {current === o.path && <Check className="w-3.5 h-3.5 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
