'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert, Badge } from '@/components/ui/feedback';
import { ROW_IDLE, IDLE, type FormState, type RowActionState } from '@/lib/form-state';
import { CUSTOM_FIELD_KINDS, hasOptions, type CustomFieldKind } from '@/lib/custom-fields';
import {
  addCustomFieldAction,
  addCustomFieldOptionAction,
  deleteCustomFieldAction,
  moveCustomFieldAction,
  removeCustomFieldOptionAction,
  renameCustomFieldAction,
  renameCustomFieldOptionAction,
} from '@/app/[locale]/[workspaceSlug]/projects/actions';

/**
 * §7.11, in full: "Settings → Project → Custom fields → Add → pick type → name
 * → (options if select) → save."
 *
 * Three things here are load-bearing beyond the list of operations, and each
 * one is a sentence from the plan rather than a preference.
 *
 * **The type is shown and cannot be changed.** §7.11 offers a rename and
 * nothing else. Turning a text field into a date is a migration over every
 * value already stored, with no answer for the ones that will not convert — so
 * the control is absent rather than disabled, because a disabled select invites
 * somebody to go looking for the permission that would enable it.
 *
 * **Deleting says how many values go with it, before the click.** "`[!]`
 * deleting a field with values → choose: delete values, or export first.
 * Explicit, never silent." A confirmation that does not name the number is not
 * the explicit choice that sentence asks for. Exporting first is the other
 * branch and belongs to CSV export, a §4 should-have that does not exist yet —
 * so this screen offers the honest half and names what is at stake.
 *
 * **Reordering is buttons, not a drag**, exactly as `StatesEditor` argues: a
 * settings list of a few rows is faster and keyboard-operable for free, and
 * drag-and-drop is where §11's mouse-free promise is usually quietly dropped.
 */

export type EditableCustomField = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: { id: string; name: string }[];
  /** How many items have filled it in — the number the delete confirmation shows. */
  valueCount: number;
};

export function CustomFieldsEditor({
  workspaceSlug,
  projectSlug,
  projectId,
  fields,
  canEdit,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  fields: EditableCustomField[];
  canEdit: boolean;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      {fields.length === 0 ? (
        // §11's `[E]`: an empty state that says what the thing is for, rather
        // than an empty box above a form.
        <p className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
          {t('customFields.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {fields.map((field, index) => (
            <li key={field.id} className="p-3">
              <FieldRow
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                projectId={projectId}
                field={field}
                isFirst={index === 0}
                isLast={index === fields.length - 1}
                canEdit={canEdit}
              />
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <AddFieldForm
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={projectId}
        />
      )}

      <p className="text-xs text-text-subtle">{t('customFields.kindHint')}</p>
    </div>
  );
}

function FieldRow({
  workspaceSlug,
  projectSlug,
  projectId,
  field,
  isFirst,
  isLast,
  canEdit,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  field: EditableCustomField;
  isFirst: boolean;
  isLast: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const [rename, renameAction, renaming] = useActionState<RowActionState, FormData>(
    renameCustomFieldAction,
    ROW_IDLE,
  );
  const [remove, removeAction, removing] = useActionState<RowActionState, FormData>(
    deleteCustomFieldAction,
    ROW_IDLE,
  );
  const [, moveAction, moving] = useActionState<RowActionState, FormData>(
    moveCustomFieldAction,
    ROW_IDLE,
  );
  const [confirming, setConfirming] = useState(false);

  const context = { workspaceSlug, projectSlug, projectId };

  if (!canEdit) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text">{field.name}</span>
        <Badge>{t(`customFieldKind.${field.kind}`)}</Badge>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-32 text-sm font-medium text-text">{field.name}</span>
        <Badge>{t(`customFieldKind.${field.kind}`)}</Badge>

        <div className="ms-auto flex items-center gap-1">
          <form action={moveAction}>
            <HiddenContext {...context} />
            <input type="hidden" name="fieldId" value={field.id} />
            <input type="hidden" name="direction" value="up" />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isFirst || moving}
              aria-label={t('customFields.moveUp', { name: field.name })}
            >
              <ArrowUp aria-hidden className="size-4" />
            </Button>
          </form>

          <form action={moveAction}>
            <HiddenContext {...context} />
            <input type="hidden" name="fieldId" value={field.id} />
            <input type="hidden" name="direction" value="down" />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isLast || moving}
              aria-label={t('customFields.moveDown', { name: field.name })}
            >
              <ArrowDown aria-hidden className="size-4" />
            </Button>
          </form>
        </div>
      </div>

      <form action={renameAction} className="grid gap-3 sm:grid-cols-[2fr_auto] sm:items-end">
        <HiddenContext {...context} />
        <input type="hidden" name="fieldId" value={field.id} />

        <InputField
          label={t('customFields.name')}
          name="name"
          defaultValue={field.name}
          required
          error={rename.error && t(rename.error)}
        />

        <Button type="submit" loading={renaming}>
          {t('customFields.save')}
        </Button>
      </form>

      {hasOptions(field.kind) && (
        <OptionsEditor context={context} field={field} />
      )}

      {!confirming && (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          {t('customFields.delete')}
        </Button>
      )}

      {confirming && (
        <form
          action={removeAction}
          // Grouped and labelled: the destructive choice and the question it
          // answers have to be one thing to a screen reader, not a stray count
          // followed by a button called "Delete".
          role="group"
          aria-label={t('customFields.deleteTitle', { name: field.name })}
          className="space-y-3 rounded-sm border border-danger bg-danger-subtle p-3"
        >
          <HiddenContext {...context} />
          <input type="hidden" name="fieldId" value={field.id} />
          <input type="hidden" name="confirmed" value="1" />

          <p className="text-sm">{t('customFields.deleteBody')}</p>
          <p className="text-sm font-medium">
            {t('customFields.deleteCount', { count: field.valueCount })}
          </p>

          {remove.error && <Alert tone="danger">{t(remove.error)}</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={removing}>
              {t('customFields.confirmDelete')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('action.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * A select field's vocabulary.
 *
 * Rename is a plain save and needs no warning: a value stores the option's id,
 * so correcting "Acme" to "Acme Ltd" changes every item that named it and loses
 * nothing. Removing one is the opposite and asks first — which is the whole
 * reason the options are rows with ids rather than strings in an array.
 */
function OptionsEditor({
  context,
  field,
}: {
  context: { workspaceSlug: string; projectSlug: string; projectId: string };
  field: EditableCustomField;
}) {
  const t = useTranslations();
  const [add, addAction, adding] = useActionState<RowActionState, FormData>(
    addCustomFieldOptionAction,
    ROW_IDLE,
  );

  return (
    <div className="space-y-2 rounded-sm border border-border bg-surface-sunken p-3">
      <p className="text-xs font-medium text-text">{t('customFields.options')}</p>

      {field.options.length === 0 ? (
        <p className="text-xs text-text-subtle">{t('customFields.noOptions')}</p>
      ) : (
        <ul className="space-y-2">
          {field.options.map((option) => (
            <li key={option.id}>
              <OptionRow context={context} fieldId={field.id} option={option} />
            </li>
          ))}
        </ul>
      )}

      <form action={addAction} className="flex flex-wrap items-end gap-2">
        <HiddenContext {...context} />
        <input type="hidden" name="fieldId" value={field.id} />

        <div className="min-w-40 flex-1">
          <InputField
            label={t('customFields.optionName')}
            name="name"
            required
            error={add.error && t(add.error)}
          />
        </div>

        <Button type="submit" size="sm" loading={adding}>
          {t('customFields.addOption')}
        </Button>
      </form>
    </div>
  );
}

function OptionRow({
  context,
  fieldId,
  option,
}: {
  context: { workspaceSlug: string; projectSlug: string; projectId: string };
  fieldId: string;
  option: { id: string; name: string };
}) {
  const t = useTranslations();
  const [rename, renameAction, renaming] = useActionState<RowActionState, FormData>(
    renameCustomFieldOptionAction,
    ROW_IDLE,
  );
  const [remove, removeAction, removing] = useActionState<RowActionState, FormData>(
    removeCustomFieldOptionAction,
    ROW_IDLE,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <form action={renameAction} className="flex flex-1 flex-wrap items-end gap-2">
          <HiddenContext {...context} />
          <input type="hidden" name="fieldId" value={fieldId} />
          <input type="hidden" name="optionId" value={option.id} />

          <div className="min-w-40 flex-1">
            <InputField
              label={t('customFields.optionName')}
              name="name"
              defaultValue={option.name}
              required
              error={rename.error && t(rename.error)}
            />
          </div>

          <Button type="submit" size="sm" variant="secondary" loading={renaming}>
            {t('action.save')}
          </Button>
        </form>

        {!confirming && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            aria-label={t('customFields.removeOption', { name: option.name })}
          >
            {t('action.delete')}
          </Button>
        )}
      </div>

      {confirming && (
        <form
          action={removeAction}
          role="group"
          aria-label={t('customFields.removeOptionTitle', { name: option.name })}
          className="space-y-2 rounded-sm border border-danger bg-danger-subtle p-3"
        >
          <HiddenContext {...context} />
          <input type="hidden" name="fieldId" value={fieldId} />
          <input type="hidden" name="optionId" value={option.id} />
          <input type="hidden" name="confirmed" value="1" />

          <p className="text-sm">{t('customFields.confirmRemoveOption')}</p>
          {remove.error && <Alert tone="danger">{t(remove.error)}</Alert>}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" size="sm" loading={removing}>
              {t('action.delete')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              {t('action.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddFieldForm({
  workspaceSlug,
  projectSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState<FormState, FormData>(addCustomFieldAction, IDLE);

  return (
    <form
      action={action}
      className="grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
    >
      <HiddenContext
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        projectId={projectId}
      />

      <InputField
        label={t('customFields.name')}
        name="name"
        required
        error={state.error && t(state.error)}
      />

      <SelectField label={t('customFields.kind')} name="kind" defaultValue="text">
        {CUSTOM_FIELD_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`customFieldKind.${kind}`)}
          </option>
        ))}
      </SelectField>

      <Button type="submit" variant="primary" loading={pending}>
        {pending ? t('customFields.adding') : t('customFields.add')}
      </Button>
    </form>
  );
}

/**
 * The three values every action on this screen needs.
 *
 * They travel in the form rather than in a closure because a server action is a
 * public endpoint: what arrives is a request, never an authorization. The
 * server re-resolves the actor from the session and asks §10 again — these only
 * say *which* project is meant.
 *
 * The locale travels with them because `revalidateProject` rebuilds a
 * locale-prefixed path (`/km/acme/projects/...`): without it every save would
 * revalidate the English copy of a Khmer screen, and the person who just
 * renamed a field would still be looking at the old name.
 */
function HiddenContext({
  workspaceSlug,
  projectSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
}) {
  const locale = useLocale();

  return (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );
}
