'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { InputField, SelectField } from '@/components/ui/field';
import { IDLE, type FormState } from '@/lib/form-state';
import type { CustomFieldKind } from '@/lib/custom-fields';
import type { RowPerson } from '@/lib/work-item-row';
import { setCustomFieldsAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * One item's custom fields (§6-4, §7.11: "immediately available in … item
 * detail").
 *
 * **One form for the whole panel**, like the details form above it and for the
 * same reason: the fields a person came to fill in are one thought and one
 * click. It is also what keeps §7.8 honest — a save that touched four fields is
 * one notification and four feed lines, not four of each.
 *
 * **Every control is a native one.** §12's inventory has a Combobox and a
 * Switch and neither is built; a multi-select here is a checkbox group and a
 * single select is a `<select>`, both of which are keyboard-operable, correct
 * at 390px (§15-6) and honest about what they do. Building a one-off Switch for
 * this screen is how a design system ends up with two of them — the same
 * argument slice 9's preference grid made.
 *
 * **A field with no options renders a disabled control and says why.** A select
 * whose vocabulary nobody has filled in is a dropdown with nothing in it, which
 * reads as a bug rather than as unfinished configuration.
 */

export type CustomFieldControl = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: { id: string; name: string }[];
  /** What this item holds today: text, a number, a date, `1`, ids, or a member id. */
  value: string[];
};

export type ItemContext = {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
  workItemId: string;
  number: number;
};

export function CustomFieldValues({
  context,
  fields,
  people,
  canEdit,
}: {
  context: ItemContext;
  fields: readonly CustomFieldControl[];
  people: readonly RowPerson[];
  canEdit: boolean;
}) {
  const t = useTranslations();
  const [state, action, saving] = useActionState<FormState, FormData>(setCustomFieldsAction, IDLE);

  // Nothing defined for this project. The panel is absent rather than an empty
  // box: §7.11 puts the "add a field" affordance in project settings, and this
  // screen offering one would be a second entrance to a Lead-only surface.
  if (fields.length === 0) return null;

  return (
    <section aria-labelledby="custom-fields-heading" className="space-y-3">
      <h2
        id="custom-fields-heading"
        className="font-[family-name:var(--font-display)] text-sm font-semibold"
      >
        {t('customFields.heading')}
      </h2>

      <form action={action} className="space-y-4 rounded-md border border-border bg-surface p-4">
        <input type="hidden" name="workspaceSlug" value={context.workspaceSlug} />
        <input type="hidden" name="projectSlug" value={context.projectSlug} />
        <input type="hidden" name="locale" value={context.locale} />
        <input type="hidden" name="workItemId" value={context.workItemId} />
        <input type="hidden" name="number" value={context.number} />

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <FieldControl
              key={field.id}
              field={field}
              people={people}
              canEdit={canEdit}
              error={state.fields?.[`cf:${field.id}`]}
            />
          ))}
        </div>

        {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

        {canEdit && (
          <Button type="submit" size="sm" loading={saving}>
            {t('customFields.saveValues')}
          </Button>
        )}
      </form>
    </section>
  );
}

function FieldControl({
  field,
  people,
  canEdit,
  error,
}: {
  field: CustomFieldControl;
  people: readonly RowPerson[];
  canEdit: boolean;
  error?: string;
}) {
  const t = useTranslations();
  const name = `cf:${field.id}`;
  const message = error ? t(error) : undefined;

  /**
   * Every field names itself, whether or not it has a value.
   *
   * This is what tells the action which fields the form actually drew, so a
   * cleared value is a clear rather than an omission — and so a field added
   * while somebody had the page open is left alone instead of being wiped by a
   * save that never knew about it.
   */
  const declare = <input type="hidden" name="fieldId" value={field.id} />;

  switch (field.kind) {
    case 'text':
      return (
        <div>
          {declare}
          <InputField
            label={field.name}
            name={name}
            defaultValue={field.value[0] ?? ''}
            disabled={!canEdit}
            error={message}
          />
        </div>
      );

    case 'number':
      return (
        <div>
          {declare}
          <InputField
            label={field.name}
            name={name}
            type="number"
            // `any`, not `1`: the column is numeric precisely so a rate or a
            // total can carry decimals, and a step of 1 would have the browser
            // refuse them before the server ever saw one.
            step="any"
            defaultValue={field.value[0] ?? ''}
            disabled={!canEdit}
            error={message}
          />
        </div>
      );

    case 'date':
      return (
        <div>
          {declare}
          <InputField
            label={field.name}
            name={name}
            type="date"
            defaultValue={field.value[0] ?? ''}
            disabled={!canEdit}
            error={message}
          />
        </div>
      );

    case 'checkbox':
      return (
        <div className="space-y-1.5">
          {declare}
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              name={name}
              value="1"
              defaultChecked={field.value.length > 0}
              disabled={!canEdit}
              className="size-4 rounded-xs border-border accent-accent"
            />
            {field.name}
          </label>
          {message && (
            <p role="alert" className="text-xs text-danger">
              {message}
            </p>
          )}
        </div>
      );

    case 'user':
      return (
        <div>
          {declare}
          <SelectField
            label={field.name}
            name={name}
            defaultValue={field.value[0] ?? ''}
            disabled={!canEdit}
            error={message}
          >
            <option value="">{t('customFields.valueNone')}</option>
            {people.map((person) => (
              <option key={person.memberId} value={person.memberId}>
                {person.name}
              </option>
            ))}
          </SelectField>
        </div>
      );

    case 'select':
      return (
        <div>
          {declare}
          <SelectField
            label={field.name}
            name={name}
            defaultValue={field.value[0] ?? ''}
            disabled={!canEdit || field.options.length === 0}
            help={field.options.length === 0 ? t('customFields.noOptions') : undefined}
            error={message}
          >
            <option value="">{t('customFields.valueNone')}</option>
            {field.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
        </div>
      );

    case 'multi_select':
      return (
        <div className="space-y-1.5">
          {declare}
          <fieldset disabled={!canEdit} className="space-y-1.5">
            <legend className="text-xs font-medium text-text-muted">{field.name}</legend>

            {field.options.length === 0 ? (
              <p className="text-xs text-text-subtle">{t('customFields.noOptions')}</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {field.options.map((option) => (
                  <label key={option.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name={name}
                      value={option.id}
                      defaultChecked={field.value.includes(option.id)}
                      className="size-4 rounded-xs border-border accent-accent"
                    />
                    {option.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {message && (
            <p role="alert" className="text-xs text-danger">
              {message}
            </p>
          )}
        </div>
      );
  }
}
