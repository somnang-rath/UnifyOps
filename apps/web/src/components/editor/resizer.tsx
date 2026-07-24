'use client';
import { useCallback } from 'react';
import type { SplitDir } from '@/stores/layout-store';
import { useLayoutStore } from '@/stores/layout-store';
import { cn } from '@/lib/utils';

/**
 * Draggable divider between the two children of a split node. Reads the parent
 * flex container's size on drag and writes fractional sizes back to the store.
 */
const STEP = 0.02; // keyboard nudge, as a fraction of the container

export function Resizer({
  splitId,
  dir,
  sizes,
  containerRef,
}: {
  splitId: string;
  dir: SplitDir;
  sizes: [number, number];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const resize = useLayoutStore((s) => s.resize);

  const nudge = (delta: number) => {
    const a = Math.min(0.9, Math.max(0.1, sizes[0] + delta));
    resize(splitId, [a, 1 - a]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dec = dir === 'row' ? 'ArrowLeft' : 'ArrowUp';
    const inc = dir === 'row' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === dec) {
      e.preventDefault();
      nudge(-STEP);
    } else if (e.key === inc) {
      e.preventDefault();
      nudge(STEP);
    }
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        const frac =
          dir === 'row'
            ? (ev.clientX - rect.left) / rect.width
            : (ev.clientY - rect.top) / rect.height;
        const a = Math.min(0.9, Math.max(0.1, frac));
        resize(splitId, [a, 1 - a]);
      };
      const up = (ev: PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = dir === 'row' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [containerRef, dir, resize, splitId],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(sizes[0] * 100)}
      aria-valuemin={10}
      aria-valuemax={90}
      aria-label="Resize panes"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'relative z-10 flex-shrink-0 group outline-none focus-visible:bg-accent',
        dir === 'row'
          ? 'w-px cursor-col-resize hover:w-0.5'
          : 'h-px cursor-row-resize hover:h-0.5',
        // On small screens a row split stacks vertically, so its vertical
        // divider would be misaligned — hide it there (drag is desktop-only).
        dir === 'row' && 'max-md:hidden',
        'bg-border',
      )}
    >
      {/* Fat invisible hit area so the 1px line is easy to grab. */}
      <span
        className={cn(
          'absolute group-hover:bg-accent/40 transition-colors',
          dir === 'row'
            ? '-left-1 -right-1 inset-y-0'
            : '-top-1 -bottom-1 inset-x-0',
        )}
      />
    </div>
  );
}
