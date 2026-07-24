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
