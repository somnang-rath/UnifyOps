'use client';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from './api';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';
import type { AuthUser } from '@/schemas/auth';

/**
 * Apply server-stored UI prefs to the local theme store after a successful
 * authentication so the user's last theme/accent/density follows them across
 * devices.
 */
export function hydratePrefs(user: AuthUser) {
  const t = useThemeStore.getState();
  if (user.theme && user.theme !== t.theme) t.setTheme(user.theme);
  if (user.accent && user.accent !== t.accent) t.setAccent(user.accent as any);
  if (user.density && user.density !== t.density)
    t.setDensity(user.density);
}

/**
 * Logout: revoke server-side refresh token, clear local store, redirect.
 */
export function useLogout() {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const mutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      clear();
      router.replace('/login');
    },
  });
  return () => mutation.mutate();
}
