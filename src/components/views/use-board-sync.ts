'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Board revalidation (§8, §17-2, §17-24).
 *
 * "Not realtime, but never silently stale." The board polls a **change token** —
 * one indexed aggregate, `max(updated_at)` plus a row count for the current
 * filter — and only refetches when the token moves. §8 fixes the whole schedule,
 * and every row of that table is implemented here:
 *
 * | Condition                     | Behaviour                                  |
 * | ----------------------------- | ------------------------------------------ |
 * | Tab visible                   | Poll every 20s                             |
 * | Token unchanged               | Back off 20 → 40 → 60s cap                 |
 * | Tab hidden                    | Stop entirely                              |
 * | Window regains focus          | Immediate revalidate, then resume at 20s   |
 * | `saveData`, `2g` / `slow-2g`  | Focus and mutation revalidation only       |
 *
 * **The last two rows are not a nicety.** §2.5-5 is a cost-sensitive market on
 * mobile data, and §17-24 is explicit that leaving the interval unspecified
 * means somebody picks 5s and a forgotten background tab bills someone's data
 * plan all afternoon. A quiet board costs a few hundred bytes a minute and a
 * phone in a pocket costs nothing.
 *
 * The hook owns *when* to look, never what to do about it: `onChanged` is the
 * caller's, and on this board it is `router.refresh()`.
 */

const BASE_INTERVAL_MS = 20_000;
const MAX_INTERVAL_MS = 60_000;

/** The slice of the Network Information API this needs. Not in lib.dom. */
type Connection = { saveData?: boolean; effectiveType?: string };

function isFrugal(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    connection.effectiveType === '2g' ||
    connection.effectiveType === 'slow-2g'
  );
}

export function useBoardSync({
  workspaceSlug,
  query,
  token,
  onChanged,
}: {
  workspaceSlug: string;
  /** The page's query string, so the token covers exactly the rows on screen. */
  query: string;
  /** The token the server rendered with. */
  token: string;
  onChanged: () => void;
}) {
  // Refs rather than state throughout: every one of these changing should
  // adjust the *next* poll, never re-run the effect and restart the schedule.
  const seen = useRef(token);
  const interval = useRef(BASE_INTERVAL_MS);
  const changed = useRef(onChanged);

  // Both writes are in an effect rather than in the render body: React 19
  // refuses a ref written during render, and rightly — a render that mutates
  // something outside itself is not one React can discard and retry.
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  // A server render carrying a new token has already delivered the change, so
  // the poll starts again from that point rather than reporting it twice.
  useEffect(() => {
    seen.current = token;
  }, [token]);

  const check = useCallback(async () => {
    try {
      const url = `/api/internal/list?w=${encodeURIComponent(workspaceSlug)}&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;

      const next = ((await response.json()) as { token?: string }).token;
      if (typeof next !== 'string' || next === seen.current) {
        // Nothing moved: look less often, up to the cap.
        interval.current = Math.min(interval.current * 2, MAX_INTERVAL_MS);
        return;
      }

      seen.current = next;
      interval.current = BASE_INTERVAL_MS;
      changed.current();
    } catch {
      // A failed poll is not worth telling anyone about — the board on screen
      // is still the board the server last sent. Back off and try later.
      interval.current = Math.min(interval.current * 2, MAX_INTERVAL_MS);
    }
  }, [workspaceSlug, query]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const schedule = () => {
      clear();
      // Hidden tabs poll nothing, and a frugal connection has no timer at all —
      // it revalidates on focus and on the user's own mutations instead.
      if (stopped || document.hidden || isFrugal()) return;
      timer = setTimeout(run, interval.current);
    };

    const run = async () => {
      await check();
      schedule();
    };

    const onVisibility = () => {
      if (document.hidden) {
        clear();
        return;
      }
      // Regaining focus is the one moment worth an immediate look: the board
      // has been unwatched and is the most likely to be wrong.
      interval.current = BASE_INTERVAL_MS;
      void run();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);

    return () => {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [check]);

  /**
   * Called after a local mutation. §8: any local change resets the backoff, and
   * the board looks again promptly rather than waiting out a 60s interval it
   * earned while nothing was happening.
   */
  return useCallback(() => {
    interval.current = BASE_INTERVAL_MS;
    void check();
  }, [check]);
}
