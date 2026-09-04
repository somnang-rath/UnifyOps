'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { setItemCycleAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/cycles/actions';

/**
 * Which cycle one item is planned into (§7.6), on the item detail page.
 *
 * **The permission here is `work_item.edit`, not `project.settings`.** §7.6
 * makes membership a property of the item, and that is not only a data shape —
 * it is who may change it. A Member can put their own work into the sprint
 * their Lead set up, which is the split labels already make between deciding
 * what tags exist and applying one.
 *
 * **The empty option is the backlog, not "unset".** It is a destination: work
 * that is not planned into anything is in the backlog, which is where §7.6's
 * picker adds items *from*. Labelling it "None" would make it read as a missing
 * value somebody forgot to fill in.
 *
 * **The current cycle is always in the list even if it has closed.** A control
 * that could not show its own value would read as though the item were in no
 * cycle at all, and the first click would silently move it.
 *
 * A native `<select>` on the same §12 reasoning `SelectField` gives: a project
 * runs a handful of open cycles at a time, well under the seven-option
 * threshold where type-ahead earns its place, and on a phone this opens the OS
 * picker rather than a list that fights the viewport.
 *
 * §11's five states: `[L]` the select disables itself while the action is in
 * flight, which is also the signal e2e waits on · `[E]` a project with no
 * cycles renders a line saying so and no control · `[S]` the row re-renders
 * with the new value — no toast, because the change is visible where it
 * happened (§11) · `[X]` an error appears beside the control and the select
 * falls back to the server's value on the next render · `[!]` a cycle that
 * closed between the page loading and the click is refused by name.
 */

export type CycleOption = { id: string; name: string; closed: boolean };

export function ItemCycleSelect({
  workspaceSlug,
  projectSlug,
  projectId,
  workItemId,
  number,
  cycleId,
  options,
  canEdit,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  workItemId: string;
  number: number;
  cycleId: string | null;
  options: readonly CycleOption[];
  canEdit: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    setItemCycleAction,
    ROW_IDLE,
  );

  // Keeps the control honest when the server refuses: the select is
  // uncontrolled and driven by `defaultValue`, so a refused change would leave
  // the browser showing a value the database does not hold.
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (state.error && selectRef.current) selectRef.current.value = cycleId ?? '';
  }, [state.error, cycleId]);

  const current = options.find((option) => option.id === cycleId);

  if (!canEdit) {
    return (
      <p className="text-sm text-text">
        {current ? current.name : t('cycles.item.backlog')}
      </p>
    );
  }

  if (options.length === 0) {
    return <p className="text-sm text-text-subtle">{t('cycles.item.none')}</p>;
  }

  return (
    <form ref={formRef} action={action} className="space-y-1.5">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="number" value={number} />

      <select
        ref={selectRef}
        name="cycleId"
        defaultValue={cycleId ?? ''}
        disabled={pending}
        aria-label={t('cycles.item.label')}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-8 w-full rounded-xs border border-border bg-surface px-2.5 text-sm text-text transition-colors duration-120 hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-subtle"
      >
        <option value="">{t('cycles.item.backlog')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {/* A closed cycle is marked rather than hidden — see above. */}
            {option.closed ? t('cycles.item.closedOption', { name: option.name }) : option.name}
          </option>
        ))}
      </select>

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}
    </form>
  );
}
