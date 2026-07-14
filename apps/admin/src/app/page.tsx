'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, bootstrapSession } from '@/lib/api';

/** Decide where to send the admin on first load. */
export default function Bootstrap() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ adminExists: boolean }>(
          '/instance/setup-status',
        );
        if (!data.adminExists) {
          router.replace('/setup');
          return;
        }
      } catch {
        // fall through to login
      }
      const ok = await bootstrapSession();
      router.replace(ok ? '/general' : '/login');
    })();
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center gap-2 text-sm text-fg-muted">
      <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
      Loading UnifyOps Admin…
    </div>
  );
}
