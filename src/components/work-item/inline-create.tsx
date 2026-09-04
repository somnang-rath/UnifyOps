'use client';

import { useActionState, useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { IDLE, type FormState } from '@/lib/form-state';
import { createWorkItemAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * §7.2, and the five-second target it carries.
 *
 * "Inline `+` at the bottom of any board column or list group → type title →
 * `Enter`. Created in that group with defaults, input stays focused. **There is
 * no create-task modal in the default path.**"
 *
 * Three details are the whole feature:
 *
 *   * **The state is the group.** It is a hidden field filled from the group
 *     this input sits under, which is §5's "state defaults to the column you
 *     created in". Nobody chooses it.
 *   * **The input stays focused and clears.** Typing five titles in a row is
 *     the actual behaviour on a Monday morning, and a form that loses focus
 *     after each one turns that into five clicks.
 *   * **On failure the text is kept.** §11: an error retains user input. The
 *     form is reset only on success, which is why the reset is in an effect
 *     keyed to the result rather than on the form element.
 *
 * §7.1 also makes this the *empty state* of a group: "the focused input **is**
 * the empty state". So it renders whether or not the group has rows.
 */

export function InlineCreate({
  workspaceSlug,
  projectSlug,
  projectId,
  stateId,
  locale,
  autoFocus,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  /** The group this input belongs to. Empty for a grouping that is not by state. */
  stateId?: string;
  locale: string;
  autoFocus?: boolean;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<FormState, FormData>(
    createWorkItemAction,
    IDLE,
  );
  // One composer renders per group, so a board draws six of these and a list
  // draws one per heading. A fixed id would put the same `id` on every error a
  // multi-group failure produced, and `aria-describedby` resolves to the first
  // match in the document — the wrong column's message, silently.
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submissions = useRef(0);

  // Cleared and refocused only when a submission actually succeeded. Counting
  // submissions rather than watching `state` is what distinguishes "succeeded
  // again" from "has not changed" — two identical successes produce the same
  // state object, and an effect on the object alone would fire once.
  useEffect(() => {
    if (pending) {
      submissions.current += 1;
      return;
    }
    if (submissions.current === 0) return;
    if (state.error || state.fields) return;

    formRef.current?.reset();
    inputRef.current?.focus();
  }, [pending, state]);

  const error = state.fields?.title ?? state.error;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-1 px-3 py-2">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      {stateId && <input type="hidden" name="stateId" value={stateId} />}

      <div className="flex items-center gap-2">
        <Plus size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-text-subtle" />
        <input
          ref={inputRef}
          name="title"
          type="text"
          required
          autoFocus={autoFocus}
          disabled={pending}
          // §12: placeholders are never labels. The visible label would repeat
          // in every group, so the accessible name is here and the placeholder
          // is the same words — a screen reader gets a name, a sighted user
          // gets a prompt, and neither gets a heading per column.
          aria-label={t('workItems.addPlaceholder')}
          placeholder={t('workItems.addPlaceholder')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-7 min-w-0 flex-1 rounded-xs border border-transparent bg-transparent px-1 text-sm text-text transition-colors duration-120 placeholder:text-text-subtle hover:border-border focus:border-border focus:bg-surface disabled:opacity-60"
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="ps-6 text-2xs text-danger">
          {t(error)}
        </p>
      )}
    </form>
  );
}
