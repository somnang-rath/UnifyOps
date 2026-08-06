'use client';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { LOCALE_COOKIE, isLocale, persistLocale } from '@prism/i18n';
import { api, AUDIENCE } from './api';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import type { AuthUser } from '@/schemas/auth';

/**
 * Apply server-stored UI prefs to the local theme store after a successful
 * authentication so the user's last theme/accent/density follows them across
 * devices.
 *
 * Returns whether the locale it applied disagrees with the document that is
 * currently on screen — see {@link hydrateLocale}. The caller decides what to do
 * about it, because the right answer differs between "restoring a session on
 * this page" and "about to navigate somewhere else anyway".
 */
export function hydratePrefs(user: AuthUser): boolean {
  const t = useThemeStore.getState();
  if (user.theme && user.theme !== t.theme) t.setTheme(user.theme);
  if (user.accent && user.accent !== t.accent) t.setAccent(user.accent as any);
  if (user.density && user.density !== t.density)
    t.setDensity(user.density);
  return hydrateLocale(user);
}

/**
 * `User.locale` → the `pr_locale` cookie, but **only when the browser has no
 * cookie yet** (ADR 0016 §2.1: the cookie wins for the request, the record is
 * the cross-device default). Overwriting an existing cookie would make the
 * switcher un-switch itself on the next refresh, since this runs on every boot.
 *
 * Writing the cookie is not enough on its own: this page was already rendered
 * in whatever the middleware resolved *without* it. Hence the return value —
 * true means the document on screen is in the wrong language and only a trip
 * through the server can fix it.
 *
 * It does **not** reload here, and that is the whole point. This runs inside
 * `onAuthSuccess`, i.e. one line before the login page navigates: a reload at
 * that moment cancels the navigation and drops the user back on `/login`,
 * looking exactly like a failed sign-in. (It did, for one run.)
 */
function hydrateLocale(user: AuthUser): boolean {
  if (typeof document === 'undefined') return false;
  const hasCookie = document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  if (hasCookie || !isLocale(user.locale)) return false;

  persistLocale(user.locale);
  return document.documentElement.lang !== user.locale;
}

/**
 * Logout: revoke server-side refresh token, clear local store, redirect.
 */
export function useLogout() {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const mutation = useMutation({
    mutationFn: () => api.post('/auth/logout', { audience: AUDIENCE }),
    onSettled: () => {
      clear();
      router.replace('/login');
    },
  });
  return () => mutation.mutate();
}
