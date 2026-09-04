'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * §11's error state for a screen *inside* a workspace.
 *
 * The locale-level boundary already catches everything; this one exists so the
 * shell survives. A failure on the cycles page should not take the header, the
 * inbox bell, the command palette and the way back to My Work down with it —
 * and the boundary that keeps them is the one below the layout that draws
 * them.
 *
 * `reset()` re-renders this segment, which is what makes §11's "retains user
 * input" true here: a half-typed comment in a sibling client component is
 * still mounted, where a document reload would take it.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    // The digest is the only thing tying this screen to a server log line, and
    // it belongs in the console rather than on screen — §11 forbids a raw
    // error code, and a hash of a stack trace is the purest form of one.
    console.error('[unifyops] screen error', error.digest ?? '(no digest)', error.message);
  }, [error]);

  return (
    <div className="flex max-w-md flex-col items-start gap-4 py-8">
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
          {t('errors.title')}
        </h1>
        <p className="text-sm text-text-muted">{t('errors.body')}</p>
      </div>

      <Button type="button" variant="primary" onClick={reset}>
        {t('action.retry')}
      </Button>
    </div>
  );
}
