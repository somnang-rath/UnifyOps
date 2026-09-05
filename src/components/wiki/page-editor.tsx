'use client';

import { useActionState, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { InputField, TextareaField } from '@/components/ui/field';
import { DocumentBody } from '@/components/ui/document-body';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { WIKI_PAGE_IDLE, type WikiPageFormState } from '@/lib/form-state';
import { hasKhmer } from '@/lib/search';
import {
  activeInsertQuery,
  applyInsertion,
  applyLink,
  matchInsertions,
  wrapSelection,
  INSERTIONS,
  type InsertionId,
} from '@/lib/editor-commands';
import { graphemeLength, MAX_PAGE_BODY_LENGTH, MAX_PAGE_TITLE_LENGTH } from '@/lib/wiki';
import { diffLines, diffSummary } from '@/lib/wiki';
import { InsertMenu } from './insert-menu';

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

  /* --- §21.5's editor: the `/` menu and the formatting shortcuts ---------- */

  const textarea = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  /**
   * Where the caret must land after React has written a new value.
   *
   * The same device — and the same comment — as slice 8's mention composer: the
   * browser puts the caret at the end of the *old* value unless it is placed
   * after the render, so a `useLayoutEffect` with no dependency array checks a
   * ref that is null on every render but the one that matters.
   */
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const target = pendingCaret.current;
    if (target === null) return;
    pendingCaret.current = null;
    const element = textarea.current;
    element?.focus();
    element?.setSelectionRange(target, target);
  });

  const [insertQuery, setInsertQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  /**
   * The labels the menu matches against, so `/table` finds *Table* in English
   * and its Khmer name in Khmer — and so the English id keeps working in both
   * (§13, and `matchInsertions`' own comment).
   */
  const insertLabels = Object.fromEntries(
    INSERTIONS.map((id) => [id, t(`editor.insert.${id}`)]),
  ) as Record<InsertionId, string>;

  const suggestions = insertQuery === null ? [] : matchInsertions(insertQuery, insertLabels);
  const menuOpen = suggestions.length > 0;

  function reread(value: string, caret: number) {
    const active = activeInsertQuery(value, caret);
    setInsertQuery(active ? active.query : null);
    setHighlighted(0);
  }

  function choose(id: InsertionId) {
    const element = textarea.current;
    if (!element) return;

    const result = applyInsertion(body, element.selectionStart, id);
    pendingCaret.current = result.caret;
    setBody(result.body);
    setInsertQuery(null);
  }

  /** `⌘B`, `⌘I` and `⌘K`, and the arrow keys while the `/` menu is open. */
  function onBodyKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;

    /**
     * **`mod` folds Command and Control into one row**, which is `shortcuts.ts`'s
     * rule from slice 14 — and **Alt is namespaced away from every binding**
     * there for a reason that applies here too: AltGr produces characters on a
     * Khmer layout, so a shortcut that fired on it would eat somebody's letter.
     */
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const marker = event.key === 'b' ? '**' : event.key === 'i' ? '_' : null;

      if (marker) {
        event.preventDefault();
        const result = wrapSelection(body, element.selectionStart, element.selectionEnd, marker);
        setBody(result.body);
        // The selection is restored around the same words, so a second press
        // toggles the formatting back off rather than nesting a second pair.
        pendingCaret.current = result.end;
        return;
      }

      if (event.key === 'k') {
        event.preventDefault();
        const result = applyLink(body, element.selectionStart, element.selectionEnd);
        setBody(result.body);
        pendingCaret.current = result.start;
        return;
      }
    }

    if (!menuOpen) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlighted((index) => (index + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlighted((index) => (index - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Home':
        event.preventDefault();
        setHighlighted(0);
        break;
      case 'End':
        event.preventDefault();
        setHighlighted(suggestions.length - 1);
        break;
      case 'Enter':
      case 'Tab': {
        // Enter picks the highlighted entry **only while the menu is open**.
        // Closed, Enter is a newline — an editor that cannot take a line break
        // is not an editor, which is the rule slice 8 wrote for the comment box.
        const id = suggestions[highlighted];
        if (id) {
          event.preventDefault();
          choose(id);
        }
        break;
      }
      case 'Escape':
        // Closes the menu and keeps the typed `/text`, which stays ordinary
        // text. Nothing is undone, because nothing was inserted yet.
        event.preventDefault();
        setInsertQuery(null);
        break;
      default:
        break;
    }
  }

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

      {/*
        §21.3's one automatic transition, said out loud on the screen that caused
        it. `warning` rather than `success`: nothing is wrong, but something the
        writer did not ask for has happened to the page and they may want to undo
        it — which is one click away on the reader, and why the link below
        carries the flag through.
      */}
      {state.unverified === true && !state.error && (
        <Alert tone="warning">{t('verification.cleared')}</Alert>
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
            {/*
              **The toggle is only on screen where there is room for one pane.**
              §21.5 asks for "a live preview beside the textarea", and *beside* is
              what a wide screen gets — both panes, always, with no toggle at all.
              At 390px (§15-6) there is no beside, so the same two panes become
              one at a time and this switches between them.
            */}
            <div className="flex gap-1 lg:hidden">
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
              <p className="ms-auto text-2xs text-danger">
                {t('editor.tooLong', { max: MAX_PAGE_BODY_LENGTH })}
              </p>
            )}
          </div>

          {/*
            Both panes are always mounted and CSS decides which is visible, which
            removes the hidden input this form used to need: the textarea is
            never unmounted, so its value reaches the server on its own and its
            caret survives a trip through the preview.
          */}
          <div className="grid gap-3 lg:grid-cols-2">
            {/*
              **`relative`, and it is load-bearing rather than tidy.** The `/`
              menu is absolutely positioned, and slice 16's responsive sweep
              found that an absolutely-positioned descendant of a `static` parent
              resolves against the initial containing block and grows the
              *document* — invisible on screen, and exactly the failure
              `responsive.spec.ts` exists to catch.
            */}
            <div className={cn('relative', preview && 'hidden lg:block')}>
              <TextareaField
                ref={textarea}
                label={t('editor.bodyLabel')}
                name="body"
                rows={20}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  reread(event.target.value, event.target.selectionStart);
                }}
                /*
                  The caret moves without the value changing — an arrow key, a
                  click — and the menu has to close when it leaves the slash.
                  Without this, typing a query, clicking away and pressing Enter
                  would insert a block somewhere else entirely.
                */
                onSelect={(event) => reread(body, event.currentTarget.selectionStart)}
                onKeyDown={onBodyKeyDown}
                onBlur={() => setInsertQuery(null)}
                /*
                  The ARIA combobox pattern announced on the **textarea**, never
                  on the list — slice 8's rule, restated: focus never leaves the
                  field, so the field is what must carry `aria-expanded`,
                  `aria-controls` and `aria-activedescendant`.
                */
                role="combobox"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? listId : undefined}
                aria-activedescendant={menuOpen ? optionId(highlighted) : undefined}
                aria-autocomplete="list"
                lang={hasKhmer(body) ? 'km' : undefined}
                help={t('editor.bodyHelp')}
                className="font-mono"
              />

              {menuOpen && (
                <InsertMenu
                  ids={suggestions}
                  highlighted={highlighted}
                  listId={listId}
                  optionId={optionId}
                  onChoose={choose}
                />
              )}
            </div>

            {/*
              The preview runs the *same* `src/lib/documents.ts` the server
              renders with (§20.7), which is what makes it a preview rather than
              a promise — and now that it is live and beside the field, the `/`
              menu's whole argument is visible: text somebody could have typed,
              becoming the block they wanted, next to the words they typed it in.
            */}
            <div
              className={cn(
                'min-h-64 overflow-x-auto rounded-md border border-border bg-surface p-3',
                !preview && 'hidden lg:block',
              )}
            >
              {body.trim().length === 0 ? (
                <p className="text-sm text-text-subtle">{t('editor.previewEmpty')}</p>
              ) : (
                <DocumentBody
                  body={body}
                  context={{
                    workspaceSlug,
                    mentioned,
                    pages,
                    calloutLabels: {
                      info: t('callout.info'),
                      success: t('callout.success'),
                      warning: t('callout.warning'),
                      danger: t('callout.danger'),
                    },
                  }}
                  className="max-w-prose"
                />
              )}
            </div>
          </div>
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
