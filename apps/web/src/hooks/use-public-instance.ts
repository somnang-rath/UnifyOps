'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Shape of the unauthenticated `GET /instance` payload. `config` values are
 * *effective* booleans — e.g. `GOOGLE_OAUTH_ENABLED` is true only when the
 * toggle is on AND credentials exist (ADR 0008 §1). The client never learns
 * why a provider is off, just the boolean.
 */
export interface PublicInstance {
  instanceId: string;
  instanceName: string;
  currentVersion: string;
  isSetupDone: boolean;
  adminExists: boolean;
  config: Record<string, boolean>;
}

/** Public instance config — drives login-method affordances (OAuth buttons). */
export function usePublicInstance() {
  return useQuery({
    queryKey: ['instance', 'public'],
    staleTime: 5 * 60_000,
    queryFn: () =>
      api
        .get<PublicInstance>('/instance', { _skipErrorToast: true })
        .then((r) => r.data),
  });
}
