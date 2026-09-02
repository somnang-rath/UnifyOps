'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { StatePill } from '@/components/ui/state-pill';
import { ROW_IDLE, IDLE, type FormState, type RowActionState } from '@/lib/form-state';
import { displayName } from '@/lib/seeded-name';
import { STATE_COLORS, STATE_GROUPS, type StateColor, type StateGroup } from '@/lib/state-groups';
import {
  addStateAction,
  deleteStateAction,
  moveStateAction,
  updateStateAction,
} from '@/app/[locale]/[workspaceSlug]/projects/actions';

/**
 * §6-3's workflow configuration, in full: "States per project: add, rename,
 * recolour, reorder, regroup, delete-with-migration".
 *
 * Two things here are load-bearing beyond the list of operations.
 *
 * Reordering is buttons, not a drag. A board's cards are dragged because that
 * is the gesture the work itself has; a settings list of six rows is faster,
 * and keyboard-operable for free, with "move earlier" and "move later" — §11's
 * accessibility baseline asks the whole product to be usable without a mouse,
 * and drag-and-drop is where that promise is usually quietly dropped.
 *
 * Deleting asks where the items go before it does anything (§4). Work items
 * land in slice 5; the choice is already here, already posted, and already
 * written to the audit row, so the confirmation is not something that has to be
 * retrofitted around a destructive action that already shipped.
 */

export type EditableState = {
  id: string;
  name: string;
  nameKey: string | null;
  group: StateGroup;
  color: StateColor;
};

export function StatesEditor({
  workspaceSlug,
  projectSlug,
  projectId,
  states,
  canEdit,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  states: EditableState[];
  canEdit: boolean;
}) {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        {states.map((state, index) => (
          <li key={state.id} className="p-3">
            <StateRow
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              projectId={projectId}
              state={state}
              siblings={states.filter((s) => s.id !== state.id)}
              isFirst={index === 0}
              isLast={index === states.length - 1}
              canEdit={canEdit}
              canDelete={canEdit && states.length > 1}
            />
          </li>
        ))}
      </ul>

      {canEdit && (
        <AddStateForm
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={projectId}
        />
      )}

      <p className="text-xs text-text-subtle">{t('states.groupHint')}</p>
    </div>
  );
}

function StateRow({
  workspaceSlug,
  projectSlug,
  projectId,
  state,
  siblings,
  isFirst,
  isLast,
  canEdit,
  canDelete,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  state: EditableState;
  siblings: EditableState[];
  isFirst: boolean;
  isLast: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [update, updateAction, updating] = useActionState<RowActionState, FormData>(
    updateStateAction,
    ROW_IDLE,
  );
  const [remove, removeAction, removing] = useActionState<RowActionState, FormData>(
    deleteStateAction,
    ROW_IDLE,
  );
  const [, moveAction, moving] = useActionState<RowActionState, FormData>(
    moveStateAction,
    ROW_IDLE,
  );
  const [confirming, setConfirming] = useState(false);

  const label = displayName(state, t);

  if (!canEdit) {
    return <StatePill name={label} color={state.color} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatePill name={label} color={state.color} className="min-w-32" />
        <span className="text-xs text-text-subtle">{t(`stateGroup.${state.group}`)}</span>

        <div className="ms-auto flex items-center gap-1">
          <form action={moveAction}>
            <HiddenContext
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              projectId={projectId}
              locale={locale}
            />
            <input type="hidden" name="stateId" value={state.id} />
            <input type="hidden" name="direction" value="up" />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isFirst || moving}
              aria-label={t('states.moveUp', { name: label })}
            >
              <ArrowUp aria-hidden className="size-4" />
            </Button>
          </form>

          <form action={moveAction}>
            <HiddenContext
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              projectId={projectId}
              locale={locale}
            />
            <input type="hidden" name="stateId" value={state.id} />
            <input type="hidden" name="direction" value="down" />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              disabled={isLast || moving}
              aria-label={t('states.moveDown', { name: label })}
            >
              <ArrowDown aria-hidden className="size-4" />
            </Button>
          </form>
        </div>
      </div>

      <form action={updateAction} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <HiddenContext
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          projectId={projectId}
          locale={locale}
        />
        <input type="hidden" name="stateId" value={state.id} />

        <InputField
          label={t('states.name')}
          name="name"
          defaultValue={label}
          required
          error={update.error && t(update.error)}
        />

        <SelectField label={t('states.group')} name="group" defaultValue={state.group}>
          {STATE_GROUPS.map((group) => (
            <option key={group} value={group}>
              {t(`stateGroup.${group}`)}
            </option>
          ))}
        </SelectField>

        <SelectField label={t('states.color')} name="color" defaultValue={state.color}>
          {STATE_COLORS.map((color) => (
            <option key={color} value={color}>
              {t(`stateColor.${color}`)}
            </option>
          ))}
        </SelectField>

        <Button type="submit" loading={updating}>
          {t('states.save')}
        </Button>
      </form>

      {canDelete && !confirming && (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          {t('states.delete')}
        </Button>
      )}

      {canDelete && confirming && (
        <form
          action={removeAction}
          // Grouped and labelled: the destructive choice and the question it
          // answers have to be one thing to a screen reader, not a stray select
          // followed by a button called "Delete".
          role="group"
          aria-label={t('states.deleteTitle', { name: label })}
          className="space-y-3 rounded-sm border border-danger bg-danger-subtle p-3"
        >
          <HiddenContext
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            projectId={projectId}
            locale={locale}
          />
          <input type="hidden" name="stateId" value={state.id} />

          <p className="text-sm">{t('states.deleteBody')}</p>

          <SelectField label={t('states.migrateTo')} name="migrateToStateId">
            {siblings.map((sibling) => (
              <option key={sibling.id} value={sibling.id}>
                {displayName(sibling, t)}
              </option>
            ))}
          </SelectField>

          {remove.error && <Alert tone="danger">{t(remove.error)}</Alert>}

          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={removing}>
              {t('states.delete')}
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

function AddStateForm({
  workspaceSlug,
  projectSlug,
  projectId,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<FormState, FormData>(addStateAction, IDLE);

  return (
    <form
      action={action}
      className="grid gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
    >
      <HiddenContext
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        projectId={projectId}
        locale={locale}
      />

      <InputField
        label={t('states.name')}
        name="name"
        required
        error={state.error && t(state.error)}
      />

      <SelectField label={t('states.group')} name="group" defaultValue="unstarted">
        {STATE_GROUPS.map((group) => (
          <option key={group} value={group}>
            {t(`stateGroup.${group}`)}
          </option>
        ))}
      </SelectField>

      <SelectField label={t('states.color')} name="color" defaultValue="ink">
        {STATE_COLORS.map((color) => (
          <option key={color} value={color}>
            {t(`stateColor.${color}`)}
          </option>
        ))}
      </SelectField>

      <Button type="submit" variant="primary" loading={pending}>
        {pending ? t('states.adding') : t('states.add')}
      </Button>
    </form>
  );
}

/**
 * The four values every action on this screen needs.
 *
 * They travel in the form rather than in a closure because a server action is a
 * public endpoint: what arrives is a request, never an authorization. The
 * server re-resolves the actor from the session and checks §10 again — these
 * only say *which* project is meant.
 */
function HiddenContext({
  workspaceSlug,
  projectSlug,
  projectId,
  locale,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  locale: string;
}) {
  return (
    <>
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );
}
