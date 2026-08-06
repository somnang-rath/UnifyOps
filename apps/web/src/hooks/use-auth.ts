'use client';
import { useMutation } from '@tanstack/react-query';
import { api, AUDIENCE } from '@/lib/api';
import { hydratePrefs } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth-store';
import type {
  AuthResponse,
  LoginInput,
  RegisterInput,
} from '@/schemas/auth';

const onAuthSuccess = (r: AuthResponse) => {
  useAuthStore.getState().setAuth(r.accessToken, r.user);
  hydratePrefs(r.user);
};

/**
 * True when the just-signed-in user's language differs from the one this
 * document was server-rendered in (ADR 0016 §2.1). The cookie is already
 * written by then, so the fix is a *hard* navigation rather than a client
 * transition: the root layout — `<html lang>` included — only re-renders on a
 * real request.
 */
export const localeNeedsFullNavigation = (user: AuthResponse['user']): boolean =>
  typeof document !== 'undefined' &&
  document.documentElement.lang !== (user.locale ?? 'en');

export function useLogin() {
  return useMutation({
    mutationFn: (i: LoginInput) =>
      api
        .post<AuthResponse>('/auth/login', { ...i, audience: AUDIENCE })
        .then((r) => r.data),
    onSuccess: onAuthSuccess,
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (i: RegisterInput) =>
      api.post<AuthResponse>('/auth/register', i).then((r) => r.data),
    onSuccess: onAuthSuccess,
  });
}

export function useAcceptInvite() {
  return useMutation({
    mutationFn: (i: { token: string; password: string }) =>
      api.post<AuthResponse>('/auth/accept-invite', i).then((r) => r.data),
    onSuccess: onAuthSuccess,
  });
}
