import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CUSTOM_FIELD_KINDS } from '@/lib/custom-fields';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { project } from './project';
import { workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * Custom fields (§6-4, §14 slice 10) — "the single most common reason a company
 * rejects a work tool", and the whole of §6's argument for building them in v1
 * rather than after it.
 *
 * §9 settles the storage question in one line: **"Real tables, not JSONB. Typed
 * indexed columns per value kind. A `custom:{fieldId}` filter is one branch in
 * the builder."** Everything below follows from that sentence.
 *
 * Three tables rather than the two §6 costed. The third is the option list, and
 * it exists because of §7.11's promise that renaming preserves values: a value
 * that stored the *word* "Acme" would be orphaned the moment somebody corrected
 * it to "Acme Ltd", so a value stores an option **id** and the word is resolved
 * at render — the same rule `activity.data` and a comment's mentions already
 * follow, for the same two reasons (§13 among them). Options as a `text[]` on
 * the definition would have been the second table exactly, and would have made
 * a rename a data migration.
 */

/**
 * §6-4's seven kinds, built from the constant in `src/lib/custom-fields.ts`.
 *
 * The same construction `priority`, `state_group` and `project_role` use: the
 * database enum and the product's list are one list, so a kind cannot be added
 * to one and forgotten in the other.
 */
export const customFieldKind = pgEnum('custom_field_kind', CUSTOM_FIELD_KINDS);

/**
 * One field a project has defined (§7.11: Settings → Project → Custom fields).
 *
 * Per project, not per workspace — §6-4 says so, and cross-project fields are
 * named as Phase 2. That is also the cheaper way round: a per-workspace field
 * would appear on every item in every project the day it was created, and the
 * agency of §2.1 does not track an invoice number on its own internal work.
 *
 * **A field's `kind` is fixed at creation.** Renaming is free (§7.11) and
 * reordering is free; changing a text field into a date is not a settings
 * change, it is a data migration over every value already stored, and the one
 * honest thing a settings screen can do about that is not offer it. The
 * composite key below is what makes the rule structural rather than a check
 * somebody has to remember: values carry the kind and reference it.
 */
export const customField = pgTable(
  'custom_field',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),

    /** What the label on the form says. User content — never translated (§13). */
    name: text('name').notNull(),
    kind: customFieldKind('kind').notNull(),

    /**
     * The order the fields appear in, on the item panel and in the filter bar.
     *
     * An integer rewritten as a block, like `workflow_state.position` and for
     * the identical reason: the fractional index in `src/lib/rank.ts` exists
     * because several people drag cards on one board at once, and a settings
     * list of six rows reordered by one Lead does not need it.
     */
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    /** Two fields called "Client" on one project is a form nobody can read. */
    unique('custom_field_project_name_key').on(t.projectId, t.name),
    /**
     * What a value's composite foreign key points at. Carrying `kind` in the
     * key is what pins a field's kind for life: a value row references
     * (id, workspace, kind), so changing the kind would orphan every value
     * rather than silently reinterpret it.
     */
    unique('custom_field_id_workspace_kind_key').on(t.id, t.workspaceId, t.kind),
    /** What an option's composite foreign key points at (§9's tenancy rule). */
    unique('custom_field_id_workspace_key').on(t.id, t.workspaceId),

    foreignKey({
      name: 'custom_field_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    index('custom_field_project_idx').on(t.projectId, t.position),

    ...tenantPolicies(),
  ],
);

/**
 * One choice on a select or multi-select field (§7.11: "options if select").
 *
 * Hard-deleted, like a workflow state and for the same reason: a soft-deleted
 * row would keep its name reserved by the unique below, so a company that
 * removed "In review" by mistake could never add it back. What makes that safe
 * is the trigger in migration 0018 — deleting an option strips its id out of
 * every value that held it, in the same statement, so no array is left pointing
 * at a row that is gone.
 */
export const customFieldOption = pgTable(
  'custom_field_option',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('custom_field_option_field_name_key').on(t.fieldId, t.name),
    foreignKey({
      name: 'custom_field_option_field_fk',
      columns: [t.fieldId, t.workspaceId],
      foreignColumns: [customField.id, customField.workspaceId],
    }).onDelete('cascade'),
    index('custom_field_option_field_idx').on(t.fieldId, t.position),
    ...tenantPolicies(),
  ],
);

/**
 * One item's value for one field — §9's "typed indexed columns per value kind".
 *
 * **A row exists only where there is a value.** Adding a field to a project
 * holding 5,000 items writes nothing; clearing a value deletes the row rather
 * than blanking it. That is what keeps every index here the size of the items
 * that actually use the field, and what makes "nobody has filled this in" a
 * `NOT EXISTS` probe instead of a scan for nulls.
 *
 * **`kind` is denormalized and held honest by the composite foreign key**, the
 * same device `workspace_id` uses throughout §9. It is here so that the CHECK
 * in migration 0018 can be a table constraint: exactly one value column is
 * populated, and it is the one the field's kind names. A row written by a seed
 * script, an importer or a Phase 2 MCP tool is then as correct as one written
 * by the service — which is the argument slice 5 made for putting `root_id`,
 * `depth` and the assignee arrays in the database rather than in TypeScript.
 */
export const customFieldValue = pgTable(
  'custom_field_value',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').notNull(),
    fieldId: uuid('field_id').notNull(),
    /** Mirrors `custom_field.kind`, and cannot disagree with it — see above. */
    kind: customFieldKind('kind').notNull(),

    valueText: text('value_text'),
    /**
     * `numeric`, not `double precision`. A custom number field is where an
     * invoice total or a quantity goes, and binary floating point is the wrong
     * shape for either. Read and written as a string so the precision survives
     * the round trip through JavaScript, which has no way to hold it.
     */
    valueNumber: numeric('value_number'),
    /**
     * A calendar date, read as a string, for the reason `work_item.due_date`
     * is: a timestamp would be re-interpreted in whatever zone the server or
     * the browser is in, and §17-13 makes the workspace timezone the only
     * authority on what day something is.
     */
    valueDate: date('value_date', { mode: 'string' }),
    /** Only ever `true`. An unticked box is the absence of the row (§ see lib). */
    valueCheckbox: boolean('value_checkbox'),
    /**
     * Select and multi-select alike, so both filter through one array
     * containment and one GIN index; the CHECK caps a single-select at one
     * element. No foreign key is possible from an array, which is why deleting
     * an option is a trigger rather than a cascade.
     */
    valueOptionIds: uuid('value_option_ids').array(),
    valueMemberId: uuid('value_member_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One value per field per item. The panel reads by this, and so does every filter. */
    unique('custom_field_value_item_field_key').on(t.workItemId, t.fieldId),

    foreignKey({
      name: 'custom_field_value_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    /**
     * Three columns, not two: the kind travels in the key, which is what makes
     * it impossible for a value to describe itself as a date while its field
     * says text. Deleting a field takes its values with it — §7.11 makes that
     * an explicit choice at the call site, and this is the second layer.
     */
    foreignKey({
      name: 'custom_field_value_field_fk',
      columns: [t.fieldId, t.workspaceId, t.kind],
      foreignColumns: [customField.id, customField.workspaceId, customField.kind],
    }).onDelete('cascade'),

    /**
     * `restrict`, like `work_item.created_by_member_id`: membership is
     * soft-deleted (§7.12 preserves what a departed member did), so this never
     * fires in practice — and if a membership were ever hard-deleted, refusing
     * is better than silently emptying a field somebody set.
     */
    foreignKey({
      name: 'custom_field_value_member_fk',
      columns: [t.valueMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    /**
     * One index per value kind, each keyed on the field first — §16's answer to
     * "custom fields slow the list query". Every filter branch in the builder is
     * `field_id = X and <this column> <op>`, which is exactly this shape.
     */
    index('custom_field_value_field_text_idx').on(t.fieldId, t.valueText),
    index('custom_field_value_field_number_idx').on(t.fieldId, t.valueNumber),
    index('custom_field_value_field_date_idx').on(t.fieldId, t.valueDate),
    index('custom_field_value_field_checkbox_idx').on(t.fieldId, t.valueCheckbox),
    index('custom_field_value_field_member_idx').on(t.fieldId, t.valueMemberId),
    /** What makes "is one of these options" an index lookup, like `label_ids`. */
    index('custom_field_value_options_idx').using('gin', t.valueOptionIds),
    /** The `set`/`none` probes, and the item panel's read of every value at once. */
    index('custom_field_value_field_idx').on(t.fieldId),

    ...tenantPolicies(),
  ],
);

/**
 * The empty array Postgres stores for a value that names no options.
 *
 * Exported so the service and the tests agree about it: `null` and `{}` are
 * different in an array column, and the CHECK requires the column to be null
 * for every kind that is not a select.
 */
export const NO_OPTIONS = sql`'{}'::uuid[]`;
