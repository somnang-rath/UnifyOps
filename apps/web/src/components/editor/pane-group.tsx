'use client';
import { useRef } from 'react';
import type { PaneNode } from '@/stores/layout-store';
import { useLayoutStore } from '@/stores/layout-store';
import { EditorPane } from './editor-pane';
import { Resizer } from './resizer';
import { cn } from '@/lib/utils';

/**
 * Renders the editor pane tree. When the layout is a single leaf (the common
 * case) it passes `children` straight through so normal pages are untouched.
 * When split, it lays the tree out with flex containers and resizers.
 */
export function PaneGroup({ children }: { children: React.ReactNode }) {
  const root = useLayoutStore((s) => s.root);

  if (root.type === 'leaf') return <>{children}</>;

  return (
    <div className="h-full w-full min-h-0 min-w-0">
      <Node node={root} liveContent={children} />
    </div>
  );
}

function Node({
  node,
  liveContent,
}: {
  node: PaneNode;
  liveContent: React.ReactNode;
}) {
  if (node.type === 'leaf') {
    return <EditorPane node={node} liveContent={liveContent} showChrome />;
  }
  return <SplitView node={node} liveContent={liveContent} />;
}

function SplitView({
  node,
  liveContent,
}: {
  node: PaneNode & { type: 'split' };
  liveContent: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isRow = node.dir === 'row';

  return (
    <div
      ref={ref}
      className={cn(
        'flex h-full w-full min-h-0 min-w-0',
        // Row splits stack vertically on small screens so panes stay usable.
        isRow ? 'flex-col md:flex-row' : 'flex-col',
      )}
    >
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flexGrow: node.sizes[0], flexBasis: 0 }}
      >
        <Node node={node.children[0]} liveContent={liveContent} />
      </div>
      <Resizer
        splitId={node.id}
        dir={node.dir}
        sizes={node.sizes}
        containerRef={ref}
      />
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        style={{ flexGrow: node.sizes[1], flexBasis: 0 }}
      >
        <Node node={node.children[1]} liveContent={liveContent} />
      </div>
    </div>
  );
}
