import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { customField, customFieldOption, workspaceMember } from '@/server/db/schema';
import { withActor, type ActorContext } from '@/server/db/tenant';
import {
  countOptionUses,
  countValuesByField,
  fetchCustomFields,
  fetchCustomValues,
  writeCustomValue,
  type CustomFieldDefinition,
  type CustomValueRow,
} from '@/server/queries/custom-fields';
import {
  MAX_FIELDS_PER_PROJECT,
  MAX_NAME_LENGTH,
  MAX_OPTIONS_PER_FIELD,
  graphemeLength,
  hasOptions,
  isCustomFieldKind,
  parseValue,
  sameValue,
  type CustomFieldKind,
  type ValueColumns,
  type ValueProblem,
} from '@/lib/custom-fields';
import {
  isArchived,
  loadProject,
  projectResource,
  type ProjectProblem,
  type ProjectRow,
} from './project-access';
import { guardForWrite, type WorkItemProblem } from './work-items';

/**
 * Custom fields (§6-4, §7.11, §14 slice 10).
 *
 * **Two permissions, and neither of them is new.** Defining a field is
 * `project.settings` — §10's row reads "Project settings, states, custom
 * fields", so the matrix already names this exact act and gives it to Owner,
 * Admin and a project Lead. *Filling one in* is `work_item.edit`, because a
 * value is a property of a work item in the same way a priority is: anybody who
 * may edit the item may say who the client is.
 *
 * That split is the same one labels make (§4: an Owner decides what tags exist,
 * anyone who can edit can apply one), and inventing a third row for either half
 * would put a rule in the code that the table a non-technical owner is shown
 * does not contain. This is the fourth time this slice-by-slice decision has
 * gone the same way, after labels, attachments and notifications.
 *
 * **A field's kind is fixed at creation.** §7.11 offers rename and nothing
 * else, and the reason is not laziness: turning a text field into a date is a
 * migration over every value already stored, with no answer for the ones that
 * do not convert. The schema makes the rule structural — a value references
 * `(field, workspace, kind)` — so this module does not have to enforce it.
 */

export type CustomFieldProblem =
  | ProjectProblem
  // A value is written through the work-item guard, so its refusals are this
  // module's refusals too — `not_found` and `archived` reach a caller here by
  // the same route they reach one in `work-items.ts`.
  | WorkItemProblem
  | ValueProblem
  | 'name_taken'
  | 'unknown_field'
  | 'unknown_kind'
  | 'unknown_option'
  | 'unknown_member'
  | 'too_many_fields'
  | 'too_many_options'
  | 'needs_options'
  /** §7.11: deleting a field that holds values is an explicit choice, never silent. */
  | 'field_has_values'
  | 'option_in_use';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: CustomFieldProblem; fieldId?: string };

/** A definition plus the number of items that have filled it in (§7.11's dialog). */
export type CustomFieldWithUsage = CustomFieldDefinition & { valueCount: number };

/** Spacing between positions, so the numbers are not consecutive by accident. */
const POSITION_STEP = 100;

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

export async function listCustomFields(
  context: ActorContext,
  projectId: string,
): Promise<CustomFieldDefinition[]> {
  return withActor(context, (tx) => fetchCustomFields(tx, projectId));
}

/**
 * The settings screen's read: every field, with how many values it holds.
 *
 * The counts are here rather than on `listCustomFields` because only this one
 * screen needs them, and every other caller — the filter bar, the item panel,
 * the list page — would be paying for an aggregate it never renders.
 */
export async function listCustomFieldsWithUsage(
  resolved: ResolvedActor,
  projectId: string,
): Promise<CustomFieldWithUsage[] | null> {
  return withActor(resolved.context, async (tx) => {
    const target = await loadProject(tx, projectId);
    if (!target) return null;
    // The screen this feeds is Owner/Admin/Lead only, and 404s for anyone else
    // — the same answer the rest of project settings gives, because a form full
    // of disabled controls reads as a fault rather than as a permission.
    if (!canEditSettings(resolved, target)) return null;

    const fields = await fetchCustomFields(tx, projectId);
    const counts = await countValuesByField(
      tx,
      fields.map((field) => field.id),
    );

    return fields.map((field) => ({ ...field, valueCount: counts.get(field.id) ?? 0 }));
  });
}

function canEditSettings(resolved: ResolvedActor, target: ProjectRow): boolean {
  try {
    assertCan(resolved.actor, 'project.settings', projectResource(target));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- */
/* Defining                                                                  */
/* ------------------------------------------------------------------------- */

export async function addCustomField(
  resolved: ResolvedActor,
  input: { projectId: string; name: string; kind: string },
): Promise<Ok<{ fieldId: string }> | Failed> {
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };
  if (graphemeLength(name) > MAX_NAME_LENGTH) return { ok: false, problem: 'value_too_long' };
  // Narrowed into a const rather than used through `input`: TypeScript drops
  // the narrowing of a property access inside the callback below, and a `kind`
  // that is still `string` there is the wrong thing to hand a pgEnum column.
  const kind = input.kind;
  if (!isCustomFieldKind(kind)) return { ok: false, problem: 'unknown_kind' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const target = await loadProject(tx, input.projectId);
      if (!target) return { ok: false, problem: 'not_found' } as const;
      if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
      assertCan(resolved.actor, 'project.settings', projectResource(target));

      const existing = await fetchCustomFields(tx, input.projectId);
      // A cap rather than an unbounded list: every filtered field is one EXISTS
      // in the list query, and a project with two hundred fields would be a
      // form nobody can read and a query nobody can explain.
      if (existing.length >= MAX_FIELDS_PER_PROJECT) {
        return { ok: false, problem: 'too_many_fields' } as const;
      }

      const fieldId = uuidv7();
      await tx.insert(customField).values({
        id: fieldId,
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        name,
        kind,
        // Appended, like a workflow state: guessing a position from the kind
        // would drop a new field into the middle of an order somebody set.
        position: (existing.at(-1)?.position ?? 0) + POSITION_STEP,
      });

      uow.emit({
        type: 'custom_field.created',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        fieldId,
        name,
        kind,
      });

      return { ok: true, fieldId } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Renaming, and only renaming (§7.11: "renaming → values preserved, no
 * migration").
 *
 * Preserved for free rather than by effort: a value references the field by id
 * and an option by id, so there is nothing here to migrate. That is the whole
 * reason the option list is a table rather than a `text[]`.
 */
export async function renameCustomField(
  resolved: ResolvedActor,
  input: { projectId: string; fieldId: string; name: string },
): Promise<Ok | Failed> {
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };
  if (graphemeLength(name) > MAX_NAME_LENGTH) return { ok: false, problem: 'value_too_long' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const guard = await guardSettings(tx, resolved, input.projectId);
      if (!guard.ok) return guard;

      const current = (await fetchCustomFields(tx, input.projectId)).find(
        (field) => field.id === input.fieldId,
      );
      if (!current) return { ok: false, problem: 'unknown_field' } as const;
      if (current.name === name) return { ok: true } as const;

      await tx
        .update(customField)
        .set({ name, updatedAt: new Date() })
        .where(eq(customField.id, input.fieldId));

      uow.emit({
        type: 'custom_field.updated',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        fieldId: input.fieldId,
        name,
        previousName: current.name,
        optionId: null,
      });

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Reorders the whole list in one transaction.
 *
 * The caller sends the complete order rather than "move this one to index 3",
 * for the reason `reorderWorkflowStates` gives: an index is meaningless against
 * a list somebody else has already changed, while a full order is at worst
 * stale in a way the next load corrects.
 */
export async function reorderCustomFields(
  resolved: ResolvedActor,
  input: { projectId: string; order: readonly string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardSettings(tx, resolved, input.projectId);
    if (!guard.ok) return guard;

    const existing = await fetchCustomFields(tx, input.projectId);
    const known = new Set(existing.map((field) => field.id));
    const unique = new Set(input.order);

    // Every id, exactly once. A partial order silently leaves the fields it
    // omits where they were, which reads to the person who moved one as "the
    // change did not save".
    if (unique.size !== input.order.length) return { ok: false, problem: 'unknown_field' } as const;
    if (unique.size !== known.size) return { ok: false, problem: 'unknown_field' } as const;
    if (input.order.some((id) => !known.has(id))) {
      return { ok: false, problem: 'unknown_field' } as const;
    }

    for (const [index, fieldId] of input.order.entries()) {
      await tx
        .update(customField)
        .set({ position: index * POSITION_STEP, updatedAt: new Date() })
        .where(eq(customField.id, fieldId));
    }

    uow.emit({
      type: 'custom_field.reordered',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      order: [...input.order],
    });

    return { ok: true } as const;
  });
}

/**
 * Deletes a field and everything stored in it (§7.11).
 *
 * "`[!]` deleting a field with values → choose: delete values, or export first.
 * Explicit, never silent." The choice is `confirmed`, and it is refused without
 * it whenever the field holds anything — so the screen has to have shown the
 * count and been clicked through. Exporting first is the *other* branch of that
 * sentence and belongs to CSV export, a §4 should-have; until it exists the
 * refusal is the honest half, and it names the number rather than a warning.
 *
 * A hard delete, like a workflow state and for the same reason: a soft-deleted
 * row would keep its name reserved by `custom_field_project_name_key`, so a
 * company that removed "Client" by mistake could never add it back. The values
 * go with it through the composite foreign key's cascade.
 */
export async function deleteCustomField(
  resolved: ResolvedActor,
  input: { projectId: string; fieldId: string; confirmed?: boolean },
): Promise<Ok<{ valuesDeleted: number }> | (Failed & { count?: number })> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardSettings(tx, resolved, input.projectId);
    if (!guard.ok) return guard;

    const current = (await fetchCustomFields(tx, input.projectId)).find(
      (field) => field.id === input.fieldId,
    );
    if (!current) return { ok: false, problem: 'unknown_field' } as const;

    const counts = await countValuesByField(tx, [input.fieldId]);
    const valuesDeleted = counts.get(input.fieldId) ?? 0;

    if (valuesDeleted > 0 && input.confirmed !== true) {
      // The count travels with the refusal so the screen can say how much is at
      // stake without asking a second question to find out.
      return { ok: false, problem: 'field_has_values', count: valuesDeleted } as const;
    }

    await tx.delete(customField).where(eq(customField.id, input.fieldId));

    uow.emit({
      type: 'custom_field.deleted',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      fieldId: input.fieldId,
      name: current.name,
      kind: current.kind,
      valuesDeleted,
    });

    return { ok: true, valuesDeleted } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Options                                                                   */
/* ------------------------------------------------------------------------- */

export async function addCustomFieldOption(
  resolved: ResolvedActor,
  input: { projectId: string; fieldId: string; name: string },
): Promise<Ok<{ optionId: string }> | Failed> {
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };
  if (graphemeLength(name) > MAX_NAME_LENGTH) return { ok: false, problem: 'value_too_long' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const guard = await guardSettings(tx, resolved, input.projectId);
      if (!guard.ok) return guard;

      const current = (await fetchCustomFields(tx, input.projectId)).find(
        (field) => field.id === input.fieldId,
      );
      if (!current) return { ok: false, problem: 'unknown_field' } as const;
      // A text field with a list of choices is a select somebody has not
      // finished configuring, and storing options against one would make the
      // panel draw a control the value column cannot hold.
      if (!hasOptions(current.kind)) return { ok: false, problem: 'unknown_kind' } as const;
      if (current.options.length >= MAX_OPTIONS_PER_FIELD) {
        return { ok: false, problem: 'too_many_options' } as const;
      }

      const optionId = uuidv7();
      await tx.insert(customFieldOption).values({
        id: optionId,
        workspaceId: resolved.workspace.id,
        fieldId: input.fieldId,
        name,
        position: (current.options.at(-1)?.position ?? 0) + POSITION_STEP,
      });

      uow.emit({
        type: 'custom_field.updated',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        fieldId: input.fieldId,
        name,
        previousName: null,
        optionId,
      });

      return { ok: true, optionId } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/** Renaming an option. Every value naming it is untouched — that is the point of the id. */
export async function renameCustomFieldOption(
  resolved: ResolvedActor,
  input: { projectId: string; fieldId: string; optionId: string; name: string },
): Promise<Ok | Failed> {
  const name = input.name.trim().normalize('NFC');
  if (!name) return { ok: false, problem: 'name_required' };
  if (graphemeLength(name) > MAX_NAME_LENGTH) return { ok: false, problem: 'value_too_long' };

  try {
    return await withActor(resolved.context, async (tx, uow) => {
      const guard = await guardSettings(tx, resolved, input.projectId);
      if (!guard.ok) return guard;

      const current = (await fetchCustomFields(tx, input.projectId)).find(
        (field) => field.id === input.fieldId,
      );
      if (!current) return { ok: false, problem: 'unknown_field' } as const;

      const option = current.options.find((candidate) => candidate.id === input.optionId);
      if (!option) return { ok: false, problem: 'unknown_option' } as const;
      if (option.name === name) return { ok: true } as const;

      await tx
        .update(customFieldOption)
        .set({ name, updatedAt: new Date() })
        .where(eq(customFieldOption.id, input.optionId));

      uow.emit({
        type: 'custom_field.updated',
        workspaceId: resolved.workspace.id,
        projectId: input.projectId,
        fieldId: input.fieldId,
        name,
        previousName: option.name,
        optionId: input.optionId,
      });

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Removes one choice, and clears it off every item that held it.
 *
 * The clearing is a trigger (migration 0018), not a statement here, for the
 * reason slice 5 put `root_id` and the assignee arrays in the database: a row
 * written by a seed script, an importer or a Phase 2 MCP tool has to leave the
 * data as correct as one written by this function. What this function owns is
 * the *decision* — the count, the confirmation and the audit row.
 */
export async function removeCustomFieldOption(
  resolved: ResolvedActor,
  input: { projectId: string; fieldId: string; optionId: string; confirmed?: boolean },
): Promise<Ok<{ clearedFrom: number }> | (Failed & { count?: number })> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardSettings(tx, resolved, input.projectId);
    if (!guard.ok) return guard;

    const current = (await fetchCustomFields(tx, input.projectId)).find(
      (field) => field.id === input.fieldId,
    );
    if (!current) return { ok: false, problem: 'unknown_field' } as const;

    const option = current.options.find((candidate) => candidate.id === input.optionId);
    if (!option) return { ok: false, problem: 'unknown_option' } as const;

    const clearedFrom = await countOptionUses(tx, input.optionId);
    if (clearedFrom > 0 && input.confirmed !== true) {
      return { ok: false, problem: 'option_in_use', count: clearedFrom } as const;
    }

    await tx.delete(customFieldOption).where(eq(customFieldOption.id, input.optionId));

    uow.emit({
      type: 'custom_field.option_removed',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      fieldId: input.fieldId,
      optionId: input.optionId,
      name: option.name,
      clearedFrom,
    });

    return { ok: true, clearedFrom } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Values                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * What one item's panel posts: every field it drew, whether or not it changed.
 *
 * A whole-panel save rather than one call per field, for the reason the item
 * editor saves title, dates and priority together: they are one thought and one
 * click. A field the form did not include is left alone — which is what makes
 * this safe to call from a screen that only knows about some of the fields.
 */
export type CustomValueInput = Readonly<Record<string, string | readonly string[] | null>>;

export async function setWorkItemCustomFields(
  resolved: ResolvedActor,
  input: { workItemId: string; values: CustomValueInput },
): Promise<Ok<{ changed: string[] }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const guard = await guardForWrite(tx, resolved, input.workItemId);
    if ('ok' in guard) return guard;

    const fields = await fetchCustomFields(tx, guard.item.projectId);
    const existing = await fetchCustomValues(tx, input.workItemId);

    const prepared = await prepareValues(tx, fields, existing, input.values);
    if (!prepared.ok) return prepared;

    for (const change of prepared.changes) {
      await writeCustomValue(tx, {
        workspaceId: resolved.workspace.id,
        workItemId: input.workItemId,
        fieldId: change.fieldId,
        kind: change.kind,
        id: uuidv7(),
        value: change.value,
      });
    }

    // Nothing moved, nothing happened. A save that changed no value must not
    // put a line in the feed or a notification in anybody's inbox — a panel
    // people open to read and close again would otherwise be a source of noise.
    if (prepared.changes.length === 0) return { ok: true, changed: [] } as const;

    uow.emit({
      type: 'work_item.custom_field_changed',
      workspaceId: resolved.workspace.id,
      projectId: guard.item.projectId,
      workItemId: input.workItemId,
      fieldIds: prepared.changes.map((change) => change.fieldId),
      assigneeIds: guard.item.assigneeIds,
    });

    return { ok: true, changed: prepared.changes.map((change) => change.fieldId) } as const;
  });
}

type PreparedChange = { fieldId: string; kind: CustomFieldKind; value: ValueColumns | null };

/**
 * Validates a whole panel against the project's definitions, and returns only
 * what actually changed.
 *
 * Validation is `parseValue` from `src/lib` — the same function the form ran as
 * the value was typed — so a value the UI accepted is a value this accepts, and
 * one it refused is refused here with the identifier the same message renders.
 */
async function prepareValues(
  tx: TenantDb,
  fields: readonly CustomFieldDefinition[],
  existing: ReadonlyMap<string, CustomValueRow>,
  values: CustomValueInput,
): Promise<{ ok: true; changes: PreparedChange[] } | Failed> {
  const changes: PreparedChange[] = [];
  const memberIds: string[] = [];

  for (const field of fields) {
    if (!(field.id in values)) continue;

    const parsed = parseValue(field.kind, values[field.id], {
      optionIds: field.options.map((option) => option.id),
    });
    // The refusal names the field, so §11's rule holds — the error lands on the
    // control that caused it rather than in a toast about the whole form.
    if (!parsed.ok) return { ok: false, problem: parsed.problem, fieldId: field.id };

    const before = existing.get(field.id) ?? null;
    const previous: ValueColumns | null = before
      ? {
          text: before.text,
          number: before.number,
          date: before.date,
          checkbox: before.checkbox,
          optionIds: before.optionIds,
          memberId: before.memberId,
        }
      : null;

    if (sameValue(previous, parsed.value)) continue;
    if (parsed.value?.memberId) memberIds.push(parsed.value.memberId);

    changes.push({ fieldId: field.id, kind: field.kind, value: parsed.value });
  }

  if (memberIds.length > 0) {
    // The composite foreign key already refuses a member from another
    // workspace, so this is not the tenancy boundary — it turns a constraint
    // violation into a problem identifier a screen can translate (§13), exactly
    // as `writeAssignees` does.
    const found = await tx
      .select({ id: workspaceMember.id })
      .from(workspaceMember)
      .where(and(inArray(workspaceMember.id, memberIds), isNull(workspaceMember.deletedAt)));

    if (found.length !== new Set(memberIds).size) {
      return { ok: false, problem: 'unknown_member' };
    }
  }

  return { ok: true, changes };
}

/* ------------------------------------------------------------------------- */
/* Shared guard                                                              */
/* ------------------------------------------------------------------------- */

/**
 * The three refusals every definition change asks, in the order they have to be
 * asked: does the project exist, is it archived, and may this person configure
 * it.
 *
 * `{ ok: true }` on success so a caller can test it the same way it tests every
 * other result in this module.
 */
async function guardSettings(
  tx: TenantDb,
  resolved: ResolvedActor,
  projectId: string,
): Promise<{ ok: true } | Failed> {
  const target = await loadProject(tx, projectId);
  if (!target) return { ok: false, problem: 'not_found' };
  if (isArchived(target)) return { ok: false, problem: 'archived' };
  assertCan(resolved.actor, 'project.settings', projectResource(target));
  return { ok: true };
}
