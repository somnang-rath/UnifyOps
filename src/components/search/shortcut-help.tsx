'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { BINDINGS, describeBinding, isMacLike } from '@/lib/shortcuts';

const subscribeNever = () => () => {};

/**
 * The `?` sheet (slice 14).
 *
 * A product with shortcuts and no way to see them has shortcuts for the person
 * who wrote them. §2.4 puts the zero-training test on every feature, and a key
 * binding is the one kind of affordance that is invisible by construction — so
 * the list is one keypress away, and the palette's own footer says which
 * keypress.
 *
 * **The table is generated from `BINDINGS`**, never written out beside it. A
 * hand-kept copy is a second source of truth that goes stale the first time a
 * binding moves, and it goes stale silently — nothing fails, the help is just
 * wrong. `messages.test.ts` covers the other half by requiring a label for every
 * member of `SHORTCUTS`.
 *
 * The key caps are not translated (`⌘`, `Ctrl`, `G`): a key cap is a thing on a
 * keyboard, not a word, and a Khmer workspace's keyboard has the same ones.
 */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('shortcuts');

  /**
   * Which modifier to draw, decided after hydration.
   *
   * `navigator.platform` does not exist on the server, so rendering `⌘` or
   * `Ctrl` during SSR would guarantee a mismatch for half of all readers. The
   * same "have I hydrated yet" store `ThemeToggle` uses, and the server snapshot
   * is simply "not a Mac" — which is what the majority of this market is on, and
   * is corrected within a frame either way.
   */
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const platform =
    mounted && isMacLike(navigator.platform ?? navigator.userAgent) ? 'mac' : 'other';

  return (
    <Dialog open={open} onClose={onClose} size="sm" label={t('title')}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-text">
          {t('title')}
        </h2>
      </div>

      <dl className="divide-y divide-border">
        {BINDINGS.map((binding) => (
          <div key={binding.id} className="flex items-center justify-between gap-4 px-4 py-2">
            <dt className="min-w-0 text-sm text-text">{t(binding.id)}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {describeBinding(binding, platform).map((cap, index) => (
                <kbd
                  key={`${binding.id}-${index}`}
                  className="rounded-xs border border-border bg-surface-sunken px-1.5 py-0.5 font-[family-name:var(--font-sans)] text-2xs font-medium text-text-muted"
                >
                  {cap}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <p className="border-t border-border px-4 py-3 text-xs text-text-muted">{t('note')}</p>
    </Dialog>
  );
}
