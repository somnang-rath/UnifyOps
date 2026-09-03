'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { InputField, SelectField, TextareaField } from '@/components/ui/field';
import { LabelChip } from '@/components/work-item/label-chip';
import { IDLE, ROW_IDLE, type FormState, type RowActionState } from '@/lib/form-state';
import { PRIORITIES } from '@/lib/priorities';
import type { RowLabel, RowPerson } from '@/lib/work-item-row';
import {
  deleteWorkItemAction,
  setAssigneesAction,
  setBlockedAction,
  setLabelsAction,
  updateWorkItemAction,
} from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * Editing one work item.
 *
 * Four forms rather than one, and the split is not arbitrary — it follows what
 * a person does in one go. Fields you type (title, description, dates,
 * estimate, priority) save together, because they are one thought. Assignees,
 * labels and the blocked flag each save on their own, because each is a
 * decision taken by itself and §4 attaches different consequences to each:
 * assignment notifies, blocking notifies the lead, labelling notifies nobody.
 *
 * Assignment and labelling post the **whole set** (§4: "assignment is
 * multiple"). An add-then-remove pair would leave a window where the item is
 * assigned to nobody, and slice 9 would send a notification for it.
 *
 * Every message crossing the wire is a key, never a sentence (§13).
 */

export type EditorContext = {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  locale: string;
};

export function ItemEditor({
  context,
  item,
  people,
  labels,
  canEdit,
}: {
  context: EditorContext;
  item: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    estimate: number | null;
    blocked: boolean;
    blockedReason: string | null;
    assigneeIds: string[];
    labelIds: string[];
  };
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  canEdit: boolean;
}) {
  const t = useTranslations();

  const [details, saveDetails, savingDetails] = useActionState<FormState, FormData>(
    updateWorkItemAction,
    IDLE,
  );
  const [assignees, saveAssignees, savingAssignees] = useActionState<RowActionState, FormData>(
    setAssigneesAction,
    ROW_IDLE,
  );
  const [labelling, saveLabels, savingLabels] = useActionState<RowActionState, FormData>(
    setLabelsAction,
    ROW_IDLE,
  );
  const [blocking, saveBlocked, savingBlocked] = useActionState<RowActionState, FormData>(
    setBlockedAction,
    ROW_IDLE,
  );
  const [removal, remove, removing] = useActionState<RowActionState, FormData>(
    deleteWorkItemAction,
    ROW_IDLE,
  );

  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={context.workspaceSlug} />
      <input type="hidden" name="projectSlug" value={context.projectSlug} />
      <input type="hidden" name="projectId" value={context.projectId} />
      <input type="hidden" name="locale" value={context.locale} />
      <input type="hidden" name="workItemId" value={item.id} />
      <input type="hidden" name="number" value={item.number} />
    </>
  );

  return (
    <div className="space-y-6">
      <form action={saveDetails} className="space-y-4">
        {hidden}

        <InputField
          name="title"
          label={t('workItems.title')}
          required
          defaultValue={item.title}
          disabled={!canEdit}
          error={details.fields?.title ? t(details.fields.title) : undefined}
        />

        <TextareaField
          name="description"
          label={t('workItems.description')}
          rows={6}
          defaultValue={item.description ?? ''}
          disabled={!canEdit}
          // §4 calls this a rich description. It holds text today; the editor is
          // slice 8's decision, made once for this field and comments together
          // rather than twice.
          help={t('workItems.descriptionHint')}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="priority"
            label={t('workItems.priority')}
            defaultValue={item.priority}
            disabled={!canEdit}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`priority.${priority}`)}
              </option>
            ))}
          </SelectField>

          <InputField
            name="estimate"
            type="number"
            min={0}
            step={1}
            label={t('workItems.estimate')}
            // §17-9: points, not hours. Hours would claim a precision v1 cannot
            // back while it has no time tracking.
            help={t('workItems.estimateHint')}
            defaultValue={item.estimate ?? ''}
            disabled={!canEdit}
          />

          <InputField
            name="startDate"
            type="date"
            label={t('workItems.startDate')}
            defaultValue={item.startDate ?? ''}
            disabled={!canEdit}
          />

          <InputField
            name="dueDate"
            type="date"
            label={t('workItems.dueDate')}
            help={t('workItems.dueDateHint')}
            defaultValue={item.dueDate ?? ''}
            disabled={!canEdit}
          />
        </div>

        {details.error && <Alert tone="danger">{t(details.error)}</Alert>}

        {canEdit && (
          <Button type="submit" variant="primary" loading={savingDetails}>
            {t('action.save')}
          </Button>
        )}
      </form>

      <form action={saveAssignees} className="space-y-2">
        {hidden}
        <fieldset disabled={!canEdit} className="space-y-2">
          <legend className="text-xs font-medium text-text">{t('workItems.assignees')}</legend>

          {people.length === 0 ? (
            <p className="text-xs text-text-subtle">{t('workItems.noMembers')}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {people.map((person) => (
                <label key={person.memberId} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="memberId"
                    value={person.memberId}
                    defaultChecked={item.assigneeIds.includes(person.memberId)}
                    className="size-4 rounded-xs border-border accent-accent"
                  />
                  {person.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {assignees.error && <Alert tone="danger">{t(assignees.error)}</Alert>}
        {canEdit && people.length > 0 && (
          <Button type="submit" size="sm" loading={savingAssignees}>
            {t('workItems.saveAssignees')}
          </Button>
        )}
      </form>

      <form action={saveLabels} className="space-y-2">
        {hidden}
        <fieldset disabled={!canEdit} className="space-y-2">
          <legend className="text-xs font-medium text-text">{t('workItems.labels')}</legend>

          {labels.length === 0 ? (
            // A label is workspace vocabulary an Owner or Admin maintains, so
            // the empty state points at where that happens rather than offering
            // an action most people cannot take.
            <p className="text-xs text-text-subtle">{t('workItems.noLabels')}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="labelId"
                    value={label.id}
                    defaultChecked={item.labelIds.includes(label.id)}
                    className="size-4 rounded-xs border-border accent-accent"
                  />
                  <LabelChip name={label.name} color={label.color} />
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {labelling.error && <Alert tone="danger">{t(labelling.error)}</Alert>}
        {canEdit && labels.length > 0 && (
          <Button type="submit" size="sm" loading={savingLabels}>
            {t('workItems.saveLabels')}
          </Button>
        )}
      </form>

      {/* §4: blocked is a flag, not a state — an item can be In Progress *and*
          blocked. The reason is required, because a blocked card nobody can
          unblock without asking is worse than no flag at all (§7.3). */}
      <form action={saveBlocked} className="space-y-2 rounded-md border border-border bg-surface p-3">
        {hidden}
        <input type="hidden" name="blocked" value={item.blocked ? '0' : '1'} />

        <p className="text-xs font-medium text-text">{t('workItems.blockedTitle')}</p>

        {item.blocked ? (
          <>
            <p className="text-sm text-text-muted">{item.blockedReason}</p>
            {canEdit && (
              <Button type="submit" size="sm" loading={savingBlocked}>
                {t('workItems.unblock')}
              </Button>
            )}
          </>
        ) : (
          <>
            <InputField
              name="reason"
              label={t('workItems.blockedReason')}
              required
              disabled={!canEdit}
            />
            {canEdit && (
              <Button type="submit" size="sm" loading={savingBlocked}>
                {t('workItems.block')}
              </Button>
            )}
          </>
        )}

        {blocking.error && <Alert tone="danger">{t(blocking.error)}</Alert>}
      </form>

      {canEdit && (
        <form action={remove} className="space-y-2 border-t border-border pt-4">
          {hidden}
          <Button type="submit" variant="danger" size="sm" loading={removing}>
            {t('workItems.delete')}
          </Button>
          {/* §4: a 30-day recovery window, and the identifier is never reused —
              so the warning can promise both without hedging. */}
          <p className="text-2xs text-text-subtle">{t('workItems.deleteHint')}</p>
          {removal.error && <Alert tone="danger">{t(removal.error)}</Alert>}
        </form>
      )}
    </div>
  );
}
