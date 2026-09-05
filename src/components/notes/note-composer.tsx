'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { NOTE_IDLE, type NoteFormState } from '@/lib/form-state';
import { MAX_NOTE_LENGTH } from '@/lib/notes';
import { documentLength } from '@/lib/documents';
import {
  createNoteAction,
  updateNoteAction,
} from '@/app/[locale]/[workspaceSlug]/notes/actions';

/**
 * The note box (§20.3.1, §20.3.2).
 *
 * One component for both writing a new note and editing an existing one,
 * because they are the same box with a different action behind them — and
 * because §20.1's "two nouns, one editor" is as true of the two *modes* as it is
 * of the two nouns.
 *
 * **The draft lives in this component's state and is never cleared by a
 * failure.** §20.3.1's `[X]`: "the text stays in the box and the retry button is
 * the same button (§7.7's rule, which applies with more force to something
 * nobody else has a copy of)". That is why the textarea is controlled — a
 * `useActionState` re-render resets an uncontrolled field, so the cheaper
 * implementation is the one that loses the text exactly when the network did.
 * It is also why the box clears on `savedAt` rather than on the absence of an
 * error: two saves in a row are otherwise indistinguishable, and the second
 * would leave the first note's text behind.
 *
 * **`⌘Enter` saves**, which is the half of §20.3.1's five seconds that a mouse
 * cannot give: "type → `⌘Enter` saves and closes". Both modifiers are accepted
 * without asking which platform this is, because the answer is only knowable
 * after hydration and getting it wrong means the shortcut silently does nothing.
 *
 * §11's five states: `[L]` the Save button carries its own pending state · `[E]`
 * an empty box disables Save rather than submitting something the server will
 * refuse · `[S]` the box clears and the list above re-renders · `[X]` the error
 * sits under the box and the text is still in it · `[!]` a body over the cap
 * shows the count *before* the submit, in graphemes (§13).
 */
export function NoteComposer({
  workspaceSlug,
  locale,
  noteId,
  initialBody = '',
  workItemId,
  pinChoice,
  autoFocus = false,
  onSaved,
}: {
  workspaceSlug: string;
  locale: string;
  /** Absent when writing a new note; present when editing one. */
  noteId?: string;
  initialBody?: string;
  /** §20.3.1's `[!]` — an item to pin to unconditionally, when the caller knows one. */
  workItemId?: string | null;
  /**
   * §20.3.1's `[!]` as an *offer*: the item on screen, pinnable in one click.
   *
   * Distinct from `workItemId` because the two say different things. That one is
   * a decision the caller has already made; this one is a choice put in front of
   * the person, defaulted off — "offered a one-click pin to that item, taken or
   * not".
   */
  pinChoice?: { id: string; identifier: string } | null;
  autoFocus?: boolean;
  onSaved?: (noteId: string | undefined) => void;
}) {
  const t = useTranslations();
  const editing = noteId !== undefined;

  const [state, submit, pending] = useActionState<NoteFormState, FormData>(
    editing ? updateNoteAction : createNoteAction,
    NOTE_IDLE,
  );

  const [draft, setDraft] = useState(initialBody);
  const form = useRef<HTMLFormElement>(null);
  const errorId = useId();

  /**
   * Clear on a *new* save only, and only when creating.
   *
   * An edit that succeeded should leave the text where it is — the note now says
   * that, and emptying the box would read as having thrown the edit away.
   */
  const lastCleared = useRef<number | undefined>(undefined);
  const lastNotified = useRef<number | undefined>(undefined);

  /**
   * Two effects rather than one, and the split is not stylistic.
   *
   * Clearing the box is a state update and telling the parent is not, and only
   * the first is conditional on the mode — an edit that succeeded leaves its
   * text where it is, because emptying the box would read as having thrown the
   * edit away. Written as one effect with the mode test *inside* it, the state
   * update sits under a second condition, which is the shape
   * `react-hooks/set-state-in-effect` refuses.
   */
  useEffect(() => {
    if (editing) return;
    if (state.savedAt && state.savedAt !== lastCleared.current) {
      lastCleared.current = state.savedAt;
      setDraft('');
    }
  }, [editing, state.savedAt]);

  useEffect(() => {
    if (state.savedAt && state.savedAt !== lastNotified.current) {
      lastNotified.current = state.savedAt;
      onSaved?.(state.noteId);
    }
  }, [state.savedAt, state.noteId, onSaved]);

  // Counted in graphemes, like the cap itself — `.length` would tell a Khmer
  // workspace it had used three times what it has (§13).
  const length = documentLength(draft);
  const overCap = length > MAX_NOTE_LENGTH;
  const empty = draft.trim().length === 0;
  const problem = state.fields?.body;

  return (
    <form ref={form} action={submit} className="space-y-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      {editing ? <input type="hidden" name="noteId" value={noteId} /> : null}
      {workItemId ? <input type="hidden" name="workItemId" value={workItemId} /> : null}

      <label className="sr-only" htmlFor={`${errorId}-body`}>
        {t('notes.bodyLabel')}
      </label>
      <textarea
        id={`${errorId}-body`}
        name="body"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Both modifiers, unconditionally: which one this keyboard has is only
          // knowable after hydration, and a shortcut that silently does nothing
          // is worse than one that accepts an extra chord nobody will type.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!empty && !overCap) form.current?.requestSubmit();
          }
        }}
        rows={editing ? 6 : 3}
        autoFocus={autoFocus}
        placeholder={t('notes.placeholder')}
        aria-describedby={problem || overCap ? errorId : undefined}
        aria-invalid={problem !== undefined || overCap}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text',
          'placeholder:text-text-subtle',
        )}
      />

      {/*
        A native checkbox, for the reason slice 9's preference grid used one and
        did not pre-empt §12's unbuilt Switch: a checkbox already carries the
        role, the keyboard behaviour and the label association a Switch would
        have to be given by hand. Unchecked submits no field at all, which is
        exactly the "no pin" the action reads as null.
      */}
      {pinChoice ? (
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            name="workItemId"
            value={pinChoice.id}
            className="size-3.5 rounded-xs border-border"
          />
          {t('notes.pinTo', { identifier: pinChoice.identifier })}
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-subtle">
          {/* The hint is the shortcut, because §20.3.1's target is five seconds
              and a control whose fast path is invisible is a control nobody
              takes the fast path on. */}
          {t('notes.saveHint')}
        </p>
        <div className="flex items-center gap-2">
          {/* The count appears only as the cap approaches. A counter that is
              always on screen is a limit the product is telling somebody about
              before they have any reason to care. */}
          {length > MAX_NOTE_LENGTH * 0.9 ? (
            <span className={cn('text-xs', overCap ? 'text-danger' : 'text-text-subtle')}>
              {t('notes.remaining', { count: MAX_NOTE_LENGTH - length })}
            </span>
          ) : null}
          {/*
            `loading` rather than a swapped label: the Button primitive already
            announces `aria-busy` and disables itself, and it is the control
            slice 15's scar says to wait for before navigating — "wait for the
            control that owns the mutation to re-enable itself".
          */}
          <Button type="submit" variant="primary" loading={pending} disabled={empty || overCap}>
            {editing ? t('action.save') : t('notes.save')}
          </Button>
        </div>
      </div>

      {problem ? (
        <div id={errorId}>
          <Alert tone="danger">{t(problem)}</Alert>
        </div>
      ) : overCap ? (
        <div id={errorId}>
          <Alert tone="danger">{t('notes.errors.bodyTooLong')}</Alert>
        </div>
      ) : null}
    </form>
  );
}
