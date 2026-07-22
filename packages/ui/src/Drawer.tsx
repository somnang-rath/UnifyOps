'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { useFocusTrap } from './useFocusTrap';

export interface DrawerProps {
  open: boolean;
  /** Called for every close intent: Esc, backdrop, close button in `header`. */
  onClose: () => void;
  side?: 'right' | 'left';
  /** Max width on ≥sm screens. Full-width below sm regardless. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * true  → Modal-style: dimmed backdrop, focus trap, body scroll lock.
   * false → Peek-style: page behind stays visible AND interactive on ≥lg;
   *         below lg a dimmed tap-to-close backdrop is still rendered
   *         because a full-width panel over an unreachable page needs one.
   */
  modal?: boolean;
  /** Suppress the Esc handler while a child Modal/Confirm is open on top. */
  disableEscape?: boolean;
  /** Sticky header row (caller renders its own close button here). */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Accessible name — required unless `aria-labelledby` is passed. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Key events from anywhere inside the panel (header included). */
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  className?: string;
}

const SIZES = {
  sm: 'sm:max-w-[380px]',
  md: 'sm:max-w-[var(--peek-w,480px)]',
  lg: 'sm:max-w-[640px]',
};

/**
 * Generic side panel (issue-peek spec §1).
 *
 * An overlay, not a push: the panel floats over the page and the layout behind
 * never reflows. Sits at z-40 — deliberately *below* Modal's z-50, so a Modal
 * or Confirm opened from inside the drawer stacks correctly on top. While such
 * a child is open the caller must pass `disableEscape`: Modal's own Esc handler
 * calls `stopPropagation()`, which does not stop sibling listeners on
 * `document`, so without the flag one Esc would close both layers.
 */
export function Drawer({
  open,
  onClose,
  side = 'right',
  size = 'md',
  modal = true,
  disableEscape = false,
  header,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  onKeyDown,
  className,
}: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Focus: trap inside when modal; non-modal just focuses the panel container
  // (no trap — the page behind is interactive by design). Restored on close.
  useFocusTrap(panelRef, { active: open && mounted, trap: modal });

  // Esc — document-level so it works wherever focus sits.
  React.useEffect(() => {
    if (!open || disableEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, disableEscape, onClose]);

  // Body scroll lock only in modal mode — in peek mode the list behind must
  // keep scrolling.
  React.useEffect(() => {
    if (!open || !modal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open, modal]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-40 flex',
        side === 'right' ? 'justify-end' : 'justify-start',
      )}
      // In non-modal mode the container must NOT eat clicks meant for the page.
      style={modal ? undefined : { pointerEvents: 'none' }}
    >
      {/* Backdrop: always in modal mode; below lg only in peek mode. */}
      <div
        aria-hidden="true"
        onMouseDown={onClose}
        className={cn(
          'absolute inset-0 bg-[var(--overlay,rgba(10,10,30,.45))] animate-fade-in',
          modal ? '' : 'lg:hidden pointer-events-auto',
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'relative pointer-events-auto flex h-full w-full flex-col outline-none',
          'bg-bg-card shadow-xl animate-sheet-in',
          side === 'right' ? 'border-l border-border' : 'border-r border-border',
          SIZES[size],
          className,
        )}
      >
        {header && (
          <header className="sticky top-0 z-10 flex h-10 flex-shrink-0 items-center gap-1 border-b border-border bg-bg-card px-3">
            {header}
          </header>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
