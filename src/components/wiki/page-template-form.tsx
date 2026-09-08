'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';

/**
 * Make this page a template, or stop it being one (§21.7 — slice 22).
 *
 * **One button, because the flag is one bit and the page already says which way
 * it is set.** §12's inventory has no Switch (slice 9 declined to build one for
 * the notification grid, for the reason a one-off Switch is how a design system
 * ends up with two), and a checkbox with a separate Save is two controls for a
 * decision that is a single act. The button's *label* is the state: a page that
 * is not a template offers "Use as a template", and one that is offers to stop.
 *
 * **In the right rail beside the owner and the icon**, which is where slice 20
 * put `PageIconForm` and for the same reason: this is a property of the page,
 * and a control beside the title puts an editable field in the middle of what a
 * reader came to read.
 *
 * The line above the button is not decoration. A template disappears from the
 * sidebar the moment the flag is set, and a person who was not told that has
 * lost a page — so the consequence is stated *before* the click, which is the
 * rule §7.11's field deletion and §7.12's offboarding dialog both follow.
 */
export function PageTemplateForm({
  workspaceSlug,
  locale,
  pageId,
  isTemplate,
  save,
}: {
  workspaceSlug: string;
  locale: 'en' | 'km';
  pageId: string;
  isTemplate: boolean;
  save: (previous: RowActionState, formData: FormData) => Promise<RowActionState>;
}) {
  const t = useTranslations('wiki');
  const [state, action, pending] = useActionState(save, ROW_IDLE);

  return (
    <form action={action} className="space-y-2 border-t border-border pt-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="pageId" value={pageId} />
      {/*
        The value is the *new* state, not the current one, so the button says
        what it does. It is a hidden field rather than the submit button's own
        `value` because slice 19 found the trap: a submit button's name and value
        are form data like any other, and `formData.get` returns the **first**
        match — a button sharing a name with a field beside it does the opposite
        of its label, silently.
      */}
      <input type="hidden" name="isTemplate" value={isTemplate ? 'false' : 'true'} />

      <p className="text-2xs text-text-muted">
        {isTemplate ? t('template.isTemplate') : t('template.explain')}
      </p>

      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        <LayoutTemplate size={14} strokeWidth={1.5} className="me-1.5" aria-hidden />
        {isTemplate ? t('template.unset') : t('template.set')}
      </Button>

      {/*
        The refusal in the row that caused it (§11), and here it is doing real
        work rather than covering an unlikely case: §21.7's two rules — a
        template is a root page, and nothing nests under one — mean this button
        genuinely refuses on ordinary pages, and the message is what says which
        of the two to fix.
      */}
      {state.error && (
        <p role="alert" className="text-2xs text-danger">
          {t(state.error.replace(/^wiki\./, ''))}
        </p>
      )}
    </form>
  );
}
