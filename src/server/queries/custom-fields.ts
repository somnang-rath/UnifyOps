import 'server-only';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { customField, customFieldOption, customFieldValue } from '@/server/db/schema';
import type { CustomFieldKind, ValueColumns } from '@/lib/custom-fields';

/**
 * Reading custom-field definitions and values (§6-4, slice 10).
 *
 * Split from the service for the reason `queries/work-items.ts` is: this module
 * emits SQL and answers questions, the service applies §10 and §4 and writes.
 * Every function here takes a `TenantDb`, so it can only ever be called inside
 * a `withActor` transaction — which is what makes "another company's fields"
 * unreachable rather than merely un-asked-for.
 */

export type CustomFieldOptionRow = {
  id: string;
  name: string;
  position: number;
};

export type CustomFieldDefinition = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  position: number;
  /** Empty for every kind but select and multi-select. */
  options: CustomFieldOptionRow[];
};

/** One item's value for one field, in the shape the form and the panel use. */
export type CustomValueRow = ValueColumns & {
  fieldId: string;
  kind: CustomFieldKind;
};

/**
 * A project's fields, in display order, each with its options.
 *
 * Two queries rather than a join, and the reason is the same one that keeps the
 * list query un-joined: a field with eight options would otherwise arrive as
 * eight rows to be folded back together, and the folding is cheaper done once
 * over two small results than parsed out of a fan-out.
 */
export async function fetchCustomFields(
  tx: TenantDb,
  projectId: string,
): Promise<CustomFieldDefinition[]> {
  const fields = await tx
    .select({
      id: customField.id,
      name: customField.name,
      kind: customField.kind,
      position: customField.position,
    })
    .from(customField)
    .where(and(eq(customField.projectId, projectId), isNull(customField.deletedAt)))
    // Position, then id: two fields that ended up at the same position — a
    // partial reorder, or two adds racing — must still come back in a stable
    // order, or the panel reshuffles itself between two identical requests.
    .orderBy(asc(customField.position), asc(customField.id));

  if (fields.length === 0) return [];

  const options = await tx
    .select({
      id: customFieldOption.id,
      fieldId: customFieldOption.fieldId,
      name: customFieldOption.name,
      position: customFieldOption.position,
    })
    .from(customFieldOption)
    .where(
      and(
        inArray(
          customFieldOption.fieldId,
          fields.map((field) => field.id),
        ),
        isNull(customFieldOption.deletedAt),
      ),
    )
    .orderBy(asc(customFieldOption.position), asc(customFieldOption.id));

  const byField = new Map<string, CustomFieldOptionRow[]>();
  for (const option of options) {
    const list = byField.get(option.fieldId) ?? [];
    list.push({ id: option.id, name: option.name, position: option.position });
    byField.set(option.fieldId, list);
  }

  return fields.map((field) => ({ ...field, options: byField.get(field.id) ?? [] }));
}

/** The kinds alone, which is all the query builder needs to emit its branch. */
export function kindsOf(fields: readonly CustomFieldDefinition[]): Map<string, CustomFieldKind> {
  return new Map(fields.map((field) => [field.id, field.kind]));
}

/**
 * Every value on one item, by field id.
 *
 * A map rather than a list because every caller is asking the same question —
 * "what is this item's value for that field" — while rendering a form built
 * from the definitions, not from the values: a field nobody has filled in still
 * has to draw an empty control.
 */
export async function fetchCustomValues(
  tx: TenantDb,
  workItemId: string,
): Promise<Map<string, CustomValueRow>> {
  const rows = await tx
    .select({
      fieldId: customFieldValue.fieldId,
      kind: customFieldValue.kind,
      text: customFieldValue.valueText,
      number: customFieldValue.valueNumber,
      date: customFieldValue.valueDate,
      checkbox: customFieldValue.valueCheckbox,
      optionIds: customFieldValue.valueOptionIds,
      memberId: customFieldValue.valueMemberId,
    })
    .from(customFieldValue)
    .where(eq(customFieldValue.workItemId, workItemId));

  return new Map(rows.map((row) => [row.fieldId, row]));
}

/**
 * The values of many items at once, for the Table view's custom columns (§14
 * slice 12, and the last word of slice 10's outcome line).
 *
 * One query for the whole page rather than `fetchCustomValues` per row, which
 * would be fifty round trips to draw one screen — the N+1 that a table of
 * custom fields is the obvious place to write by accident.
 *
 * Keyed by item and then by field, because that is the order the renderer asks
 * in: it walks rows, and within a row it walks the columns it was told to draw.
 * An item with no values at all is simply absent from the outer map, which the
 * caller reads as "nothing filled in" — the same meaning the absence of a row
 * has in the table itself (§9's "a row exists only where there is a value").
 */
export async function fetchCustomValuesForItems(
  tx: TenantDb,
  workItemIds: readonly string[],
): Promise<Map<string, Map<string, CustomValueRow>>> {
  const byItem = new Map<string, Map<string, CustomValueRow>>();
  if (workItemIds.length === 0) return byItem;

  const rows = await tx
    .select({
      workItemId: customFieldValue.workItemId,
      fieldId: customFieldValue.fieldId,
      kind: customFieldValue.kind,
      text: customFieldValue.valueText,
      number: customFieldValue.valueNumber,
      date: customFieldValue.valueDate,
      checkbox: customFieldValue.valueCheckbox,
      optionIds: customFieldValue.valueOptionIds,
      memberId: customFieldValue.valueMemberId,
    })
    .from(customFieldValue)
    .where(inArray(customFieldValue.workItemId, [...workItemIds]));

  for (const { workItemId, ...value } of rows) {
    const existing = byItem.get(workItemId) ?? new Map<string, CustomValueRow>();
    existing.set(value.fieldId, value);
    byItem.set(workItemId, existing);
  }

  return byItem;
}

/**
 * How many items hold a value for this field — the number §7.11's confirmation
 * has to show before it destroys them.
 *
 * "Deleting a field with values → choose: delete values, or export first.
 * Explicit, never silent." A dialog that says "this will delete values" without
 * saying how many is not the explicit choice that sentence asks for.
 */
export async function countFieldValues(tx: TenantDb, fieldId: string): Promise<number> {
  const rows = await tx.execute<{ total: number }>(sql`
    select count(*)::int as total from custom_field_value where field_id = ${fieldId}::uuid
  `);
  return rows.rows[0]?.total ?? 0;
}

/** How many items name this option, for the same reason and the same dialog. */
export async function countOptionUses(tx: TenantDb, optionId: string): Promise<number> {
  const rows = await tx.execute<{ total: number }>(sql`
    select count(*)::int as total
    from custom_field_value
    where ${optionId}::uuid = any(value_option_ids)
  `);
  return rows.rows[0]?.total ?? 0;
}

/**
 * How many values each of a project's fields holds, in one query.
 *
 * For the settings screen, which has to be able to say "delete this field and
 * the 43 values in it" *before* anybody clicks — a confirmation that discovers
 * the number only after the click is not the explicit choice §7.11 asks for.
 * One grouped aggregate rather than one count per field, because a project with
 * thirty fields would otherwise be thirty round trips to draw one page.
 */
export async function countValuesByField(
  tx: TenantDb,
  fieldIds: readonly string[],
): Promise<Map<string, number>> {
  if (fieldIds.length === 0) return new Map();

  const rows = await tx.execute<{ field_id: string; total: number }>(sql`
    select field_id, count(*)::int as total
    from custom_field_value
    where field_id = any(${sql.param([...fieldIds])}::uuid[])
    group by 1
  `);

  return new Map(rows.rows.map((row) => [row.field_id, row.total]));
}

/* ------------------------------------------------------------------------- */
/* Writing one value                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Writes or clears one item's value for one field.
 *
 * Here rather than in a service because two services need it — the item panel
 * saves values, and `createWorkItem` accepts them with the item — and a shared
 * helper in either one would put an import cycle between them. It applies no
 * policy and asks no questions: both callers have already established that this
 * actor may edit this item, which is the only permission a value obeys (§10 has
 * no custom-field row, and none was invented — see the service).
 *
 * **Clearing deletes the row.** `custom_field_value` holds values, not
 * placeholders: see `src/lib/custom-fields.ts` for why absence is the absence
 * of a row rather than a row full of nulls.
 */
export async function writeCustomValue(
  tx: TenantDb,
  input: {
    workspaceId: string;
    workItemId: string;
    fieldId: string;
    kind: CustomFieldKind;
    id: string;
    value: ValueColumns | null;
  },
): Promise<void> {
  if (input.value === null) {
    await tx
      .delete(customFieldValue)
      .where(
        and(
          eq(customFieldValue.workItemId, input.workItemId),
          eq(customFieldValue.fieldId, input.fieldId),
        ),
      );
    return;
  }

  const { value } = input;

  await tx
    .insert(customFieldValue)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      workItemId: input.workItemId,
      fieldId: input.fieldId,
      kind: input.kind,
      valueText: value.text,
      valueNumber: value.number,
      valueDate: value.date,
      valueCheckbox: value.checkbox,
      valueOptionIds: value.optionIds,
      valueMemberId: value.memberId,
    })
    // Upsert on the (item, field) unique rather than read-then-write: two
    // saves of the same panel racing would otherwise both see no row and both
    // insert, and one of them would fail on the constraint after the other had
    // already committed a different value.
    .onConflictDoUpdate({
      target: [customFieldValue.workItemId, customFieldValue.fieldId],
      set: {
        kind: input.kind,
        valueText: value.text,
        valueNumber: value.number,
        valueDate: value.date,
        valueCheckbox: value.checkbox,
        valueOptionIds: value.optionIds,
        valueMemberId: value.memberId,
        updatedAt: new Date(),
      },
    });
}
