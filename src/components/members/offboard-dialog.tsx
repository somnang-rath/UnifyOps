'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { removeMemberAction } from '@/app/[locale]/[workspaceSlug]/actions';

/**
 * §7.12's offboarding, and its **required choice**.
 *
 * "Settings → Members → Remove → required choice: reassign their open items to
 * X, or leave unassigned and flag in Needs Attention." §4 says the same thing
 * in one line: "Removing a member requires choosing what happens to their open
 * work."
 *
 * **This is the second dialog in the product, and the first with a form in
 * it.** §12's rule is that a dialog is a last resort — "if a dialog needs a
 * dialog, the first one should have been a page or a sheet" — and nine slices
 * went by without one. It earns its place here for the reason §4 gives a
 * confirmation to exactly one other action in the product (deleting a workflow
 * state holding items): the alternative is orphaned work, and the choice cannot
 * be expressed as a single click.
 *
 * The two branches are radio buttons rather than two buttons, because they are
 * one question with two answers rather than two actions. There is no default
 * selection and the submit is disabled until one is picked: a preselected
 * answer to a question §4 calls *required* is the product answering it.
 *
 * §12 asks Escape to be refused when there are unsaved changes; `Dialog` does
 * not implement that yet and says so. It does not bite here — a radio choice
 * nobody submitted is not typed text, and closing loses nothing.
 */

export type ReassignCandidate = {
  memberId: string;
  name: string;
};

export function OffboardDialog({
  workspaceSlug,
  memberId,
  memberName,
  candidates,
}: {
  workspaceSlug: string;
  memberId: string;
  memberName: string;
  /** Every other live member. Empty in a workspace of one, which is refused anyway. */
  candidates: ReassignCandidate[];
}) {
  const t = useTranslations('members.offboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    removeMemberAction,
    ROW_IDLE,
  );

  // '' is not "nothing picked" — it is the real answer "leave unassigned", the
  // value the action maps to null. `null` here is the un-answered state, which
  // is why this is a nullable string rather than a string.
  const [choice, setChoice] = useState<string | null>(null);

  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {tRoot('members.remove')}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        label={t('title', { name: memberName })}
      >
        <form
          action={(formData) => {
            action(formData);
            setOpen(false);
          }}
          className="space-y-4 p-4"
        >
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
          <input type="hidden" name="memberId" value={memberId} />

          <div className="space-y-1">
            <h2 className="font-display text-base font-semibold tracking-tight">
              {t('title', { name: memberName })}
            </h2>
            <p className="text-sm text-text-muted">{t('description')}</p>
          </div>

          {state.error && <Alert tone="danger">{tRoot(state.error)}</Alert>}

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-text-muted">{t('question')}</legend>

            {candidates.map((candidate) => (
              <label
                key={candidate.memberId}
                className="flex cursor-pointer items-center gap-2 rounded-xs border border-border bg-surface px-2.5 py-1.5 text-sm has-checked:border-accent has-checked:bg-accent-subtle"
              >
                <input
                  type="radio"
                  name="reassignTo"
                  value={candidate.memberId}
                  checked={choice === candidate.memberId}
                  onChange={() => setChoice(candidate.memberId)}
                  className="accent-accent"
                />
                {t('reassignTo', { name: candidate.name })}
              </label>
            ))}

            <label className="flex cursor-pointer items-center gap-2 rounded-xs border border-border bg-surface px-2.5 py-1.5 text-sm has-checked:border-accent has-checked:bg-accent-subtle">
              <input
                type="radio"
                name="reassignTo"
                value=""
                checked={choice === ''}
                onChange={() => setChoice('')}
                className="accent-accent"
              />
              {/* §7.12's other branch. It needs no flag: §7.4's unassigned row
                  is already the surface that finds this work. */}
              {t('leaveUnassigned')}
            </label>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tRoot('action.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={pending} disabled={choice === null}>
              {tRoot('members.remove')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
