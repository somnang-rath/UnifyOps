'use client';
import { useEffect } from 'react';
import { useNotifications } from '@/hooks/use-notifications';

const PREFIX_RE = /^\(\d+\+?\)\s/;

export function useTabBadge(): void {
  const unread = useNotifications().data?.unread ?? 0;

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const apply = () => {
      const stripped = document.title.replace(PREFIX_RE, '');
      if (unread > 0 && document.hidden) {
        const label = unread > 99 ? '99+' : String(unread);
        document.title = `(${label}) ${stripped}`;
      } else if (document.title !== stripped) {
        document.title = stripped;
      }
    };

    apply();
    document.addEventListener('visibilitychange', apply);
    return () => {
      document.removeEventListener('visibilitychange', apply);
      document.title = document.title.replace(PREFIX_RE, '');
    };
  }, [unread]);
}
