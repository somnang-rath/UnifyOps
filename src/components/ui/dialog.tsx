'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * §12's Dialog: "400 / 560 / 720px. Focus trapped and restored. Escape closes
 * unless there are unsaved changes. Never nested."
 *
 * It arrives in slice 14 because slice 14 is the first thing that needs one —
 * the command palette. Nine slices of screens got by with pages, inline panels
 * and an expanding row, which is the outcome §12 wanted: "if a dialog needs a
 * dialog, the first one should have been a page or a sheet."
 *
 * **Built on the native `<dialog>` element, and that is the interesting
 * decision.** §8's stack table names Radix "accessible behaviour we don't
 * rebuild", and the `ui-component` skill is blunt that a focus trap must not be
 * hand-rolled. Neither is being ignored: `showModal()` *is* the platform's focus
 * trap, plus the top layer, the inert background, `aria-modal`, Escape, and
 * focus restored to whatever was focused before — the whole of what a Dialog
 * primitive would be imported for. This project has no Radix package installed
 * and has repeatedly chosen the platform over a dependency where the platform is
 * complete (SigV4 over `@aws-sdk`, `fetch` over the Resend SDK, inline SVG over a
 * charting library); this is that same call, and it is a *stronger* one, because
 * here the alternative is not our own code but the browser's.
 *
 * Three things the element does not give, which are therefore here:
 *
 *   * **Backdrop click closes.** A `<dialog>` swallows the click; the target has
 *     to be compared against the element itself, because the backdrop is the
 *     element's own box outside its padding.
 *   * **`onCancel` is Escape**, and it is intercepted rather than allowed
 *     through, so `onClose` runs exactly once whichever way the dialog closed.
 *   * **`closedBy` is not relied on.** The attribute is young; the two handlers
 *     above work everywhere and cost four lines.
 *
 * The one part of §12's row this does *not* implement is "Escape closes unless
 * there are unsaved changes". No caller has unsaved changes yet — a palette has
 * nothing to lose — so the guard would be a parameter nothing passes and nothing
 * tests. When a form lands in a dialog it arrives with the confirmation §12 asks
 * for, and this is where it goes.
 */

/** §12's three widths, and nothing between them. */
const SIZES = {
  sm: 'sm:max-w-[400px]',
  md: 'sm:max-w-[560px]',
  lg: 'sm:max-w-[720px]',
} as const;

export type DialogSize = keyof typeof SIZES;

export function Dialog({
  open,
  onClose,
  size = 'md',
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  size?: DialogSize;
  /** The accessible name. Required — a modal with no name is a defect, not a style. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    // `showModal` on an already-open dialog throws, and `close` on a closed one
    // fires nothing — so both are guarded by the element's own state rather than
    // by a second copy of it in a ref.
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      // `onCancel` is Escape. Prevented and routed through `onClose` so the
      // parent's state is the single source of whether this is open — without
      // it, Escape closes the element and leaves `open` true, and the dialog
      // never reopens.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The backdrop is this element's own box outside the panel below, so a
        // click whose target *is* the dialog landed on the backdrop.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        // Positioned rather than centred by the UA default, because a palette
        // belongs near the top of the viewport: a list that grows downward from
        // the middle of the screen jumps as results arrive.
        'fixed inset-0 m-0 max-h-none max-w-none bg-transparent p-0',
        // The element is `display: none` when closed; `open:` is the state
        // selector for the rest.
        'open:flex open:items-start open:justify-center open:p-4 sm:open:p-8',
        'backdrop:bg-overlay',
      )}
    >
      <div
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg',
          SIZES[size],
          className,
        )}
      >
        {children}
      </div>
    </dialog>
  );
}
