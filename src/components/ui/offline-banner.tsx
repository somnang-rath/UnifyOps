'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * §11's **edge** row names offline among the states every view owes the user,
 * and §2.5-3's market is phone-heavy on connections that drop.
 *
 * **What this says is exactly what the product can promise, and no more.**
 * §7.2 asks for something larger — "`[X]` offline → item held locally, marked
 * pending, retried; never lost on refresh" — and that queue is not built. A
 * banner reading "your changes are waiting" would be the product lying about a
 * mechanism it does not have, on the one screen somebody is already unsure
 * whether their work was saved. So it says the true thing: you are offline, and
 * what you do now may not be saved.
 *
 * Three details:
 *
 *   * **It renders nothing until an effect has run.** The server cannot know
 *     whether a browser it has never met has a connection, so rendering from
 *     `navigator.onLine` during SSR is a hydration mismatch — and the wrong half
 *     of it flashes an offline warning at everybody.
 *   * **The initial state is read once, in the effect.** A tab restored from
 *     the background may already be offline with no event to hear.
 *   * **`role="status"`, not `alert`.** Losing a connection is not an error
 *     somebody made, and `alert` interrupts a screen reader mid-sentence for
 *     something the reader can do nothing about this second.
 *
 * `navigator.onLine` is famously optimistic — it reports a connection to a
 * router that reaches nothing. That makes it useful for the negative case only,
 * which is the only case this component has: when it says offline, it is right.
 */
export function OfflineBanner() {
  const t = useTranslations('errors');
  const [offline, setOffline] = useState<boolean | null>(null);

  useEffect(() => {
    const read = () => setOffline(!navigator.onLine);
    read();

    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    return () => {
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning bg-warning-subtle px-4 py-2 text-xs sm:px-6"
    >
      <p className="font-medium text-text">{t('offlineTitle')}</p>
      <p className="text-text-muted">{t('offlineBody')}</p>
    </div>
  );
}
