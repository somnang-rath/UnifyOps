import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { LABEL_COLORS } from '@/lib/label-colors';
import { PRIORITIES } from '@/lib/priorities';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { cycle } from './cycle';
import { project, workflowState } from './project';
import { workspace, workspaceMember } from './workspace';

/**
 * Work items (§14, slice 5) — the thing the whole product is about.
 *
 * Three shapes here exist for the §9 list query rather than for the data model,
 * and each one is a trade the plan already made:
 *
 *   * `assignee_ids` and `label_ids` are **denormalized arrays with GIN
 *     indexes**, so "assigned to me" and "labelled client" are index lookups
 *     rather than a join fan-out that multiplies rows before the page limit is
 *     applied. The join tables below stay the source of truth; the arrays are
 *     maintained by trigger (migration 0008), never by application code, so
 *     they cannot drift when a row is written outside the service.
 *
 *   * `rank` is here even though nothing drags a card until slice 6. Adding a
 *     NOT NULL ordering column to a table that already holds a workspace's work
 *     is a backfill under a lock; adding it now costs one column.
 *
 *   * `completed_at` is here for the same reason and a stronger one: slice 11's
 *     burndown is arithmetic over when work finished, and that is the one thing
 *     a later migration cannot backfill. History not recorded is history gone.
 */

/** §4/§12. A closed enum, mapped to messages in code — never a key in a row (§13). */
export const priority = pgEnum('priority', PRIORITIES);

/** §12. The closed set a label may be coloured — token names, never hex. */
export const labelColor = pgEnum('label_color', LABEL_COLORS);

/**
 * A label: workspace vocabulary, not project vocabulary (§9's hierarchy puts it
 * beside Team and SavedView, under Workspace).
 *
 * Workspace-scoped on purpose. A company's "client" means the same thing in
 * every project, and per-project labels would make the manager loop of §7.4 —
 * one view across a team's projects — filter by a set of near-duplicate ids.
 */
export const label = pgTable(
  'label',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: labelColor('color').notNull(),
    ...timestamps,
  },
  (t) => [
    /** The target `work_item_label`'s composite foreign key needs (§9). */
    unique('label_id_workspace_key').on(t.id, t.workspaceId),
    unique('label_workspace_name_key').on(t.workspaceId, t.name),
    ...tenantPolicies(),
  ],
);

/**
 * One row per project, holding the last human identifier it issued (§9).
 *
 * `ENG-142` is gapless, and gapless means serializing on this row: the
 * allocation is an `UPDATE … RETURNING`, which takes a row lock held to the end
 * of the transaction. §17-11 is explicit that this *is* contention and that the
 * trade is right — it is scoped to one project's counter, never workspace-wide,
 * so two projects never wait on each other.
 *
 * A separate table rather than a column on `project` because the lock would
 * otherwise be taken on the project row itself, and every concurrent item
 * creation would then block a rename or a visibility change.
 */
export const projectCounter = pgTable(
  'project_counter',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    /** The number most recently issued. The first item in a project is 1. */
    lastNumber: integer('last_number').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('project_counter_project_key').on(t.projectId),
    foreignKey({
      name: 'project_counter_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),
    ...tenantPolicies(),
  ],
);

export const workItem = pgTable(
  'work_item',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),

    /**
     * The `142` of `ENG-142`, allocated from `project_counter` last in the
     * transaction. Never reused, even after a delete (§4).
     */
    number: integer('number').notNull(),

    title: text('title').notNull(),
    /**
     * §4 calls this a rich description. It holds text for now, and the editor
     * is slice 8's decision — made once, for this field and comments together,
     * rather than twice.
     */
    description: text('description'),

    stateId: uuid('state_id').notNull(),
    priority: priority('priority').notNull().default('none'),

    /**
     * Sub-items, depth ≤ 3 (§4) — an adjacency list with a trigger-maintained
     * `root_id` and `depth` (§9). "All descendants of this item" is then one
     * indexed lookup on `root_id`, without a closure table's write
     * amplification.
     *
     * `depth` is zero-based, so the cap the trigger enforces is 2. A root item
     * is its own root, which is what lets the descendants query be a single
     * equality rather than an equality or-ed with an is-null.
     */
    parentId: uuid('parent_id'),
    rootId: uuid('root_id').notNull(),
    depth: integer('depth').notNull().default(0),

    /**
     * The fractional index a board orders by (§9). Written at insert; slice 6
     * adds the reorder path that computes one from neighbour ids under
     * `FOR UPDATE`. A string, not a number, because the whole point is that a
     * key always exists between any two others without renumbering.
     */
    rank: text('rank').notNull(),

    /**
     * Calendar dates, stored as dates and read as strings.
     *
     * Not a timestamp, and the mode is not an accident: §4 says a due date
     * counts calendar days because a human deliberately picked that date, and
     * "overdue" is evaluated in the **workspace** timezone. A `Date` here would
     * be re-interpreted in whatever zone the server or the browser happens to
     * be in, and the item would be late for the employee and on time for their
     * manager — the one number §17-13 says must not become an argument.
     */
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),

    /** Points, hidden by default (§17-9). Hours would claim a precision v1 cannot back. */
    estimate: integer('estimate'),

    /**
     * The cycle this item is planned into, or null for the backlog (§7.6, slice 11).
     *
     * A column rather than a join table because an item is in **at most one**
     * cycle: §7.6 makes membership "per item, never inherited", and a join
     * table would permit two — after which the burndown counts one item twice
     * and nothing in the schema says it should not.
     *
     * Nullable, and null is the backlog rather than a missing value. That is
     * also what makes adding a cycle to a project holding 5,000 items cost
     * nothing: no backfill, because every item that predates the cycle is
     * already correctly not in it.
     */
    cycleId: uuid('cycle_id'),

    /**
     * §4: blocked is a flag, not a state. An item can be *In Progress and
     * blocked* — making it a state would lose where the work actually was, and
     * force a fake transition to unblock it.
     */
    blocked: boolean('blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),

    /**
     * Set when the item enters a `completed` or `cancelled` state group, and
     * cleared when it leaves one. Derived from the group, never from a state's
     * name (§4) — a company that renames "Done" to "Shipped" has not changed
     * what completion means.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /**
     * Trigger-maintained mirrors of the two join tables below, indexed GIN
     * (§9). Application code never writes them; the trigger in 0008 does, so a
     * row inserted by a seed script is as correct as one written by the
     * service.
     */
    assigneeIds: uuid('assignee_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    labelIds: uuid('label_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    /** The member who created it. Membership is soft-deleted, so this stays valid. */
    createdByMemberId: uuid('created_by_member_id').notNull(),

    /**
     * The one text §7.9 searches, materialised — title and description, folded,
     * with the zero-width characters removed (§13, slice 14).
     *
     * **One column, two indexes, and that is the whole reason it is a column at
     * all.** §9 routes Latin through `tsvector('simple')` and Khmer through
     * `pg_trgm`; if each route read a different source the two languages would be
     * searching different text, and the first bug report would be a Khmer
     * description that could not be found. Generated once and indexed twice —
     * a GIN index over `to_tsvector('simple', search_text)` and a
     * `gin_trgm_ops` index over the column itself (migration 0026) — the two
     * routes are two *questions about the same string*.
     *
     * Generated rather than trigger-maintained, unlike `assignee_ids` beside it,
     * because unlike those it is a pure function of columns on this same row.
     * Postgres will not let it drift, there is nothing to backfill after a
     * direct `UPDATE`, and no seed script or Phase 2 MCP tool can write a row
     * that is unsearchable — which is the same argument that put `root_id` and
     * the value CHECK in the database rather than in a service.
     *
     * `lower()` here rather than `ILIKE` at query time: a `gin_trgm_ops` index
     * on the raw column cannot serve `ILIKE`, and folding 50,000 descriptions
     * per keystroke is the §16 failure this slice exists to avoid.
     *
     * The zero-width strip is §13's rule ("preserved in stored text, stripped
     * before indexing") and is the exact transformation `normalizeQuery` in
     * `src/lib/search.ts` applies to the query. The two have to agree; they are
     * written down in those two places and nowhere else.
     *
     * The cost is honest and worth stating: it duplicates every description in
     * the table. The alternative — two expression indexes over
     * `lower(replace(title || description))` — pays that same expression twice
     * per write and cannot be read by a `LIKE` that wants the column itself.
     */
    searchText: text('search_text').generatedAlwaysAs(
      // `translate` with an empty replacement deletes every listed character,
      // which is the whole of `ZERO_WIDTH` in `src/lib/search.ts` — ZWSP, ZWNJ,
      // ZWJ and the byte-order mark that leads a pasted cell from a spreadsheet.
      // It is IMMUTABLE, which a generated column requires and a `regexp_replace`
      // with a locale-sensitive class would put in doubt.
      //
      // `btrim` after the strip, rather than the `concat_ws` that would be the
      // natural way to join two possibly-null columns: `concat_ws` is STABLE and
      // a generated column will not take it. Trimming earns its place because
      // most items have no description, and without it every one of those rows
      // would carry a trailing space nothing needs and every row stores.
      sql`btrim(lower(translate(coalesce(title, '') || ' ' || coalesce(description, ''), U&'\\200B\\200C\\200D\\FEFF', '')))`,
    ),

    ...timestamps,
  },
  (t) => [
    unique('work_item_project_number_key').on(t.projectId, t.number),
    /** The target the sub-item and join-table composite keys need (§9). */
    unique('work_item_id_workspace_key').on(t.id, t.workspaceId),

    foreignKey({
      name: 'work_item_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    /**
     * `restrict`, deliberately. §4 makes deleting a state that holds items a
     * decision with a confirmation dialog and a migration target; a cascade
     * here would answer that question by destroying the work.
     */
    foreignKey({
      name: 'work_item_state_fk',
      columns: [t.stateId, t.workspaceId],
      foreignColumns: [workflowState.id, workflowState.workspaceId],
    }).onDelete('restrict'),

    foreignKey({
      name: 'work_item_parent_fk',
      columns: [t.parentId, t.workspaceId],
      foreignColumns: [t.id, t.workspaceId],
    }).onDelete('cascade'),

    /**
     * Cycle membership (§7.6, slice 11).
     *
     * **Three columns, not two.** Carrying `project_id` is what makes it
     * impossible for an item in Engineering to be planned into Marketing's
     * sprint — the tenant check alone would allow it, because both projects sit
     * in one workspace. §9's composite-key device pushed one level down the
     * hierarchy, and the reason `cycle` carries a matching three-column unique.
     *
     * `restrict`, deliberately, and the same argument `work_item_state_fk`
     * makes: deleting a cycle that still holds work is a decision about that
     * work, not a cascade. `deleteCycle` releases every item to the backlog
     * first and this is the second layer — which also sidesteps a real trap,
     * since `ON DELETE SET NULL` on a composite key nulls *every* column in it
     * and would take `project_id` and `workspace_id` with it.
     */
    foreignKey({
      name: 'work_item_cycle_fk',
      columns: [t.cycleId, t.projectId, t.workspaceId],
      foreignColumns: [cycle.id, cycle.projectId, cycle.workspaceId],
    }).onDelete('restrict'),

    foreignKey({
      name: 'work_item_creator_fk',
      columns: [t.createdByMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    /**
     * The index the §9 page query rides. Project, then state, then rank is the
     * order the `LATERAL` per-group page walks — one column of a board is a
     * range scan on this index, and the `limit` stops it.
     */
    index('work_item_project_state_rank_idx').on(t.projectId, t.stateId, t.rank),
    /** The list view's other default sorts, and Needs Attention's date scan. */
    index('work_item_project_updated_idx').on(t.projectId, t.updatedAt),
    index('work_item_workspace_due_idx').on(t.workspaceId, t.dueDate),
    index('work_item_root_idx').on(t.rootId),
    /**
     * The cycle page's every query: its item list, its progress counts and its
     * burndown all start "the items in this cycle". Partial, because the column
     * is null for everything in the backlog — which in a mature project is most
     * of the table, and none of it is ever the answer to this question.
     */
    index('work_item_cycle_idx')
      .on(t.cycleId)
      .where(sql`${t.cycleId} is not null`),
    index('work_item_parent_idx').on(t.parentId),

    /** What makes "assigned to me" and "labelled client" avoid a join (§9). */
    index('work_item_assignees_idx').using('gin', t.assigneeIds),
    index('work_item_labels_idx').using('gin', t.labelIds),

    ...tenantPolicies(),
  ],
);

/**
 * Assignment, and the source of truth `work_item.assignee_ids` mirrors.
 *
 * §4: assignment is multiple. Single-assignee is a limitation teams route
 * around with comments, which puts the information somewhere no query reaches.
 *
 * No `deleted_at`: unassigning is a real delete. A soft-deleted join row would
 * have to be filtered by every reader and, worse, would keep the pair occupied
 * against the unique below — so re-assigning the same person would fail.
 */
export const workItemAssignee = pgTable(
  'work_item_assignee',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').notNull(),
    workspaceMemberId: uuid('workspace_member_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('work_item_assignee_key').on(t.workItemId, t.workspaceMemberId),
    index('work_item_assignee_member_idx').on(t.workspaceMemberId),
    foreignKey({
      name: 'work_item_assignee_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'work_item_assignee_member_fk',
      columns: [t.workspaceMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('cascade'),
    ...tenantPolicies(),
  ],
);

/** Labelling, and the source of truth `work_item.label_ids` mirrors. */
export const workItemLabel = pgTable(
  'work_item_label',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').notNull(),
    labelId: uuid('label_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('work_item_label_key').on(t.workItemId, t.labelId),
    index('work_item_label_label_idx').on(t.labelId),
    foreignKey({
      name: 'work_item_label_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'work_item_label_label_fk',
      columns: [t.labelId, t.workspaceId],
      foreignColumns: [label.id, label.workspaceId],
    }).onDelete('cascade'),
    ...tenantPolicies(),
  ],
);
