'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { InputField, TextareaField } from '@/components/ui/field';
import { DocumentBody } from '@/components/ui/document-body';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { WIKI_PAGE_IDLE, type WikiPageFormState } from '@/lib/form-state';
import { hasKhmer } from '@/lib/search';
import { graphemeLength, MAX_PAGE_BODY_LENGTH, MAX_PAGE_TITLE_LENGTH } from '@/lib/wiki';
import { diffLines, diffSummary } from '@/lib/wiki';

/**
 * The page editor (§20.3.2), and the screen §20.3.3's refusal lands on.
 *
 * **Markdown in a textarea, with a preview** (§20.7). There is no WYSIWYG
 * editor, and §20.7 gives four reasons — the one that decides it for this
 * component is that "a WYSIWYG editor is thirty new strings, thirty tooltips and
 * an icon set, in two languages, for a §12 component inventory that deliberately
 * contains no editor". The preview runs the *same* `src/lib/documents.ts` the
 * server renders with, which is what makes it a preview rather than a promise.
 *
 * **The body is never lost.** §20.3.2's `[X]`: "save fails → the body stays,
 * nothing is lost, and the message says whether it was refused or dropped." Both
 * fields are controlled, so a failed action re-renders with the writer's text
 * still in them — the rule §7.7 sets for a comment, which matters more here
 * because a page is twenty minutes of work rather than two.
 *
 * **A stale save shows both bodies** (§20.3.3). This is the one part of the
 * feature that would be easy to build as a toast and must not be: "their words
 * are never discarded and never merged", so the refusal renders the version that
 * landed beside a line-by-line comparison, and the writer decides. There is no
 * "overwrite anyway" button that discards the other person's text without
 * showing it first — the button appears only once the comparison is on screen,
 * and it rebases rather than forces.
 */
export function PageEditor({
  workspaceSlug,
  locale,
  spaceSlug,
  page,
  mentioned,
  pages,
  save,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  spaceSlug: string;
  page: {
    id: string;
    title: string;
    body: string;
    slug: string;
    revisionNo: number;
  };
  mentioned: Record<string, string>;
  pages: Record<string, { title: string; href: string | null }>;
  save: (previous: WikiPageFormState, formData: FormData) => Promise<WikiPageFormState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(save, WIKI_PAGE_IDLE);

  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [preview, setPreview] = useState(false);

  /**
   * The revision this draft is based on — **derived, never synchronised.**
   *
   * §20.3.3's recovery is a *rebase*: once the writer has seen the version that
   * landed, "keep mine" saves their text against the newer number, or they would
   * be sent round the same refusal for ever. The obvious implementation is a
   * `useState` kept in step with an effect, and `react-hooks/set-state-in-effect`
   * refuses it — correctly, and the rule is what forced the better version here
   * rather than the workaround slice 17 needed in `NoteComposer`.
   *
   * **Revision numbers only ever increase**, so the highest number this
   * component has heard about *is* the base, and every source of one is already
   * on screen: the page it was handed, the revision a successful save reported,
   * and the revision a stale refusal named. A maximum over the three is total,
   * has no ordering to get wrong, and needs neither a state nor an effect.
   */
  const baseRevision = Math.max(
    page.revisionNo,
    state.revisionNo ?? 0,
    state.current?.revisionNo ?? 0,
  );

  /**
   * Which refusal the writer has already dealt with.
   *
   * The notice hides once they choose, and it is keyed on the *revision* rather
   * than on a boolean: a second person saving again while the first is still
   * deciding produces a new number, and a boolean would leave the newer refusal
   * dismissed before it was ever read.
   */
  const [acknowledged, setAcknowledged] = useState<number | null>(null);
  const stale =
    state.current && state.current.revisionNo !== acknowledged ? state.current : null;

  const overLength = graphemeLength(body) > MAX_PAGE_BODY_LENGTH;

  return (
    <div className="space-y-4">
      {/*
        §20.3.3's refusal, above the form so it cannot be missed, and carrying the
        other version rather than only a sentence about it.
      */}
      {stale && (
        <StaleNotice
          mine={body}
          theirs={stale}
          onRebase={() => {
            // "Keep mine" — the writer's text, saved against the number that
            // landed. `baseRevision` has already rebased itself, so this only
            // dismisses the notice. Their words survive and so do the other
            // person's, in the revision history, which is what makes this
            // recoverable rather than a choice between two losses.
            setAcknowledged(stale.revisionNo);
          }}
          onTakeTheirs={() => {
            setBody(stale.body);
            setTitle(stale.title);
            setAcknowledged(stale.revisionNo);
          }}
        />
      )}

      {state.error && !stale && (
        <Alert tone="danger">
          {t(state.error.replace(/^wiki\./, ''), {
            names: (state.names ?? []).join(', '),
          })}
        </Alert>
      )}

      {/* `Alert` already puts `role="status"` on every tone but danger. */}
      {state.savedAt !== undefined && !state.error && (
        <Alert tone="success">
          {t('editor.saved', { number: state.revisionNo ?? baseRevision })}
        </Alert>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="pageId" value={page.id} />
        <input type="hidden" name="baseRevision" value={baseRevision} />

        <InputField
          label={t('editor.titleLabel')}
          name="title"
          required
          maxLength={MAX_PAGE_TITLE_LENGTH * 4}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          lang={hasKhmer(title) ? 'km' : undefined}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {/*
                Two buttons rather than a Tabs component: §12's inventory has
                Tabs, and this is a two-state toggle on one field rather than a
                set of panels. `aria-pressed` is the role a toggle already has.
              */}
              <TabButton pressed={!preview} onClick={() => setPreview(false)}>
                {t('editor.write')}
              </TabButton>
              <TabButton pressed={preview} onClick={() => setPreview(true)}>
                {t('editor.preview')}
              </TabButton>
            </div>

            {/*
              §20.3.2's `[!]`: "a body over the cap → refused at the field with
              the count, in graphemes (§13), never code points." Shown as it is
              approached rather than only on refusal, because a person who has
              pasted a long document should find out before they press save.
            */}
            {overLength && (
              <p className="text-2xs text-danger">
                {t('editor.tooLong', { max: MAX_PAGE_BODY_LENGTH })}
              </p>
            )}
          </div>

          {preview ? (
            <div className="min-h-64 rounded-md border border-border bg-surface p-3">
              {body.trim().length === 0 ? (
                <p className="text-sm text-text-subtle">{t('editor.previewEmpty')}</p>
              ) : (
                <DocumentBody
                  body={body}
                  context={{ workspaceSlug, mentioned, pages }}
                  className="max-w-prose"
                />
              )}
            </div>
          ) : (
            <TextareaField
              label={t('editor.bodyLabel')}
              name="body"
              rows={20}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              lang={hasKhmer(body) ? 'km' : undefined}
              help={t('editor.bodyHelp')}
              className="font-mono"
            />
          )}

          {/*
            The body has to reach the server even while the preview is showing,
            because the textarea is unmounted then. A controlled hidden input is
            the honest way: the value is the same state either tab reads.
          */}
          {preview && <input type="hidden" name="body" value={body} />}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || overLength}>
            {pending ? t('editor.saving') : t('editor.save')}
          </Button>

          <Link
            href={`/${workspaceSlug}/wiki/${spaceSlug}/${page.slug}`}
            className="rounded-sm px-2 py-1 text-xs text-text-muted hover:text-text"
          >
            {t('editor.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}

function TabButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-sm px-2 py-1 text-2xs font-medium transition-colors duration-120',
        pressed ? 'bg-surface-sunken text-text' : 'text-text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

/**
 * §20.3.3 on screen: "the writer is shown their text beside the version that
 * landed while they were typing."
 *
 * A line-by-line comparison rather than the two bodies side by side in full,
 * because a page is long and the question a person actually has is *what
 * changed* — `diffLines` in `src/lib/wiki.ts` answers it, and it is line-based
 * rather than word-based because a word diff of Khmer is a diff of one enormous
 * word (§13).
 *
 * `[!]` §20.3.3: "the same person in two tabs → still refused, and the message
 * says so plainly rather than blaming a colleague who does not exist." The copy
 * names the revision rather than a person for exactly that reason.
 */
function StaleNotice({
  mine,
  theirs,
  onRebase,
  onTakeTheirs,
}: {
  mine: string;
  theirs: { title: string; body: string; revisionNo: number };
  onRebase: () => void;
  onTakeTheirs: () => void;
}) {
  const t = useTranslations('wiki');
  const lines = diffLines(theirs.body, mine);
  const summary = diffSummary(lines);

  return (
    <section className="space-y-3 rounded-md border border-warning bg-warning-subtle p-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-text">{t('stale.title')}</h2>
        <p className="text-xs text-text-muted">{t('stale.body', { number: theirs.revisionNo })}</p>
      </div>

      <p className="text-2xs text-text-muted">
        {t('stale.summary', { added: summary.added, removed: summary.removed })}
      </p>

      {/*
        Scrolls inside its own container rather than widening the page — §15-6's
        390px rule, and the failure `responsive.spec.ts` sweeps for.
      */}
      <div className="max-h-64 overflow-auto rounded-sm border border-border bg-surface">
        <table className="w-full border-collapse text-2xs">
          <caption className="sr-only">{t('stale.tableCaption')}</caption>
          <tbody>
            {lines.map((line, index) => (
              <tr
                key={`${line.op}-${line.before}-${line.after}-${index}`}
                className={
                  line.op === 'added'
                    ? 'bg-success-subtle'
                    : line.op === 'removed'
                      ? 'bg-danger-subtle'
                      : undefined
                }
              >
                <td className="w-10 select-none px-1 text-right align-top text-text-subtle tabular-nums">
                  {line.before ?? ''}
                </td>
                <td className="w-10 select-none px-1 text-right align-top text-text-subtle tabular-nums">
                  {line.after ?? ''}
                </td>
                <td
                  lang={hasKhmer(line.text) ? 'km' : undefined}
                  className="whitespace-pre-wrap px-2 align-top font-mono text-text"
                >
                  {/* An `sr-only` marker, because colour alone is not a signal. */}
                  {line.op !== 'same' && (
                    <span className="sr-only">{t(`stale.op.${line.op}`)} </span>
                  )}
                  {line.text || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onRebase}>
          {t('stale.keepMine')}
        </Button>
        <Button type="button" variant="ghost" onClick={onTakeTheirs}>
          {t('stale.takeTheirs')}
        </Button>
      </div>
    </section>
  );
}
