'use client';
import * as React from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

    const restore = document.activeElement as HTMLElement | null;

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
      restore?.focus?.();
    };
  }, [active, trap, panelRef]);
}
