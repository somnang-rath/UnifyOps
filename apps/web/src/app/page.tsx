'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { refreshAuth } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Landing router. The access token lives in memory only, so on a fresh
 * page load (including the OAuth callback's `302 → /`, ADR 0008 §4) the
 * store is empty even when a refresh cookie exists — bootstrap the session
 * via /auth/refresh before deciding between /home and /login.
 */
export default function Home() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const triedRef = useRef(false);

  useEffect(() => {
    if (user) {
      router.replace('/home');
      return;
    }
    if (triedRef.current) return;
    triedRef.current = true;
    refreshAuth().then(() => {
      if (!useAuthStore.getState().user) router.replace('/login');
      // On success the store update re-runs this effect → /home.
    });
  }, [user, router]);

  return null;
}
