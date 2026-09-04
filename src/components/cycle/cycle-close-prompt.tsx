'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { completeCycleAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/cycles/actions';

/**
 * §7.6's last step: "on end date, incomplete items prompt: move to next cycle,
 * return to backlog, or leave."
 *
 * **The prompt is a decision, never an automatic move.** §7.6 says so outright,
 * and it is why nothing in this product closes a cycle on a schedule: a job
 * that swept unfinished work into the next sprint every fortnight would be
 * making a planning decision on a team's behalf, silently, at 6pm.
 *
 * **"Leave them" is a real answer and it closes the cycle.** All three set
 * `completed_at`; the difference is only where the work goes. A prompt that
 * reappeared because somebody chose to change nothing would be a prompt nobody
 * ever finishes answering, and the screen would nag forever about a sprint that
 * ended in March.
 *
 * §11's five states: `[L]` the Button's spinner · `[E]` a cycle that ended with
 * nothing open renders the "leave" branch only, because there is no work to
 * move · `[S]` the panel is gone on the next render, since the cycle is now
 * `completed` · `[X]` the error keeps the chosen option · `[!]` no next cycle
 * to move to means that option is not offered, rather than offered and refused.
 */

export type CloseTarget = { id: string; name: string };

export function CycleClosePrompt({
  workspaceSlug,
  projectSlug,
  projectId,
  cycleId,
  openCount,
  nextCycle,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  cycleId: string;
  openCount: number;
  nextCycle: CloseTarget | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    completeCycleAction,
    ROW_IDLE,
  );

  // "Leave" when there is nothing to move, so the default answer is never one
  // that relocates work somebody has not looked at.
  const [disposition, setDisposition] = useState<string>(openCount === 0 ? 'leave' : 'backlog');

  const options = [
    ...(nextCycle
      ? [{ value: 'next_cycle', label: t('cycles.close.toNext', { name: nextCycle.name }) }]
      : []),
    { value: 'backlog', label: t('cycles.close.toBacklog') },
    { value: 'leave', label: t('cycles.close.leave') },
  ];

  return (
    <form action={action} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="cycleId" value={cycleId} />
      {nextCycle && <input type="hidden" name="targetCycleId" value={nextCycle.id} />}

      <div className="space-y-1">
        <h2 className="text-sm font-medium text-text">{t('cycles.close.heading')}</h2>
        <p className="text-sm text-text-muted">
          {openCount === 0
            ? t('cycles.close.nothingOpen')
            : t('cycles.close.body', { count: openCount })}
        </p>
      </div>

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      {/*
        Radios rather than three buttons: this is one question with three
        answers, and three buttons would make each an independent act with no
        way to see which one you were about to take. §12's Radio, natively —
        the platform control already carries the group semantics, arrow-key
        navigation and the label association a custom one would have to be given
        by hand. The same argument slice 9 made for its preference checkboxes.
      */}
      <fieldset className="space-y-2">
        <legend className="sr-only">{t('cycles.close.heading')}</legend>
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-text">
            <input
              type="radio"
              name="disposition"
              value={option.value}
              checked={disposition === option.value}
              onChange={(event) => setDisposition(event.target.value)}
              className="size-4 accent-[var(--accent)]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <Button type="submit" variant="primary" loading={pending}>
        {t('cycles.close.submit')}
      </Button>
    </form>
  );
}
