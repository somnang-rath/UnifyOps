'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { hasKhmer } from '@/lib/search';

export type LinkedItemView = {
  workItemId: string;
  identifier: string;
  title: string;
  projectSlug: string;
  number: number;
};

/**
 * The work items a page links to (§20.2).
 *
 * "A page links to work items and an item lists its pages — the thing that makes
 * a wiki get read rather than written once", and §20.15 names it as half the
 * mitigation for this feature's biggest risk: "a page reached from work is a
 * page that gets read."
 *
 * **The link is made by identifier, not by a picker.** `ENG-142` is what the
 * product prints and what anybody pastes, and slice 14 already built the lookup
 * that resolves one — so the cheapest correct control here is a text field. A
 * project-then-item picker would be two selects and a search over every item in
 * a company, to do what typing six characters does.
 *
 * `[E]` A page with no links shows the field and one line, not an `EmptyState`
 * card: this is a panel beside a body, and an empty state with an illustration
 * beside a full page reads as a broken region rather than an invitation.
 */
export function PageLinks({
  workspaceSlug,
  locale,
  pageId,
  links,
  canWrite,
  link,
  unlink,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  links: LinkedItemView[];
  canWrite: boolean;
  link: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
  unlink: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');

  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-text-muted">
        {t('links.title')}
      </h2>

      {links.length === 0 ? (
        <p className="text-xs text-text-subtle">{t('links.empty')}</p>
      ) : (
        <ul className="space-y-1">
          {links.map((item) => (
            <li key={item.workItemId} className="flex items-start gap-2 text-xs">
              <Link
                href={`/${workspaceSlug}/projects/${item.projectSlug}/${item.number}`}
                className="flex min-w-0 flex-1 items-baseline gap-2 hover:underline"
              >
                <span className="shrink-0 font-medium tabular-nums text-text-muted">
                  {item.identifier}
                </span>
                <span
                  lang={hasKhmer(item.title) ? 'km' : undefined}
                  className="line-clamp-1 text-text"
                >
                  {item.title}
                </span>
              </Link>

              {canWrite && (
                <UnlinkButton
                  workspaceSlug={workspaceSlug}
                  locale={locale}
                  pageId={pageId}
                  item={item}
                  unlink={unlink}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <LinkForm workspaceSlug={workspaceSlug} locale={locale} pageId={pageId} link={link} />
      )}
    </section>
  );
}

function LinkForm({
  workspaceSlug,
  locale,
  pageId,
  link,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  link: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(link, ROW_IDLE);
  const [identifier, setIdentifier] = useState('');

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2"
      onSubmit={() => {
        // Cleared optimistically: the row appears in the list above on
        // revalidation, so leaving the identifier in the box would read as a
        // link that did not take.
        setIdentifier('');
      }}
    >
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={pageId} />

      <InputField
        label={t('links.addLabel')}
        name="identifier"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        placeholder="ENG-142"
        error={state.error ? t(state.error.replace(/^wiki\./, '')) : undefined}
        className="min-w-40 flex-1"
      />

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? t('links.adding') : t('links.add')}
      </Button>
    </form>
  );
}

function UnlinkButton({
  workspaceSlug,
  locale,
  pageId,
  item,
  unlink,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  item: LinkedItemView;
  unlink: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(unlink, ROW_IDLE);

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="workItemId" value={item.workItemId} />
      <input type="hidden" name="projectSlug" value={item.projectSlug} />

      {state.error && (
        <span className="text-2xs text-danger">{t(state.error.replace(/^wiki\./, ''))}</span>
      )}

      <button
        type="submit"
        disabled={pending}
        // §11: every icon-only control has an accessible name, and this one
        // names the item it would detach rather than saying "remove" nine times.
        aria-label={t('links.remove', { identifier: item.identifier })}
        className="rounded-xs px-1 text-text-subtle transition-colors duration-120 hover:text-danger"
      >
        ×
      </button>
    </form>
  );
}
