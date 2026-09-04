'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField, TextareaField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { IDLE, type FormState } from '@/lib/form-state';
import { MAX_CYCLE_NAME_LENGTH, validatePeriod } from '@/lib/cycles';
import { createCycleAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/cycles/actions';

/**
 * §7.6 step one: "create with date range".
 *
 * **The client and the server validate through the same function.** The bar
 * under the fields is `validatePeriod` from `src/lib/cycles.ts`, and so is the
 * first thing `createCycle` does — the bargain `parseRecipients` makes between
 * the invite form's chips and the send, and `slugify` between the preview and
 * the save. One implementation, so the form cannot show a range the save will
 * refuse.
 *
 * **Overlap warns and does not block** (§7.6: "overlapping cycles → allowed,
 * warned"). Two teams sharing a project legitimately run overlapping cycles,
 * and a product that refused would be asserting an opinion it has no way to
 * back. The warning is computed from the ranges the page already loaded, so it
 * costs no round trip.
 *
 * §11's five states: `[L]` the Button's own spinner, at preserved width ·
 * `[E]` n/a, this is the empty state's action · `[S]` the action redirects to
 * the cycle, because §7.6's next step is adding work to it · `[X]` the error
 * sits above the fields and **the typed values survive**, which is why every
 * input is controlled · `[!]` a backwards range and an over-long one are
 * refused before submit, with the reason named.
 */

export type ExistingRange = { id: string; name: string; startDate: string; endDate: string };

export function CycleForm({
  workspaceSlug,
  projectSlug,
  projectId,
  existing,
  defaults,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  existing: readonly ExistingRange[];
  /** Today and a fortnight out, resolved on the server in the workspace's zone. */
  defaults: { startDate: string; endDate: string; name: string };
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(createCycleAction, IDLE);

  // Controlled, because §11 requires an error to retain user input and because
  // the live validation below has to read what is currently typed.
  const [name, setName] = useState(defaults.name);
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  const problem = validatePeriod({ name, startDate, endDate });
  // An empty name is the state the form opens in, not a mistake somebody made,
  // so it disables the button without shouting.
  const localError =
    problem && problem !== 'name_required' ? t(`cycles.errors.${errorKey(problem)}`) : undefined;

  const overlaps = existing.filter(
    (range) => range.startDate <= endDate && startDate <= range.endDate,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <InputField
        label={t('cycles.form.name')}
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        maxLength={MAX_CYCLE_NAME_LENGTH * 4}
        error={problem === 'name_too_long' ? t('cycles.errors.nameTooLong') : undefined}
        help={t('cycles.form.nameHelp')}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField
          label={t('cycles.form.startDate')}
          name="startDate"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          required
        />
        <InputField
          label={t('cycles.form.endDate')}
          name="endDate"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          required
          error={
            problem === 'end_before_start' || problem === 'too_long' ? localError : undefined
          }
        />
      </div>

      <TextareaField
        label={t('cycles.form.goal')}
        name="goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        help={t('cycles.form.goalHelp')}
      />

      {/* §7.6: allowed, warned. A warning, not an error — the form still submits. */}
      {overlaps.length > 0 && (
        <Alert tone="warning">
          {t('cycles.form.overlapWarning', {
            count: overlaps.length,
            names: overlaps.map((range) => range.name).join(', '),
          })}
        </Alert>
      )}

      <Button type="submit" variant="primary" loading={pending} disabled={problem !== null}>
        {t('cycles.form.submit')}
      </Button>
    </form>
  );
}

/** `end_before_start` → `endBeforeStart`. The catalogues are camelCase (§13). */
function errorKey(problem: string): string {
  return problem.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
