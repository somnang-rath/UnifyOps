'use client';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import {
  useThemeStore,
  type Accent,
  type Density,
  type Theme,
} from '@/stores/theme-store';
import type { AuthUser } from '@/schemas/auth';

type PrefsPatch = {
  theme?: Theme;
  accent?: Accent;
  density?: Density;
};

/**
 * Returns theme setters that update the local store, persist to localStorage
 * (via the store's apply()), and silently push the change to the server so
 * hydratePrefs() doesn't revert it on the next login/refresh.
 */
export function useThemePrefs() {
  const setUser = useAuthStore((s) => s.setUser);
  const setThemeLocal = useThemeStore((s) => s.setTheme);
  const setAccentLocal = useThemeStore((s) => s.setAccent);
  const setDensityLocal = useThemeStore((s) => s.setDensity);

  const persist = (patch: PrefsPatch) => {
    api
      .patch<AuthUser>('/users/me', patch)
      .then((r) => setUser(r.data))
      .catch(() => {});
  };

  return {
    setTheme: (t: Theme) => {
      setThemeLocal(t);
      persist({ theme: t });
    },
    setAccent: (a: Accent) => {
      setAccentLocal(a);
      persist({ accent: a });
    },
    setDensity: (d: Density) => {
      setDensityLocal(d);
      persist({ density: d });
    },
  };
}
