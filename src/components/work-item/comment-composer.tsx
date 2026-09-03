'use client';

import { useActionState, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { COMMENT_IDLE, type CommentFormState } from '@/lib/form-state';
import { activeMentionQuery, applyMention } from '@/lib/mentions';
import type { MentionablePerson } from '@/server/services/comments';
import { UploadQueue } from './upload-queue';
import { filesFrom, useUploads } from './use-uploads';
import { postCommentAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * The comment box, and the `@` picker inside it (§7.7).
 *
 * **The draft lives in this component's state and is never cleared by a
 * failure.** That is §7.7's emphatic requirement — "post fails → draft retained
 * in the box, retry button. Never lose typed text" — and it is the reason the
 * textarea is controlled rather than uncontrolled: a `useActionState` re-render
 * resets an uncontrolled field, so the cheaper implementation is the one that
 * loses the text exactly when the network did.
 *
 * **The picker is not §12's Combobox**, and that is deliberate rather than a
 * second dropdown. A Combobox is a form control with a value and a label; this
 * is an inline autocomplete anchored to a caret inside a textarea, which cannot
 * take focus without stopping the typing that drives it. It borrows the
 * Combobox's *keyboard contract* — arrows, Enter, Escape, Home/End — and
 * announces itself through the ARIA combobox pattern on the textarea, so a
 * screen reader gets the behaviour without focus ever leaving the field.
 *
 * **Paste-to-upload lives here** (§2.4 — "screenshot straight into a comment",
 * the most-used collaboration action in practice). A pasted or dropped file
 * starts uploading immediately and rides along with the comment when it is
 * posted: the ids go up as hidden fields, and the service links them inside the
 * same transaction that writes the comment. A file whose comment is never
 * posted stays `pending` and is visible to nobody.
 *
 * That is also why the Post button is enabled by *either* text or a file. A
 * screenshot with no words is often the whole message, and refusing it would
 * make the shortcut §2.4 cares about the one thing the box would not accept.
 *
 * §11's five states: `[L]` the Post button shows its own pending state ·
 * `[E]` no query matches nobody, and the picker closes rather than showing an
 * empty box · `[S]` the box clears and the thread above re-renders ·
 * `[X]` the error sits under the box with a Retry beside it, and the text is
 * still there · `[!]` a mention of somebody who cannot see the project is
 * refused by name.
 */

export type ComposerContext = {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  workItemId: string;
  /** The `142` of `ENG-142` — what the action revalidates. */
  number: number;
};

/** How many people the picker shows at once. Enough to choose from, few enough
 * that the list does not cover the comment being replied to. */
const MAX_SUGGESTIONS = 6;

function matches(people: readonly MentionablePerson[], query: string): MentionablePerson[] {
  // Case-folded `includes` rather than a prefix test, because a person is as
  // likely to type a surname as a given name — and because Khmer has no word
  // spaces for a prefix test to anchor on.
  const needle = query.trim().toLowerCase();
  const pool = needle
    ? people.filter((person) => person.name.toLowerCase().includes(needle))
    : people;

  return pool.slice(0, MAX_SUGGESTIONS);
}

export function CommentComposer({
  context,
  people,
}: {
  context: ComposerContext;
  people: readonly MentionablePerson[];
}) {
  const t = useTranslations();
  const [state, submit, pending] = useActionState<CommentFormState, FormData>(
    postCommentAction,
    COMMENT_IDLE,
  );

  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const uploads = useUploads(context);
  const picker = useRef<HTMLInputElement>(null);

  /**
   * Where the caret goes after a mention is inserted.
   *
   * A ref rather than state, deliberately: this is a one-shot instruction to
   * the DOM after the next paint, not something the component renders from.
   * Holding it in state would mean an effect that sets the state it depends on,
   * which is a cascading render for a value nothing reads.
   */
  const pendingCaret = useRef<number | null>(null);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  const suggestions = query === null ? [] : matches(people, query);
  const open = suggestions.length > 0;

  /**
   * Clear the box on a *new* success only.
   *
   * Keyed on `postedAt` rather than on the absence of an error, because two
   * successful posts in a row would otherwise be indistinguishable and the
   * second one would leave the first comment's text sitting in the box.
   */
  const lastPosted = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state.postedAt && state.postedAt !== lastPosted.current) {
      lastPosted.current = state.postedAt;
      setDraft('');
      setQuery(null);
      // The files went with the comment and are now rendered inside it. Only a
      // *successful* post clears them, for the same reason it is the only thing
      // that clears the text (§7.7).
      uploads.reset();
    }
  }, [state.postedAt, uploads]);

  // The caret has to be placed after React has written the new value, or the
  // browser puts it at the end of the old one. No dependency array: the ref is
  // checked after every render and is null on all but the one that matters.
  useLayoutEffect(() => {
    const target = pendingCaret.current;
    if (target === null) return;
    pendingCaret.current = null;
    textarea.current?.setSelectionRange(target, target);
  });

  function reread(value: string, caret: number) {
    const active = activeMentionQuery(value, caret);
    setQuery(active ? active.query : null);
    setHighlighted(0);
  }

  function choose(person: MentionablePerson) {
    const element = textarea.current;
    if (!element) return;

    const result = applyMention(draft, element.selectionStart, person.memberId);
    pendingCaret.current = result.caret;
    setDraft(result.body);
    setQuery(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ⌘/Ctrl+Enter posts from the keyboard without reaching for the button —
    // §11's mouse-free loop, and the shortcut people already expect in a
    // comment box.
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      form.current?.requestSubmit();
      return;
    }

    if (!open) return;

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
        // Enter picks the highlighted person *only while the picker is open*.
        // With it closed, Enter is a newline — a comment box that cannot take a
        // paragraph break is not a comment box.
        const person = suggestions[highlighted];
        if (person) {
          event.preventDefault();
          choose(person);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        setQuery(null);
        break;
      default:
        break;
    }
  }

  return (
    <form ref={form} action={submit} className="space-y-2">
      <input type="hidden" name="workspaceSlug" value={context.workspaceSlug} />
      <input type="hidden" name="projectSlug" value={context.projectSlug} />
      <input type="hidden" name="locale" value={context.locale} />
      <input type="hidden" name="workItemId" value={context.workItemId} />
      <input type="hidden" name="number" value={context.number} />

      {/* The files whose bytes have landed. The server re-checks that each one
          is this member's, on this item, and still pending — so these are a
          statement of intent, not an authorization. */}
      {uploads.readyIds.map((id) => (
        <input key={id} type="hidden" name="attachmentId" value={id} />
      ))}

      <div className="relative">
        <label htmlFor={`${listId}-input`} className="mb-1 block text-xs text-text-muted">
          {t('comments.label')}
        </label>

        <textarea
          ref={textarea}
          id={`${listId}-input`}
          name="body"
          rows={3}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            reread(event.target.value, event.target.selectionStart);
          }}
          // The caret can move without the value changing — a click, or an
          // arrow key — and the picker has to follow it.
          onSelect={(event) => {
            const element = event.currentTarget;
            reread(element.value, element.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setQuery(null)}
          // §2.4. The listener is on the textarea rather than the document, so
          // a screenshot pasted here cannot be stolen by another panel — and
          // pasting ordinary text is untouched, because the handler only acts
          // when the clipboard actually carried a file.
          onPaste={(event) => {
            const pasted = filesFrom(event.clipboardData);
            if (pasted.length === 0) return;
            event.preventDefault();
            uploads.add(pasted);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const dropped = filesFrom(event.dataTransfer);
            if (dropped.length === 0) return;
            event.preventDefault();
            uploads.add(dropped);
          }}
          // The ARIA combobox pattern, applied to the field rather than to a
          // separate control, so focus never leaves the textarea.
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? optionId(highlighted) : undefined}
          aria-autocomplete="list"
          aria-describedby={`${listId}-hint`}
          className={cn(
            'w-full rounded-sm border border-border bg-surface px-2.5 py-2 text-sm text-text',
            'placeholder:text-text-subtle',
            'transition-colors duration-120',
            'focus:border-border-strong',
          )}
        />

        <p id={`${listId}-hint`} className="mt-1 text-2xs text-text-subtle">
          {t('comments.hint')}
        </p>

        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={t('comments.mentionListLabel')}
            className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-sm border border-border bg-surface-raised shadow-md"
          >
            {suggestions.map((person, index) => (
              <li
                key={person.memberId}
                id={optionId(index)}
                role="option"
                aria-selected={index === highlighted}
                // `mousedown`, not `click`: the textarea's blur would close the
                // picker before a click ever landed.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(person);
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  'cursor-pointer px-2.5 py-1.5 text-sm text-text',
                  index === highlighted && 'bg-surface-hover',
                )}
              >
                {person.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {state.error && (
        <Alert tone="danger">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t(state.error)}
              {/* §7.7 asks the refusal to be clear, which means naming whose
                  access is missing rather than counting them. */}
              {state.names && state.names.length > 0 && ` ${state.names.join(', ')}`}
            </span>
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              {t('comments.retry')}
            </Button>
          </div>
        </Alert>
      )}

      <UploadQueue files={uploads.files} onRemove={uploads.remove} />

      <div className="flex items-center justify-between gap-2">
        {/* The keyboard and touch path to the same thing paste and drop do.
            Without it, attaching a file to a comment would be mouse-only —
            which §11's mouse-free loop and §15-6's 390px pass both refuse. */}
        <Button size="sm" variant="ghost" onClick={() => picker.current?.click()}>
          <Paperclip aria-hidden className="h-3.5 w-3.5" />
          {t('attachments.add')}
        </Button>

        <input
          ref={picker}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            uploads.add([...(event.target.files ?? [])]);
            // Cleared, so picking the same file twice in a row still fires.
            event.target.value = '';
          }}
        />

        <Button
          type="submit"
          variant="primary"
          loading={pending}
          // Either text or a file is a comment. A file still going up is not
          // one yet — posting now would drop it.
          disabled={(draft.trim() === '' && uploads.readyIds.length === 0) || uploads.busy}
        >
          {t('comments.post')}
        </Button>
      </div>
    </form>
  );
}
