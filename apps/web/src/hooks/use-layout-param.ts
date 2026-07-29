'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * `?layout=` for Tier W list routes — the param ADR 0011 §4 reserved.
 *
 * Precedence is **URL > localStorage > fallback**. A pasted link shows the
 * layout it names; a bare route reopens in whatever the user last chose here.
 *
 * Two deliberate behaviours:
 *
 * - **The URL is only written once the user picks a layout.** Bare routes stay
 *   bare, so `/acme/projects` never grows a param nobody asked for, and the
 *   remembered choice still applies.
 * - **localStorage is adopted in an effect, not during render.** The server
 *   render has no `localStorage`; reading it in the initial state would make
 *   the first client render disagree with the HTML it hydrates.
 *
 * Writes use `router.replace` — switching layouts five times must not cost
 * five presses of Back.
 */
export function useLayoutParam<T extends string>(
  values: readonly T[],
  fallback: T,
  storageKey: string,
): [T, (v: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const isValid = useCallback(
    (v: string | null | undefined): v is T =>
      !!v && (values as readonly string[]).includes(v),
    [values],
  );

  // An unknown `?layout=junk` falls back rather than rendering nothing.
  const fromUrl = params.get('layout');
  const urlLayout = isValid(fromUrl) ? fromUrl : null;

  const [stored, setStored] = useState<T | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (isValid(v)) setStored(v);
    } catch {
      // private mode / storage disabled — the fallback is still correct
    }
  }, [storageKey, isValid]);

  const layout = urlLayout ?? stored ?? fallback;

  const setLayout = useCallback(
    (v: T) => {
      setStored(v);
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        // ignore — the URL still carries the choice for this navigation
      }
      const next = new URLSearchParams(params);
      next.set('layout', v);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router, storageKey],
  );

  return [layout, setLayout];
}
