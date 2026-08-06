'use client';
import * as React from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The last element focused *outside* any dialog — i.e. where focus should go
 * when an overlay closes.
 *
 * Module level, and listening from import time, on purpose. Reading
 * `document.activeElement` when the overlay opens is too late in two separate
 * ways, and both are silent:
 *
 *  1. React applies a child's `autoFocus` during the commit, *before* any
 *     passive effect runs — so the hook would capture the dialog's own first
 *     field, then "restore" to it on close. By then it is detached, `.focus()`
 *     no-ops, and the user is dumped on `<body>`.
 *  2. A dialog whose component only mounts when it opens has no earlier moment
 *     to observe at all.
 *
 * Tracking continuously and filtering out anything inside a dialog sidesteps
 * both. `focusin` bubbles (unlike `focus`), so one document listener sees every
 * focus change on the page.
 */
let lastFocusedOutsideDialog: HTMLElement | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    // Never restore focus *into* an overlay — that is what we are leaving.
    if (target.closest('[role="dialog"]')) return;
    lastFocusedOutsideDialog = target;
  });
}

/**
 * Focus management shared by `Modal` and `Drawer` (issue-peek spec §1.2).
 *
 * - `trap: true`  — dialog semantics: focus the first focusable on open, keep
 *   Tab cycling inside the panel, restore focus to the trigger on close.
 * - `trap: false` — non-modal overlay (peek): focus the panel container itself
 *   (`tabIndex={-1}`) so keys land inside, but let Tab walk out — the page
 *   behind is interactive by design. Focus is still restored on close.
 *
 * Escape handling and scroll locking deliberately stay with the caller: Modal
 * and Drawer differ on both.
 */
export function useFocusTrap(
  panelRef: React.RefObject<HTMLElement | null>,
  { active, trap = true }: { active: boolean; trap?: boolean },
) {
  React.useEffect(() => {
    if (!active) return;

    // Captured now, while it still points outside the dialog — see the note on
    // `lastFocusedOutsideDialog`. Reading it in the cleanup instead would pick
    // up whatever a *later* overlay recorded.
    const restore = lastFocusedOutsideDialog;

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((el) => el.offsetParent !== null);

    if (trap) {
      (focusables()[0] ?? panelRef.current)?.focus();
    } else {
      panelRef.current?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (!trap || e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // `isConnected`: the trigger can legitimately disappear while the overlay
      // is open (a row deleted from under a peek). Focusing a detached node is
      // silently a no-op, so check rather than pretend it worked.
      if (restore?.isConnected) restore.focus();
    };
  }, [active, trap, panelRef]);
}
