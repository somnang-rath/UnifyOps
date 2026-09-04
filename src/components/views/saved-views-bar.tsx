'use client';

import { useActionState, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Bookmark, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { IDLE } from '@/lib/form-state';
import { MAX_VIEW_NAME_LENGTH, sameQuery } from '@/lib/saved-views';
import {
  createSavedViewAction,
  deleteSavedViewAction,
  updateSavedViewAction,
} from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * §4's saved views, as a bar of chips above the view (slice 12).
 *
 * **A saved view is a name for a URL**, so every chip is a `Link` and switching
 * to one is navigation — middle-clickable, back-buttonable, shareable at every
 * point, exactly as `ViewSwitcher` is and for the reasons it gives. The whole
 * feature is §5's "any view state is a URL" with somewhere to write the name
 * down, which is why it needed no new filter concept and no second query.
 *
 * **Inline, never a dialog** (§5: "no modal chains anywhere in the default
 * path"). Saving is a name field and a button that appear where the chips are;
 * §12's Dialog is for a decision that needs the rest of the screen out of the
 * way, and naming a bookmark is not one.
 *
 * The five states (§11). Loading: the two buttons carry their own pending
 * labels rather than replacing the bar with skeletons — the chips beside them
 * are still correct. Empty: no chips, and the save control alone, which says
 * what this row is for by being the only thing in it. Success: the new chip
 * arrives with the server render, and there is no toast because the result is
 * on screen. Error: beside the input that caused it, in plain language, with
 * the typed name kept — the composer rule from §7.7 applies to any input a
 * refusal can land on. Edge: a name longer than the field allows is refused by
 * grapheme (§13), and a view whose filter names a deleted label still opens,
 * one filter wider, because the DSL discards what it cannot parse.
 */

export type SavedViewChip = {
  id: string;
  name: string;
  /** The stored query string, without the leading `?`. */
  query: string;
};

export function SavedViewsBar({
  views,
  currentQuery,
  pathname,
  workspaceSlug,
  projectSlug,
  projectId,
  locale,
}: {
  views: readonly SavedViewChip[];
  /** The query string on screen, with or without its `?`. */
  currentQuery: string;
  /** The project's path, without locale — `Link` adds that. */
  pathname: string;
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  locale: string;
}) {
  const t = useTranslations();
  const [state, submit, saving] = useActionState(createSavedViewAction, IDLE);
  const [naming, setNaming] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = views.find((view) => sameQuery(view.query, currentQuery)) ?? null;

  function update(viewId: string) {
    startTransition(async () => {
      setRowError(null);
      const result = await updateSavedViewAction({
        workspaceSlug,
        projectSlug,
        locale,
        viewId,
        query: currentQuery,
      });
      if (result.error) setRowError(result.error);
    });
  }

  function remove(viewId: string) {
    startTransition(async () => {
      setRowError(null);
      const result = await deleteSavedViewAction({
        workspaceSlug,
        projectSlug,
        locale,
        viewId,
      });
      if (result.error) setRowError(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-text-subtle">
        <Bookmark size={13} strokeWidth={1.5} aria-hidden />
        {t('savedViews.title')}
      </span>

      {views.map((view) => {
        const current = active?.id === view.id;
        return (
          <span key={view.id} className="inline-flex items-center">
            <Link
              href={`${pathname}?${view.query}`}
              // `page` rather than `true`: this is which saved view of this
              // screen is showing, which is what a screen reader announces as
              // current — the same choice `ViewSwitcher` makes.
              aria-current={current ? 'page' : undefined}
              className={cn(
                'inline-flex h-7 max-w-48 items-center rounded-xs border px-2 text-xs',
                'transition-colors duration-120 ease-[var(--ease-out-soft)]',
                current
                  ? 'border-accent bg-accent-subtle text-text'
                  : 'border-border bg-surface text-text-muted hover:text-text',
              )}
            >
              {/* A view's name is the company's own words and is never
                  translated (§13); it truncates by CSS because this is a
                  visual clamp on one line rather than a shortening of data. */}
              <span className="truncate">{view.name}</span>
            </Link>

            {current && (
              <span className="ms-1 inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => update(view.id)}
                  disabled={pending}
                  title={t('savedViews.update')}
                  aria-label={t('savedViews.updateNamed', { name: view.name })}
                  className="inline-flex size-6 items-center justify-center rounded-xs text-text-subtle transition-colors duration-120 hover:text-text disabled:opacity-60"
                >
                  <Check size={13} strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => remove(view.id)}
                  disabled={pending}
                  title={t('savedViews.delete')}
                  aria-label={t('savedViews.deleteNamed', { name: view.name })}
                  className="inline-flex size-6 items-center justify-center rounded-xs text-text-subtle transition-colors duration-120 hover:text-danger disabled:opacity-60"
                >
                  <Trash2 size={13} strokeWidth={1.5} aria-hidden />
                </button>
              </span>
            )}
          </span>
        );
      })}

      {naming ? (
        <form action={submit} className="flex items-end gap-1.5">
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="projectSlug" value={projectSlug} />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="locale" value={locale} />
          {/* The query as rendered. Sent rather than reconstructed on the
              server, because the server would have to guess which of the
              request's parameters were the view's — and the answer is "the ones
              the bar was drawn with". */}
          <input type="hidden" name="query" value={stripLeadingQuestionMark(currentQuery)} />

          <span className="flex flex-col gap-0.5">
            <input
              name="name"
              autoFocus
              required
              maxLength={MAX_VIEW_NAME_LENGTH * 4}
              placeholder={t('savedViews.namePlaceholder')}
              aria-label={t('savedViews.name')}
              aria-invalid={state.fields?.name ? true : undefined}
              className="h-7 w-40 rounded-xs border border-border bg-surface px-2 text-xs text-text placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            />
            {state.fields?.name && (
              <span role="alert" className="text-2xs text-danger">
                {t(state.fields.name)}
              </span>
            )}
          </span>

          {/* §12: loading replaces the label with a spinner at preserved
              width, so nothing on the bar reflows while it saves. */}
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {t('savedViews.save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>
            {t('action.cancel')}
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="inline-flex h-7 items-center rounded-xs border border-dashed border-border px-2 text-xs text-text-muted transition-colors duration-120 hover:text-text"
        >
          {t('savedViews.saveCurrent')}
        </button>
      )}

      {rowError && (
        <span role="alert" className="text-2xs text-danger">
          {t(rowError)}
        </span>
      )}
    </div>
  );
}

/**
 * The stored form of a query string.
 *
 * The column holds one shape and not two, and the service normalises this
 * anyway — doing it here as well keeps the hidden field honest about what is
 * being saved, which matters because this is the value a person is naming.
 */
function stripLeadingQuestionMark(query: string): string {
  return query.replace(/^\?/, '');
}
