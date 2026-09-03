'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { InputField, SelectField } from '@/components/ui/field';
import { LABEL_COLORS } from '@/lib/label-colors';
import { IDLE, ROW_IDLE, type FormState, type RowActionState } from '@/lib/form-state';
import type { RowLabel } from '@/lib/work-item-row';
import { LabelChip } from './label-chip';
import {
  createLabelAction,
  deleteLabelAction,
  updateLabelAction,
} from '@/app/[locale]/[workspaceSlug]/settings/labels/actions';

/**
 * The workspace's labels: add, rename, recolour, delete.
 *
 * Shaped like the workflow-state editor of slice 4, because it is the same kind
 * of screen — a short list of company vocabulary an Owner or Admin maintains —
 * and two settings screens that behave differently for no reason is how a
 * product stops feeling like one product.
 *
 * §11's five states: `[L]` server-rendered · `[E]` an empty state that offers
 * the one action that fills it · `[S]` the list re-renders · `[X]` errors land
 * on the row that caused them, as translated keys · `[!]` a label still on
 * items refuses to delete until the person confirms, and the confirmation says
 * what it will do.
 */

export function LabelsEditor({
  workspaceSlug,
  locale,
  labels,
}: {
  workspaceSlug: string;
  locale: string;
  labels: readonly RowLabel[];
}) {
  const t = useTranslations();
  const [created, create, creating] = useActionState<FormState, FormData>(createLabelAction, IDLE);

  return (
    <div className="space-y-6">
      <form action={create} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
        <input type="hidden" name="locale" value={locale} />

        <InputField
          name="name"
          label={t('labels.name')}
          required
          className="min-w-48"
          error={created.fields?.name ? t(created.fields.name) : undefined}
        />

        <SelectField name="color" label={t('labels.color')} className="min-w-36">
          {LABEL_COLORS.map((color) => (
            <option key={color} value={color}>
              {t(`labelColor.${color}`)}
            </option>
          ))}
        </SelectField>

        <Button type="submit" variant="primary" loading={creating}>
          {t('labels.add')}
        </Button>
      </form>

      {created.error && <Alert tone="danger">{t(created.error)}</Alert>}

      {labels.length === 0 ? (
        <EmptyState title={t('labels.empty')} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {labels.map((label) => (
            <LabelRow key={label.id} workspaceSlug={workspaceSlug} locale={locale} label={label} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LabelRow({
  workspaceSlug,
  locale,
  label,
}: {
  workspaceSlug: string;
  locale: string;
  label: RowLabel;
}) {
  const t = useTranslations();
  const [saved, save, saving] = useActionState<RowActionState, FormData>(
    updateLabelAction,
    ROW_IDLE,
  );
  const [removed, remove, removing] = useActionState<RowActionState, FormData>(
    deleteLabelAction,
    ROW_IDLE,
  );

  // §6: "deleting a definition with data requires an explicit choice about the
  // data". The first attempt is refused with `in_use`; this is the second, and
  // it says what it will do before it does it.
  const [confirming, setConfirming] = useState(false);
  const inUse = removed.error === 'labels.errors.inUse';

  const hidden = (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="labelId" value={label.id} />
    </>
  );

  return (
    <li className="flex flex-wrap items-end gap-2 px-3 py-2">
      <span className="self-center">
        <LabelChip name={label.name} color={label.color} />
      </span>

      <form action={save} className="flex flex-wrap items-end gap-2">
        {hidden}
        <InputField
          name="name"
          label={t('labels.name')}
          defaultValue={label.name}
          className="min-w-40"
        />
        <SelectField
          name="color"
          label={t('labels.color')}
          defaultValue={label.color}
          className="min-w-32"
        >
          {LABEL_COLORS.map((color) => (
            <option key={color} value={color}>
              {t(`labelColor.${color}`)}
            </option>
          ))}
        </SelectField>
        <Button type="submit" size="sm" loading={saving}>
          {t('action.save')}
        </Button>
      </form>

      <form action={remove} className="ms-auto flex items-center gap-2 self-center">
        {hidden}
        {(confirming || inUse) && <input type="hidden" name="detach" value="1" />}
        <Button
          type="submit"
          variant="danger"
          size="sm"
          loading={removing}
          onClick={() => setConfirming(true)}
        >
          {inUse || confirming ? t('labels.confirmDelete') : t('action.delete')}
        </Button>
      </form>

      {saved.error && (
        <p role="alert" className="basis-full text-2xs text-danger">
          {t(saved.error)}
        </p>
      )}
      {removed.error && (
        <p role="alert" className="basis-full text-2xs text-danger">
          {t(removed.error)}
        </p>
      )}
    </li>
  );
}
