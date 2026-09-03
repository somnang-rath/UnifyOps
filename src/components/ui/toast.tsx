'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,

  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * §12's Toast: "Bottom-right, 5s auto-dismiss, action slot for Undo, max 3
 * stacked."
 *
 * It arrives in slice 6 because slice 6 is the first thing that needs one.
 * §11's rule is that a toast appears **only when the result is not visible on
 * screen** — which is why slice 5 shipped without one: a refused state change
 * reports in the row that caused it, and a toast about a row you are looking at
 * is noise. A refused *drag* is the opposite case. The card animates back to
 * where it started, and nothing on screen says why it did (§7.5), so the
 * sentence has to come from somewhere.
 *
 * Three constraints that are not decoration:
 *
 *   * **`max 3`, dropping the oldest.** A board that refuses ten drags in a row
 *     because a session expired would otherwise bury the screen in its own
 *     error messages.
 *   * **The timer pauses on hover and on focus.** Five seconds is not long
 *     enough to read a sentence in a second language, and someone reaching for
 *     the Undo button is someone who has not finished reading.
 *   * **`aria-live="polite"` on a container that is always in the DOM.** A live
 *     region inserted at the same moment as its content is not announced by
 *     several screen readers; the region has to be there first, empty.
 */

export type ToastTone = 'info' | 'danger';

export type ToastSpec = {
  /** Already translated. Nothing in this module knows about message keys. */
  message: string;
  tone?: ToastTone;
  action?: { label: string; onAction: () => void };
};

type Toast = ToastSpec & { id: number };

const MAX_STACKED = 3;
const DISMISS_AFTER_MS = 5_000;

const ToastContext = createContext<((toast: ToastSpec) => void) | null>(null);

/**
 * `null` rather than a throw when there is no provider, so a component can be
 * rendered in a test or a story without one and simply not toast.
 */
export function useToast(): (toast: ToastSpec) => void {
  const push = useContext(ToastContext);
  return useCallback(
    (toast: ToastSpec) => {
      push?.(toast);
    },
    [push],
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((spec: ToastSpec) => {
    nextId.current += 1;
    const toast = { ...spec, id: nextId.current };
    // Oldest out, not newest refused: the most recent failure is the one the
    // person just caused and the one they are looking for.
    setToasts((current) => {
      const next = [...current, toast];
      while (next.length > MAX_STACKED) next.shift();
      return next;
    });
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}

      {/* Always mounted, even when empty — see the note above. `pointer-events-none`
          on the region and `auto` on each toast, so an empty region never sits
          over the board swallowing drags. */}
      <div
        aria-live="polite"
        aria-label={t('toast.region')}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:end-0"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONES: Record<ToastTone, string> = {
  info: 'border-border bg-surface-raised',
  danger: 'border-danger bg-danger-subtle',
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const t = useTranslations();
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (held) return;
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [held, onDismiss]);

  return (
    <div
      // `onFocus`/`onBlur` bubble from the buttons inside, which is the point:
      // a keyboard user tabbing to Undo holds the toast open by doing so.
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-3 py-2.5 shadow-md',
        TONES[toast.tone ?? 'info'],
      )}
    >
      <p className="min-w-0 flex-1 text-sm text-text">{toast.message}</p>

      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
          className="shrink-0 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {toast.action.label}
        </button>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('toast.dismiss')}
        className="-me-1 shrink-0 rounded-xs p-0.5 text-text-subtle transition-colors duration-120 hover:text-text"
      >
        <X size={14} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
