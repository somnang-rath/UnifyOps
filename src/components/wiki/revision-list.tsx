'use client';

import { useActionState, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { hasKhmer } from '@/lib/search';

export type RevisionEntry = {
  id: string;
  revisionNo: number;
  title: string;
  authorName: string | null;
  createdAt: string;
};

/**
 * A page's history (§20.2's "who and when", §20.11's history screen).
 *
 * **Never empty**, which §20.11 states as the reason it has no empty state: "a
 * page has at least one revision", written by `createPage` in the same
 * transaction as the page itself. A screen that cannot be empty should not carry
 * an empty state, because an empty state that can never render is an empty state
 * nobody ever checks.
 *
 * Two revisions can be selected for the side-by-side compare, and the selection
 * is a **link** rather than client state once both are chosen: §5's rule that a
 * view worth looking at is a URL worth sharing, and the same call slice 7 made
 * when it made "show all activity" a `Link` rather than a button.
 */
export function RevisionList({
  revisions,
  workspaceSlug,
  locale,
  spaceSlug,
  pageSlug,
  pageId,
  currentRevision,
  canWrite,
  restore,
}: {
  revisions: RevisionEntry[];
  workspaceSlug: string;
  locale: 'en' | 'km';
  spaceSlug: string;
  pageSlug: string;
  pageId: string;
  currentRevision: number;
  canWrite: boolean;
  restore: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const format = useFormatter();

  /**
   * The two revisions being compared, in click order.
   *
   * A pair rather than a set, because the comparison has a direction — older on
   * the left. Clicking a third replaces the older of the two, which is what
   * makes repeated clicking walk backwards through the history rather than
   * needing a clear button.
   */
  const [selected, setSelected] = useState<number[]>([]);

  const toggle = (revisionNo: number) => {
    setSelected((current) => {
      if (current.includes(revisionNo)) {
        return current.filter((value) => value !== revisionNo);
      }
      // An array of two numbers, never text — the §13 truncation rule does not
      // apply and the design-token hook's heuristic correctly cannot tell.
      const next = [...current, revisionNo];
      return next.length > 2 ? next.slice(next.length - 2) : next;
    });
  };

  const [from, to] = [...selected].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      {from !== undefined && to !== undefined && from !== to && (
        <Alert>
          <span className="flex flex-wrap items-center gap-2">
            {t('history.comparing', { from, to })}
            <Link
              href={`/${workspaceSlug}/wiki/${spaceSlug}/${pageSlug}/history?from=${from}&to=${to}`}
              className="font-medium text-accent hover:underline"
            >
              {t('history.compare')}
            </Link>
          </span>
        </Alert>
      )}

      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        {revisions.map((revision) => (
          <li key={revision.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <label className="flex items-center gap-2 text-2xs text-text-muted">
              {/*
                A native checkbox, for the reason slice 9's preference grid uses
                one: "a checkbox already carries the role, the keyboard behaviour
                and the label association a Switch would have to be given by
                hand".
              */}
              <input
                type="checkbox"
                checked={selected.includes(revision.revisionNo)}
                onChange={() => toggle(revision.revisionNo)}
                className="h-4 w-4 rounded-xs border border-border accent-accent"
              />
              <span className="font-medium tabular-nums text-text">
                {t('history.revision', { number: revision.revisionNo })}
              </span>
            </label>

            <span
              lang={hasKhmer(revision.title) ? 'km' : undefined}
              className="line-clamp-1 min-w-0 flex-1 text-xs text-text"
            >
              {revision.title}
            </span>

            <span className="text-2xs text-text-muted">
              {/*
                Null only when the account is gone, not merely when the person
                has left — `wiki_page_revision_author_fk` is `restrict`, which is
                §20.5's half of the offboarding asymmetry: pages stay attributed.
              */}
              {revision.authorName ?? t('history.someone')}
              {' · '}
              {format.dateTime(new Date(revision.createdAt), 'short')}
            </span>

            {canWrite && revision.revisionNo !== currentRevision && (
              <RestoreButton
                workspaceSlug={workspaceSlug}
                locale={locale}
                pageId={pageId}
                revisionNo={revision.revisionNo}
                baseRevision={currentRevision}
                restore={restore}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `[!]` §20.11: "restore asks once, then writes a new revision."
 *
 * Asks *once* — a two-step confirm inside the row rather than a dialog, because
 * §20.15 says "the cost of a bad edit has to be visibly one click" and a restore
 * is itself the undo. A modal in front of an operation that adds rather than
 * removes would be the product being frightened of its own safety net.
 */
function RestoreButton({
  workspaceSlug,
  locale,
  pageId,
  revisionNo,
  baseRevision,
  restore,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  revisionNo: number;
  baseRevision: number;
  restore: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(restore, ROW_IDLE);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <span className="flex items-center gap-2">
        {/*
          §11: a refused mutation reports in the row that caused it rather than
          in a toast — the rule slice 5 set for the list and slice 6 kept.
        */}
        {state.error && (
          <span className="text-2xs text-danger">{t(state.error.replace(/^wiki\./, ''))}</span>
        )}
        <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
          {t('history.restore')}
        </Button>
      </span>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="revisionNo" value={revisionNo} />
      <input type="hidden" name="baseRevision" value={baseRevision} />

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t('history.restoring') : t('history.confirmRestore')}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        {t('history.cancel')}
      </Button>
    </form>
  );
}
