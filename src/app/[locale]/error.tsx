'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * §11's **error** state, for everything under a locale.
 *
 * The row reads: "Plain language, says what to do next, **retains user input**.
 * Never a raw error code." All three are decisions here rather than styling:
 *
 *   * **Plain language, and no code.** `error.digest` is deliberately not on
 *     screen. It is a hash of a server stack, it means nothing to the person
 *     reading it, and a screen that shows one teaches people that the product
 *     talks to them in identifiers. It goes to the console, where the person
 *     who can use it is looking.
 *   * **Retains user input.** This boundary is *below* the workspace shell and
 *     wraps a page, so `reset()` re-renders the segment rather than reloading
 *     the document — a half-typed comment in a sibling client component
 *     survives, where `location.reload()` would take it. That is the whole
 *     reason this is a segment boundary and not a redirect to an error page.
 *   * **Bilingual.** Reachable, because the locale layout above it is what
 *     provides the messages; only `global-error` sits above that provider, and
 *     it answers the question differently.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    // The digest is the only thing that ties this screen to a server log line.
    console.error('[unifyops] render error', error.digest ?? '(no digest)', error.message);
  }, [error]);

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex max-w-md flex-col items-start gap-4 px-6 py-16"
    >
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
          {t('errors.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('errors.body')}</p>
      </div>

      <Button type="button" variant="primary" onClick={reset}>
        {t('action.retry')}
      </Button>
    </main>
  );
}
