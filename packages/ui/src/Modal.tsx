'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { useFocusTrap } from './useFocusTrap';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'max-w-[380px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[720px]',
};

/**
 * Modal dialog (docs/plan/02-design-system.md §3).
 *
 * The accessibility work here is the reason this exists as a primitive rather
 * than a div in each screen: Escape closes, focus moves in on open and returns
 * to the trigger on close, Tab is trapped inside, the background does not
 * scroll, and the dialog is labelled by its own title.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Move focus into the dialog, trap Tab, restore on close — shared with Drawer.
  useFocusTrap(panelRef, { active: open && mounted, trap: true });

  React.useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      // The overlay closes on click; the panel stops propagation below.
      onMouseDown={onClose}
    >
      <div
        className="absolute inset-0 bg-[var(--overlay,rgba(10,10,30,.45))] animate-fade-in"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          'relative w-full rounded-lg border border-border bg-bg-card shadow-lg',
          'animate-modal-in outline-none',
          SIZES[size],
          className,
        )}
      >
        {(title || description) && (
          <header className="px-4 pt-3.5 pb-2.5 border-b border-border">
            {title && (
              <h2 id={titleId} className="text-md font-semibold text-text">
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="mt-0.5 text-xs text-text-muted">
                {description}
              </p>
            )}
          </header>
        )}

        <div className="px-4 py-3.5">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-border bg-bg-subtle rounded-b-lg">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
