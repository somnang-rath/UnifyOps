'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';

const subscribeNever = () => () => {};

const options = [
  { value: 'light', Icon: Sun },
  { value: 'dark', Icon: Moon },
  { value: 'system', Icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations('theme');

  // The active theme is unknown until the client hydrates, so rendering the
  // checked state on the server would guarantee a mismatch. This is the
  // "have I hydrated yet" store: it never changes, so it never resubscribes,
  // and the server snapshot is simply false.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  return (
    <div
      role="radiogroup"
      aria-label={t('label')}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
    >
      {options.map(({ value, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            // §11: every icon-only control has an accessible name.
            aria-label={t(value)}
            title={t(value)}
            onClick={() => setTheme(value)}
            className={
              'flex size-7 items-center justify-center rounded-sm transition-colors ' +
              (active
                ? 'bg-accent text-accent-fg'
                : 'text-text-subtle hover:bg-surface-hover hover:text-text')
            }
          >
            <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
