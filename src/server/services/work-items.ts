import 'server-only';

import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import {
  cycle,
  project,
  projectCounter,
  user,
  workItem,
  workItemAssignee,
  workItemLabel,
  workflowState,
  workspaceMember,
} from '@/server/db/schema';
import { inSequence, mapInSequence } from '@/server/db/sequence';
import { withActor } from '@/server/db/tenant';
import { isClosedGroup, type StateGroup } from '@/lib/state-groups';
import { OPEN_STATE_GROUPS } from '@/lib/needs-attention';
import { isPriority } from '@/lib/priorities';
import { rankAfter, rankBetween } from '@/lib/rank';
import { todayIn } from '@/lib/workspace-date';
import {
  NONE,
  type WorkItemQuery,
} from '@/lib/work-item-query';
import {
  countWorkItemsByGroup,
  fetchChangeToken,
  fetchStaleBefore,
  fetchWorkItemGroups,
  type CustomFieldKinds,
  type WorkItemGroupPage,
  type WorkItemRow,
} from '@/server/queries/work-items';
import {
  fetchCustomFields,
  fetchCustomValues,
  fetchCustomValuesForItems,
  type CustomFieldDefinition,
  type CustomValueRow,
} from '@/server/queries/custom-fields';
import { customFieldIdOf, operatorSuits } from '@/lib/custom-fields';
import {
  isArchived,
  loadProject,
  projectResource,
  type ProjectProblem,
  type ProjectRow,
} from './project-access';
import { readLabelsByIds, type LabelRow } from './labels';

/**
 * Work items (§14, slice 5).
 *
 * Three rules run through everything here, and each one is somebody else's
 * decision that this module is only carrying out:
 *
 *   * **§10 is asked on every path.** `work_item.create` and `work_item.edit`
 *     are Member-and-above *within the project*, which for a private project
 *     means an explicit membership — so the check needs the project row, and
 *     every mutation loads it before doing anything.
 *
 *   * **An archived project is read-only** (§4): "no new items, no edits, no
 *     state changes, no comments". Enforced here rather than by hiding buttons,
 *     because a stale tab is a button that is still on screen.
 *
 *   * **The list query is never re-implemented.** Everything that reads goes
 *     through `src/server/queries/work-items.ts`, which §19.6 will later hold
 *     the Phase 2 MCP server to as well. What this module adds is hydration —
 *     turning ids into the names and chips a screen draws — and the second
 *     policy pass that `listProjects` established: the SQL is an optimisation
 *     of the policy module, never a second opinion.
 */

export type WorkItemProblem =
  | ProjectProblem
  | 'title_required'
  | 'unknown_state'
  | 'unknown_neighbour'
  | 'unknown_parent'
  | 'too_deep'
  | 'unknown_member'
  | 'unknown_label'
  | 'blocked_reason_required';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: WorkItemProblem };

/** One person, as a list row draws them. */
export type PersonRef = {
  memberId: string;
  userId: string;
  name: string;
};

export type WorkItemView = WorkItemRow & {
  /** `ENG-142` — composed here, because the prefix lives on the project (§9). */
  identifier: string;
};

export type WorkItemGroupView = Omit<WorkItemGroupPage, 'rows'> & {
  rows: WorkItemView[];
};

export type WorkItemListing = {
  groups: WorkItemGroupView[];
  /** Everyone referenced by an `assigneeIds`, so avatars need no second round trip. */
  people: PersonRef[];
  /** Every label referenced, likewise. */
  labels: LabelRow[];
  /** Today in the workspace timezone, so the view's overdue badge uses the same date the filter did. */
  today: string;
  /**
   * Every custom-field value on the rows returned, by item and then by field
   * (§6-4) — present only when the caller asked for it.
   *
   * Only the Table view does, which is the same shape of decision as "only the
   * board polls, so only the board pays for the token": the List and the board
   * draw item *cards*, which §12 specifies without custom fields on them, and a
   * query they do not use is a query they should not pay for on every render.
   */
  customValues?: Map<string, Map<string, CustomValueRow>>;
};

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * The list query, hydrated.
 *
 * `groupKeys` is supplied by the caller rather than discovered, because a board
 * column that vanishes when it empties is a column nothing can be dragged into
 * — and because the *order* of the groups is the project's, not the data's.
 */
export async function listWorkItems(
  resolved: ResolvedActor,
  query: WorkItemQuery,
  options: {
    groupKeys: readonly string[];
    cursors?: Readonly<Record<string, string | null | undefined>>;
    /** §6-4's values for the rows returned. The Table view's columns need them; nothing else does. */
    withCustomValues?: boolean;
  },
): Promise<WorkItemListing> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const fields = await customFieldKinds(tx, query);
    const scoped = withKnownCustomFilters(query, fields);

    const groups = await fetchWorkItemGroups(tx, scoped, {
      groupKeys: options.groupKeys,
      cursors: options.cursors,
      today,
      fields,
    });

    // The second pass `listProjects` established. RLS has already made another
    // workspace's rows unreachable; this is §10's own question, asked about the
    // projects the rows came from — a private project a Guest was removed from
    // between the filter being built and the page being drawn is the case it
    // catches. If it ever removes a row, the SQL and the module have drifted,
    // and the module is the one that is right.
    const projectIds = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.projectId)))];
    const visible = await visibleProjects(tx, resolved, projectIds);

    const kept = groups.map((group) => ({
      ...group,
      rows: group.rows.filter((row) => visible.has(row.projectId)),
    }));

    const keys = new Map([...visible].map(([id, row]) => [id, row.key]));

    const memberIds = [...new Set(kept.flatMap((g) => g.rows.flatMap((r) => r.assigneeIds)))];
    const labelIds = [...new Set(kept.flatMap((g) => g.rows.flatMap((r) => r.labelIds)))];

    const itemIds = kept.flatMap((g) => g.rows.map((r) => r.id));

    const [people, labels, customValues] = await inSequence(
      () => readPeople(tx, memberIds),
      () => readLabelsByIds(tx, labelIds),
      // One query for the page, not one per row. `undefined` rather than an
      // empty map when nobody asked, so a caller cannot mistake "not fetched"
      // for "nothing filled in" — the second is a real answer and the first is
      // not an answer at all.
      async () => (options.withCustomValues ? fetchCustomValuesForItems(tx, itemIds) : undefined),
    );

    return {
      groups: kept.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({
          ...row,
          identifier: `${keys.get(row.projectId) ?? '?'}-${row.number}`,
        })),
      })),
      people,
      labels,
      today,
      customValues,
    };
  });
}

/**
 * Several listings, in one transaction (§7.4, slice 13).
 *
 * §7.4's Needs Attention is five lists on one screen — overdue, blocked,
 * unassigned, undated, stale — and its Workload is a per-person grouping beside
 * a second count. Run through `listWorkItems`, that is six or seven `withActor`
 * transactions on the screen a manager opens most, each re-reading the same
 * people, the same labels and the same project visibility.
 *
 * This is the same trap slice 8 hit when `getCommentThread` opened its own
 * transaction, slice 9 hit with the unread count and slice 10 hit with the
 * custom-field definitions, and the answer is the one those three arrived at:
 * ask every question inside the transaction that is already open. The
 * per-request cost here is one round trip per set plus **one** hydration pass
 * for all of them, rather than four round trips per set.
 *
 * Each set carries its own fully-formed query, so `assertAnchored` still holds
 * for every one of them individually — batching is not a way around §16, and a
 * caller that hands in one unanchored set gets the same refusal it would have
 * got alone.
 */
export type WorkItemSetRequest = {
  /** The caller's own name for this set — a Needs Attention row, say. Opaque here. */
  key: string;
  query: WorkItemQuery;
  /** Every group to draw, as `listWorkItems` takes them. `['all']` for an ungrouped set. */
  groupKeys: readonly string[];
  /**
   * Skip the page query and return totals only.
   *
   * Workload's second question is "how many of these are overdue, per person",
   * and it draws no rows from the answer. Fetching a page per person to throw it
   * away is the same waste the calendar avoids by lowering its page size.
   */
  countsOnly?: boolean;
};

export type WorkItemSetResult = {
  key: string;
  groups: WorkItemGroupView[];
};

export type WorkItemSets = {
  sets: WorkItemSetResult[];
  /** Everyone referenced across every set, hydrated once. */
  people: PersonRef[];
  labels: LabelRow[];
  today: string;
};

export async function listWorkItemSets(
  resolved: ResolvedActor,
  requests: readonly WorkItemSetRequest[],
): Promise<WorkItemSets> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    /**
     * The staleness cutoff, resolved once for the whole screen (§9).
     *
     * Every set that filters on staleness shares one instant, which is not
     * merely an optimisation: two rows of the same tab computing "five working
     * days ago" separately could straddle midnight in the workspace's zone and
     * disagree about one item, on the one screen whose entire job is to be the
     * agreed picture.
     *
     * Asked only when something actually filters on it — most screens do not.
     */
    const staleDays = requests
      .map((request) => request.query.filters.stale)
      .find((value): value is number => value !== undefined);

    const staleBefore =
      staleDays === undefined
        ? null
        : await fetchStaleBefore(tx, resolved.workspace.id, today, staleDays);

    const fetched = await mapInSequence(requests, async (request) => {
      const groups = request.countsOnly
        ? await countWorkItemsByGroup(tx, request.query, { today, staleBefore }).then((totals) =>
            request.groupKeys.map((key) => ({
              key,
              total: totals.get(key) ?? 0,
              rows: [],
              nextCursor: null,
            })),
          )
        : await fetchWorkItemGroups(tx, request.query, {
            groupKeys: request.groupKeys,
            today,
            staleBefore,
          });

      return { key: request.key, groups };
    });

    // §10's second pass, once across every set — the same one `listWorkItems`
    // makes, and for the same reason: RLS has already ruled out another
    // workspace, and this rules out a private project this actor cannot see.
    const projectIds = [
      ...new Set(fetched.flatMap((set) => set.groups.flatMap((g) => g.rows.map((r) => r.projectId)))),
    ];
    const visible = await visibleProjects(tx, resolved, projectIds);

    const kept = fetched.map((set) => ({
      key: set.key,
      groups: set.groups.map((group) => ({
        ...group,
        rows: group.rows.filter((row) => visible.has(row.projectId)),
      })),
    }));

    const memberIds = [
      ...new Set(kept.flatMap((s) => s.groups.flatMap((g) => g.rows.flatMap((r) => r.assigneeIds)))),
    ];
    const labelIds = [
      ...new Set(kept.flatMap((s) => s.groups.flatMap((g) => g.rows.flatMap((r) => r.labelIds)))),
    ];

    const [people, labels] = await inSequence(
      () => readPeople(tx, memberIds),
      () => readLabelsByIds(tx, labelIds),
    );

    return {
      sets: kept.map((set) => ({
        key: set.key,
        groups: set.groups.map((group) => ({
          ...group,
          rows: group.rows.map((row) => ({
            ...row,
            identifier: `${visible.get(row.projectId)?.key ?? '?'}-${row.number}`,
          })),
        })),
      })),
      people,
      labels,
      today,
    };
  });
}

/**
 * The token a board polls (§8, §17-2).
 *
 * No hydration, no policy second pass, no group fan-out — it is one aggregate
 * and it answers exactly one question: *has anything I am looking at moved?*
 * The board only fetches when the answer changes, so this is the call that runs
 * on a timer and the expensive one that does not.
 *
 * RLS still scopes it, so a token cannot report activity in a workspace the
 * caller cannot see. It can report activity in a *private project* they cannot
 * see — the count would move without the rows being readable — which is why the
 * refetch it triggers goes through `listWorkItems` and its §10 pass rather than
 * trusting the token to have been about visible work.
 */
export async function boardChangeToken(
  resolved: ResolvedActor,
  query: WorkItemQuery,
): Promise<string> {
  const today = todayIn(resolved.workspace.timezone);
  return withActor(resolved.context, async (tx) => {
    // The token has to ride the *same* predicate the board does, custom filters
    // included — a token computed over a wider set would move when a row the
    // board is not showing changed, and the board would refetch all afternoon.
    const fields = await customFieldKinds(tx, query);
    return fetchChangeToken(tx, withKnownCustomFilters(query, fields), { today, fields });
  });
}

/**
 * The kinds of every custom field the query could mention, or an empty map when
 * it mentions none.
 *
 * Skipped entirely for a query with no custom filter and no custom grouping,
 * which is most of them — a list view that has never seen a custom field should
 * not pay a query to find that out.
 *
 * Keyed off the project anchor: a custom field belongs to a project (§6-4), so
 * the fields in scope are the fields of the projects being listed. An
 * assignee-anchored query (My Work, slice 13) reaches many projects and gets an
 * empty map, which is correct for now — nothing builds a cross-project custom
 * filter, and when something does it will supply its own project set rather
 * than widening this.
 */
async function customFieldKinds(tx: TenantDb, query: WorkItemQuery): Promise<CustomFieldKinds> {
  const mentioned = query.filters.custom.length > 0 || customFieldIdOf(query.groupBy) !== null;
  if (!mentioned || query.filters.projectIds.length === 0) return new Map();

  const perProject = await mapInSequence(query.filters.projectIds, (projectId) =>
    fetchCustomFields(tx, projectId),
  );

  return new Map(perProject.flat().map((field) => [field.id, field.kind]));
}

/**
 * The query with any custom filter this project cannot answer removed.
 *
 * §9's tolerance rule — "discarding rather than failing" — applied where it can
 * be: the URL parser checks a filter's shape, and this checks it against the
 * project's actual fields. A link naming a field somebody has since deleted, or
 * asking a date field what it contains, widens the list rather than showing a
 * stranger an error page.
 */
function withKnownCustomFilters(query: WorkItemQuery, fields: CustomFieldKinds): WorkItemQuery {
  if (query.filters.custom.length === 0) return query;

  const custom = query.filters.custom.filter((filter) => {
    const kind = fields.get(filter.fieldId);
    return kind !== undefined && operatorSuits(filter.op, kind);
  });

  if (custom.length === query.filters.custom.length) return query;
  return { ...query, filters: { ...query.filters, custom } };
}

/**
 * One item by its project and number — the `ENG-142` of a URL.
 *
 * Null covers "no such item" and "not visible to you" alike, and the caller
 * turns both into a 404, for the reason `getProjectBySlug` does: telling them
 * apart says what exists.
 */
export async function getWorkItem(
  resolved: ResolvedActor,
  input: { projectSlug: string; number: number },
): Promise<
  | (WorkItemView & {
      description: string | null;
      projectKey: string;
      projectSlug: string;
      stateGroup: StateGroup;
      assignees: PersonRef[];
      labels: LabelRow[];
      /** The project's field definitions (§6-4), in display order. */
      customFields: CustomFieldDefinition[];
      /** This item's values, by field id. A field with no entry has none. */
      customValues: Map<string, CustomValueRow>;
      /**
       * The name of the cycle this item is in, or null for the backlog (§7.6).
       *
       * Carried because the item's cycle may have **closed**, in which case it
       * is not among the open ones the project loaded — and a picker that could
       * not name its own current value would read as though the item were
       * planned into nothing.
       */
      cycleName: string | null;
      canEdit: boolean;
      archived: boolean;
      today: string;
    })
  | null
> {
  const today = todayIn(resolved.workspace.timezone);

  return withActor(resolved.context, async (tx) => {
    const rows = await tx
      .select({
        item: workItem,
        projectKey: project.key,
        projectSlug: project.slug,
        projectVisibility: project.visibility,
        projectArchivedAt: project.archivedAt,
        stateGroup: workflowState.group,
        // Left, because the backlog is the common case and an inner join would
        // make an unplanned item disappear from its own page.
        cycleName: cycle.name,
      })
      .from(workItem)
      .innerJoin(project, eq(project.id, workItem.projectId))
      .innerJoin(workflowState, eq(workflowState.id, workItem.stateId))
      .leftJoin(cycle, eq(cycle.id, workItem.cycleId))
      .where(
        and(
          eq(project.slug, input.projectSlug),
          eq(workItem.number, input.number),
          isNull(workItem.deletedAt),
          isNull(project.deletedAt),
        ),
      )
      .limit(1);

    const found = rows[0];
    if (!found) return null;

    const resource = {
      id: found.item.projectId,
      workspaceId: resolved.workspace.id,
      visibility: found.projectVisibility,
    };
    if (!can(resolved.actor, 'project.view', resource)) return null;

    // The custom fields ride along in the transaction that is already open
    // (§6-4, slice 10). A service of their own would have been a second
    // `withActor` on every item page render, which is the trap slice 8 hit with
    // `getCommentThread` and slice 9 hit with the unread count — and the item
    // page already opens more transactions than any other screen in the
    // product.
    const [assignees, labels, customFields, customValues] = await inSequence(
      () => readPeople(tx, found.item.assigneeIds),
      () => readLabelsByIds(tx, found.item.labelIds),
      () => fetchCustomFields(tx, found.item.projectId),
      () => fetchCustomValues(tx, found.item.id),
    );

    return {
      ...found.item,
      identifier: `${found.projectKey}-${found.item.number}`,
      projectKey: found.projectKey,
      projectSlug: found.projectSlug,
      stateGroup: found.stateGroup,
      cycleName: found.cycleName,
      assignees,
      labels,
      customFields,
      customValues,
      // An archived project is read-only for everyone including its owner (§4),
      // so the screen has to know both facts separately: may you edit, and is
      // anything editable at all.
      canEdit: can(resolved.actor, 'work_item.edit', resource) && found.projectArchivedAt === null,
      archived: found.projectArchivedAt !== null,
      today,
    };
  });
}

/** The projects among `ids` this actor may actually see, keyed by id. */
async function visibleProjects(
  tx: TenantDb,
  resolved: ResolvedActor,
  ids: readonly string[],
): Promise<Map<string, { key: string }>> {
  if (ids.length === 0) return new Map();

  const rows = await tx
    .select({
      id: project.id,
      key: project.key,
      workspaceId: project.workspaceId,
      visibility: project.visibility,
    })
    .from(project)
    .where(and(inArray(project.id, [...ids]), isNull(project.deletedAt)));

  return new Map(
    rows
      .filter((row) =>
        can(resolved.actor, 'project.view', {
          id: row.id,
          workspaceId: row.workspaceId,
          visibility: row.visibility,
        }),
      )
      .map((row) => [row.id, { key: row.key }]),
  );
}

async function readPeople(tx: TenantDb, memberIds: readonly string[]): Promise<PersonRef[]> {
  if (memberIds.length === 0) return [];

  return tx
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      // An account with no name still has to be nameable in a list, so the
      // address stands in until they fill one in.
      name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(inArray(workspaceMember.id, [...memberIds]))
    .orderBy(asc(user.name));
}

/* ------------------------------------------------------------------------- */
/* Writing                                                                   */
/* ------------------------------------------------------------------------- */

export type CreateWorkItemInput = {
  projectId: string;
  title: string;
  /** §5: "state defaults to the column you created in". Absent means the first state. */
  stateId?: string;
  priority?: string;
  assigneeMemberIds?: readonly string[];
  labelIds?: readonly string[];
  dueDate?: string | null;
  parentId?: string | null;
};

/**
 * Creating an item (§7.2, target: under five seconds).
 *
 * The human identifier is allocated **last-ish** and in one statement: an
 * upsert on the project's counter row, which both creates the counter the first
 * time and increments it every time after, under a row lock held to commit.
 * That lock is what makes `ENG-142` gapless, and §17-11 is explicit that the
 * contention is real and scoped to one project — two projects never wait on
 * each other, which is the property that matters.
 *
 * `root_id` and `depth` are set by the trigger in migration 0008, not here. The
 * value passed below is what the column needs to be non-null before the trigger
 * runs; the trigger overwrites it, and refuses a fourth level.
 */
export async function createWorkItem(
  resolved: ResolvedActor,
  input: CreateWorkItemInput,
): Promise<Ok<{ workItemId: string; number: number }> | Failed> {
  const title = input.title.trim().normalize('NFC');
  if (!title) return { ok: false, problem: 'title_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const target = await loadProject(tx, input.projectId);
    if (!target) return { ok: false, problem: 'not_found' } as const;
    if (isArchived(target)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'work_item.create', projectResource(target));

    const state = await resolveState(tx, input.projectId, input.stateId);
    if (!state) return { ok: false, problem: 'unknown_state' } as const;

    if (input.parentId) {
      const parent = await tx
        .select({ id: workItem.id, depth: workItem.depth })
        .from(workItem)
        .where(
          and(
            eq(workItem.id, input.parentId),
            eq(workItem.projectId, input.projectId),
            isNull(workItem.deletedAt),
          ),
        )
        .limit(1);

      if (parent.length === 0) return { ok: false, problem: 'unknown_parent' } as const;
      // The trigger refuses this too, and would roll the transaction back with
      // a message meant for a developer. Refusing here gives the screen a
      // problem identifier it can translate (§13).
      if ((parent[0]?.depth ?? 0) >= 2) return { ok: false, problem: 'too_deep' } as const;
    }

    const workItemId = uuidv7();

    // Appended to the group it was created in. Jittered, so two people typing
    // into the same column at the same moment do not compute the same key and
    // leave two cards swapping places on every reload (§9).
    const last = await tx
      .select({ rank: workItem.rank })
      .from(workItem)
      .where(
        and(
          eq(workItem.projectId, input.projectId),
          eq(workItem.stateId, state.id),
          isNull(workItem.deletedAt),
        ),
      )
      .orderBy(desc(workItem.rank))
      .limit(1);

    const number = await allocateNumber(tx, resolved.workspace.id, input.projectId);

    await tx.insert(workItem).values({
      id: workItemId,
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      number,
      title,
      stateId: state.id,
      priority: isPriority(input.priority) ? input.priority : 'none',
      parentId: input.parentId ?? null,
      // Overwritten by the hierarchy trigger; present so the column is non-null
      // when the trigger runs.
      rootId: workItemId,
      rank: rankAfter(last[0]?.rank ?? null),
      dueDate: input.dueDate ?? null,
      completedAt: isClosedGroup(state.group) ? new Date() : null,
      createdByMemberId: resolved.memberId,
    });

    const assigneeProblem = await writeAssignees(
      tx,
      resolved,
      workItemId,
      input.assigneeMemberIds ?? [],
    );
    if (assigneeProblem) return { ok: false, problem: assigneeProblem } as const;

    const labelProblem = await writeLabels(tx, resolved, workItemId, input.labelIds ?? []);
    if (labelProblem) return { ok: false, problem: labelProblem } as const;

    uow.emit({
      type: 'work_item.created',
      workspaceId: resolved.workspace.id,
      projectId: input.projectId,
      workItemId,
      number,
      title,
      stateId: state.id,
      parentId: input.parentId ?? null,
      // The people handed this work as it was created. `work_item.assigned`
      // never fires for them — a create writes its assignees and emits one
      // event — so without this the one assignment nobody hears about is the
      // one that comes with the item.
      assigneeIds: [...new Set(input.assigneeMemberIds ?? [])],
    });

    return { ok: true, workItemId, number } as const;
  });
}

/**
 * The next human identifier for a project, gapless.
 *
 * One statement, so there is no read-then-write window for two concurrent
 * creates to both win. `ON CONFLICT DO UPDATE` takes the row lock; the second
 * transaction waits on it and then reads the value the first wrote.
 */
async function allocateNumber(
  tx: TenantDb,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  const result = await tx
    .insert(projectCounter)
    .values({ id: uuidv7(), workspaceId, projectId, lastNumber: 1 })
    .onConflictDoUpdate({
      target: projectCounter.projectId,
      set: {
        lastNumber: sql`${projectCounter.lastNumber} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ number: projectCounter.lastNumber });

  return result[0]!.number;
}

async function resolveState(
  tx: TenantDb,
  projectId: string,
  stateId: string | undefined,
): Promise<{ id: string; group: StateGroup } | null> {
  const rows = await tx
    .select({ id: workflowState.id, group: workflowState.group })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.projectId, projectId),
        isNull(workflowState.deletedAt),
        stateId ? eq(workflowState.id, stateId) : undefined,
      ),
    )
    .orderBy(asc(workflowState.position), asc(workflowState.id))
    .limit(1);

  return rows[0] ?? null;
}

/** The fields a plain edit may touch. Assignees, labels, state and blocked have their own calls. */
export type UpdateWorkItemInput = {
  workItemId: string;
  title?: string;
  description?: string | null;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
};

export async function updateWorkItem(
  resolved: ResolvedActor,
  input: UpdateWorkItemInput,
): Promise<Ok | Failed> {
  const title = input.title?.trim().normalize('NFC');
  if (title !== undefined && !title) return { ok: false, problem: 'title_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const next = {
      title: title ?? item.title,
      description: input.description === undefined ? item.description : input.description,
      priority: isPriority(input.priority) ? input.priority : item.priority,
      startDate: input.startDate === undefined ? item.startDate : input.startDate,
      dueDate: input.dueDate === undefined ? item.dueDate : input.dueDate,
      estimate: input.estimate === undefined ? item.estimate : input.estimate,
    };

    // Which fields actually moved, so the activity feed slice 7 builds says
    // "changed the due date" rather than "edited the item".
    const fields = (Object.keys(next) as (keyof typeof next)[]).filter(
      (field) => next[field] !== item[field],
    );
    if (fields.length === 0) return { ok: true } as const;

    await tx
      .update(workItem)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.updated',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      fields,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

/**
 * Moving an item to another state — §7.3's one click, and slice 6's drag.
 *
 * `completed_at` is set from the new state's **group**, never its name (§4). A
 * company that renames "Done" to "Shipped" has not changed what completion
 * means, and a company with two completed states must not have one of them
 * silently excluded from slice 11's burndown.
 */
export async function setWorkItemState(
  resolved: ResolvedActor,
  input: { workItemId: string; stateId: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    if (item.stateId === input.stateId) return { ok: true } as const;

    const rows = await tx
      .select({ id: workflowState.id, group: workflowState.group })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, input.stateId),
          eq(workflowState.projectId, item.projectId),
          isNull(workflowState.deletedAt),
        ),
      )
      .limit(1);

    const state = rows[0];
    if (!state) return { ok: false, problem: 'unknown_state' } as const;

    const closing = isClosedGroup(state.group);

    await tx
      .update(workItem)
      .set({
        stateId: state.id,
        // Re-stamped on entering a closed group and cleared on leaving one. Not
        // preserved across a reopen: the date an item was finished is the date
        // it was *last* finished, which is what a burndown is asking.
        completedAt: closing ? (item.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.state_changed',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      from: item.stateId,
      to: state.id,
      completed: closing,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

export type MoveWorkItemInput = {
  workItemId: string;
  /** The column the card was dropped into. May be the one it already sits in. */
  stateId: string;
  /** The card the drop point sits *below*, or null for the top of the column. */
  previousId: string | null;
  /** The card the drop point sits *above*, or null for the bottom of the column. */
  nextId: string | null;
};

/**
 * A drag, resolved (§7.5, §9).
 *
 * **The client sends neighbour IDs and never a rank.** That is the whole design,
 * and everything awkward below follows from it. A rank computed in the browser
 * is computed against a board that may be seconds stale, and two people
 * dragging onto the same gap would compute the same key; a rank computed here,
 * under a row lock, is computed against what is actually true right now.
 *
 * §9: "A stale drag lands correctly relative to present state — this is what
 * stops boards feeling haunted." So a neighbour that has *moved on* since the
 * drag began is not an error. The rules, in order:
 *
 *   * A neighbour id that names no row in this project is a **bad request** —
 *     that is a client defect or a crafted body, not a race.
 *   * A neighbour that exists but has since left this column is **stale**. The
 *     true neighbour is re-derived from the column as it stands, so the card
 *     lands where the user aimed relative to the cards they can still see.
 *   * `null` is an *intent*, not a missing value: `previousId: null` means "the
 *     top", `nextId: null` means "the bottom". Neither is ever re-derived, or a
 *     card dropped at the end of a column would slide into the middle of it.
 *
 * The lock covers the item and both neighbours in one statement, so two drags
 * touching the same cards serialize rather than interleave — which is what §15's
 * two-browser test asserts.
 */
export async function moveWorkItem(
  resolved: ResolvedActor,
  input: MoveWorkItemInput,
): Promise<Ok<{ rank: string }> | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const stateRows = await tx
      .select({ id: workflowState.id, group: workflowState.group })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.id, input.stateId),
          eq(workflowState.projectId, item.projectId),
          isNull(workflowState.deletedAt),
        ),
      )
      .limit(1);

    const state = stateRows[0];
    if (!state) return { ok: false, problem: 'unknown_state' } as const;

    // A card is never its own neighbour, whatever the client believed.
    const previousId = input.previousId === input.workItemId ? null : input.previousId;
    const nextId = input.nextId === input.workItemId ? null : input.nextId;

    const wanted = [previousId, nextId].filter((id): id is string => id !== null);

    // One locking read for the item and both neighbours. `FOR UPDATE` is §9's,
    // and it is taken before any rank is read — a lock acquired after the read
    // it was meant to protect is decoration.
    const locked = wanted.length
      ? await tx
          .select({ id: workItem.id, rank: workItem.rank, stateId: workItem.stateId })
          .from(workItem)
          .where(
            and(
              inArray(workItem.id, [...wanted, input.workItemId]),
              eq(workItem.projectId, item.projectId),
              isNull(workItem.deletedAt),
            ),
          )
          .for('update')
      : await tx
          .select({ id: workItem.id, rank: workItem.rank, stateId: workItem.stateId })
          .from(workItem)
          .where(eq(workItem.id, input.workItemId))
          .for('update');

    const byId = new Map(locked.map((row) => [row.id, row]));
    for (const id of wanted) {
      if (!byId.has(id)) return { ok: false, problem: 'unknown_neighbour' } as const;
    }

    /** A neighbour still counts only while it is still in the column being dropped into. */
    const liveRank = (id: string | null): string | null => {
      if (id === null) return null;
      const row = byId.get(id);
      return row && row.stateId === state.id ? row.rank : null;
    };

    const previousRank = liveRank(previousId);

    // `nextId` named a card that has since left the column: re-derive the card
    // that now follows the drop point, so the drag lands relative to what is
    // there. A `nextId` of null is an intent and is never re-derived.
    let nextRank = liveRank(nextId);
    if (nextId !== null && nextRank === null) {
      const successor = await tx
        .select({ rank: workItem.rank })
        .from(workItem)
        .where(
          and(
            eq(workItem.stateId, state.id),
            eq(workItem.projectId, item.projectId),
            isNull(workItem.deletedAt),
            ne(workItem.id, input.workItemId),
            previousRank === null ? undefined : gt(workItem.rank, previousRank),
          ),
        )
        .orderBy(asc(workItem.rank))
        .limit(1);

      nextRank = successor[0]?.rank ?? null;
    }

    // Both neighbours survived but no longer bracket a gap — the column was
    // reordered under the drag. The one above wins, because it is the card the
    // user was aiming beneath.
    if (previousRank !== null && nextRank !== null && previousRank >= nextRank) {
      nextRank = null;
    }

    const rank = rankBetween(previousRank, nextRank);

    const sameState = item.stateId === state.id;
    if (sameState && item.rank === rank) return { ok: true, rank } as const;

    const closing = isClosedGroup(state.group);

    await tx
      .update(workItem)
      .set({
        stateId: state.id,
        rank,
        // The same rule `setWorkItemState` applies, because a drag into a Done
        // column is a completion and slice 11's burndown reads this column.
        completedAt: closing ? (item.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(workItem.id, input.workItemId));

    // Exactly one event per drag. Crossing columns is a state change and
    // already has an event that slice 7 and slice 9 understand; staying inside
    // one is a move and has its own.
    uow.emit(
      sameState
        ? {
            type: 'work_item.moved',
            workspaceId: resolved.workspace.id,
            projectId: item.projectId,
            workItemId: input.workItemId,
            stateId: state.id,
          }
        : {
            type: 'work_item.state_changed',
            workspaceId: resolved.workspace.id,
            projectId: item.projectId,
            workItemId: input.workItemId,
            from: item.stateId,
            to: state.id,
            completed: closing,
            assigneeIds: item.assigneeIds,
          },
    );

    return { ok: true, rank } as const;
  });
}

/**
 * The whole assignee set, not a diff.
 *
 * A set rather than add/remove calls because the UI is a multi-select and the
 * user's intent is "these people" — two calls would mean a window where an item
 * is assigned to nobody, and a notification for it (§4: unassignment notifies
 * the person removed).
 */
export async function setWorkItemAssignees(
  resolved: ResolvedActor,
  input: { workItemId: string; memberIds: readonly string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const wanted = [...new Set(input.memberIds)];
    const current = new Set(item.assigneeIds);
    const added = wanted.filter((id) => !current.has(id));
    const removed = item.assigneeIds.filter((id) => !wanted.includes(id));
    if (added.length === 0 && removed.length === 0) return { ok: true } as const;

    if (removed.length > 0) {
      await tx
        .delete(workItemAssignee)
        .where(
          and(
            eq(workItemAssignee.workItemId, input.workItemId),
            inArray(workItemAssignee.workspaceMemberId, removed),
          ),
        );
    }

    const problem = await writeAssignees(tx, resolved, input.workItemId, added);
    if (problem) return { ok: false, problem } as const;

    uow.emit({
      type: 'work_item.assigned',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      added,
      removed,
    });

    return { ok: true } as const;
  });
}

/**
 * §7.12's required choice, carried out: move somebody's **open** work to
 * somebody else, or to nobody.
 *
 * "Removing a member requires choosing what happens to their open work" (§4),
 * and until slice 15 there was nothing to choose about — `removeMember`'s own
 * comment says work items did not exist when it was written. This is the
 * function it was waiting for.
 *
 * **It takes a transaction rather than opening one**, because it is called from
 * inside `removeMember`'s: the reassignment and the removal are one act, and
 * splitting them leaves a window in which somebody has been offboarded and
 * still owns forty items. If the removal fails, the reassignment must not have
 * happened either.
 *
 * **Open, not everything.** §7.12 says open work, and it is right: reassigning
 * work somebody finished last March rewrites history — the item's activity feed
 * would show a change months after the fact, and the person who actually did it
 * would disappear from the one place that recorded them. `isClosedGroup` is the
 * same authority the burndown and the progress bar read, so "done" means the
 * state **group** rather than a state named "Done" (§4).
 *
 * **Workspace-wide, deliberately not filtered by the actor's project
 * visibility.** Somebody being offboarded may hold work in a private project
 * the Admin is not in, and that is exactly the work that would otherwise be
 * orphaned with nobody able to see that it had been. §10 has already gated this
 * on `workspace.manage_members`, and RLS keeps it inside the one company.
 *
 * Returns the items it touched, so the caller can emit one event carrying all
 * of them — see `workspace_member.work_reassigned`, whose projector writes one
 * feed line per item so no item changes hands silently.
 */
export async function reassignOpenWorkInTx(
  tx: TenantDb,
  workspaceId: string,
  input: { fromMemberId: string; toMemberId: string | null },
): Promise<{ workItemId: string; projectId: string }[]> {
  const rows = await tx
    .select({ workItemId: workItem.id, projectId: workItem.projectId })
    .from(workItemAssignee)
    .innerJoin(workItem, eq(workItem.id, workItemAssignee.workItemId))
    .innerJoin(workflowState, eq(workflowState.id, workItem.stateId))
    .where(
      and(
        eq(workItemAssignee.workspaceMemberId, input.fromMemberId),
        isNull(workItem.deletedAt),
        // The same list §7.4's Needs Attention reads, derived from
        // `isClosedGroup` rather than written out, so "done" cannot come to mean
        // two different things in two files. Pinned by `needs-attention.test.ts`.
        inArray(workflowState.group, [...OPEN_STATE_GROUPS]),
      ),
    );

  if (rows.length === 0) return [];

  const workItemIds = rows.map((row) => row.workItemId);

  await tx
    .delete(workItemAssignee)
    .where(
      and(
        eq(workItemAssignee.workspaceMemberId, input.fromMemberId),
        inArray(workItemAssignee.workItemId, workItemIds),
      ),
    );

  if (input.toMemberId) {
    // §4 makes assignment multiple, so the target may already be on some of
    // these items — `onConflictDoNothing` rather than a read-then-filter,
    // because the unique index on (work_item_id, workspace_member_id) is the
    // authority and a check beforehand is a race with any other assignment
    // happening in the same second.
    await tx
      .insert(workItemAssignee)
      .values(
        workItemIds.map((workItemId) => ({
          id: uuidv7(),
          workspaceId,
          workItemId,
          workspaceMemberId: input.toMemberId!,
        })),
      )
      .onConflictDoNothing();
  }

  return rows;
}

export async function setWorkItemLabels(
  resolved: ResolvedActor,
  input: { workItemId: string; labelIds: readonly string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const wanted = [...new Set(input.labelIds)];
    const current = new Set(item.labelIds);
    const added = wanted.filter((id) => !current.has(id));
    const removed = item.labelIds.filter((id) => !wanted.includes(id));
    if (added.length === 0 && removed.length === 0) return { ok: true } as const;

    if (removed.length > 0) {
      await tx
        .delete(workItemLabel)
        .where(
          and(
            eq(workItemLabel.workItemId, input.workItemId),
            inArray(workItemLabel.labelId, removed),
          ),
        );
    }

    const problem = await writeLabels(tx, resolved, input.workItemId, added);
    if (problem) return { ok: false, problem } as const;

    uow.emit({
      type: 'work_item.labelled',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      added,
      removed,
    });

    return { ok: true } as const;
  });
}

/**
 * §4: blocked is a flag, not a state — an item can be *In Progress and
 * blocked*. §7.3 makes it one click that notifies the project lead, and the
 * reason is required, because "blocked" with no reason is a card nobody can
 * unblock without asking.
 */
export async function setWorkItemBlocked(
  resolved: ResolvedActor,
  input: { workItemId: string; blocked: boolean; reason?: string | null },
): Promise<Ok | Failed> {
  const reason = input.blocked ? (input.reason ?? '').trim().normalize('NFC') : null;
  if (input.blocked && !reason) return { ok: false, problem: 'blocked_reason_required' };

  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, input.workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    if (item.blocked === input.blocked && item.blockedReason === reason) {
      return { ok: true } as const;
    }

    await tx
      .update(workItem)
      .set({ blocked: input.blocked, blockedReason: reason, updatedAt: new Date() })
      .where(eq(workItem.id, input.workItemId));

    uow.emit({
      type: 'work_item.blocked_changed',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId: input.workItemId,
      blocked: input.blocked,
      reason,
      assigneeIds: item.assigneeIds,
    });

    return { ok: true } as const;
  });
}

/**
 * Soft delete — §4's 30-day recovery window, and a different concept from a
 * project's `archived_at`. The number is not released: human identifiers are
 * never reused, so the counter is untouched here on purpose.
 */
export async function deleteWorkItem(
  resolved: ResolvedActor,
  workItemId: string,
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await guardForWrite(tx, resolved, workItemId);
    if ('problem' in loaded) return loaded;
    const { item } = loaded;

    const now = new Date();
    await tx
      .update(workItem)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(workItem.id, workItemId));

    // Sub-items go with the parent. Leaving them would put orphaned work in a
    // list with no route to it — §4's "orphaned work" is the thing the state
    // deletion dialog exists to prevent, and the same reasoning applies here.
    await tx
      .update(workItem)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(workItem.parentId, workItemId), isNull(workItem.deletedAt)));

    uow.emit({
      type: 'work_item.deleted',
      workspaceId: resolved.workspace.id,
      projectId: item.projectId,
      workItemId,
      number: item.number,
      title: item.title,
    });

    return { ok: true } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Shared guards                                                             */
/* ------------------------------------------------------------------------- */

type LoadedItem = {
  item: typeof workItem.$inferSelect;
  project: ProjectRow;
};

/**
 * Load the item, then the three refusals in the order they have to be asked:
 * does it exist, may you edit it, and is its project archived.
 *
 * The order matters for the same reason it does in `projects.ts`: telling
 * somebody with no access that a project is archived is one bit more than they
 * are entitled to.
 *
 * Exported since slice 10, because `custom-fields.ts` writes a value onto an
 * item and must ask exactly these three questions in exactly this order. One
 * implementation, imported one way — a copy over there would be a copy of a
 * permission check, which is the one kind of duplication that fails silently.
 */
export async function guardForWrite(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
): Promise<LoadedItem | Failed> {
  const rows = await tx
    .select()
    .from(workItem)
    .where(and(eq(workItem.id, workItemId), isNull(workItem.deletedAt)))
    .limit(1);

  const item = rows[0];
  if (!item) return { ok: false, problem: 'not_found' };

  const target = await loadProject(tx, item.projectId);
  if (!target) return { ok: false, problem: 'not_found' };

  assertCan(resolved.actor, 'work_item.edit', projectResource(target));
  if (isArchived(target)) return { ok: false, problem: 'archived' };

  return { item, project: target };
}

/**
 * Inserts assignment rows, after checking every member is real.
 *
 * The composite foreign key already refuses a member from another workspace, so
 * this check is not the tenancy boundary — it is what turns a constraint
 * violation into a problem identifier a screen can translate (§13).
 */
async function writeAssignees(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
  memberIds: readonly string[],
): Promise<WorkItemProblem | null> {
  if (memberIds.length === 0) return null;

  const found = await tx
    .select({ id: workspaceMember.id })
    .from(workspaceMember)
    .where(and(inArray(workspaceMember.id, [...memberIds]), isNull(workspaceMember.deletedAt)));

  if (found.length !== memberIds.length) return 'unknown_member';

  await tx.insert(workItemAssignee).values(
    memberIds.map((memberId) => ({
      id: uuidv7(),
      workspaceId: resolved.workspace.id,
      workItemId,
      workspaceMemberId: memberId,
    })),
  );

  return null;
}

async function writeLabels(
  tx: TenantDb,
  resolved: ResolvedActor,
  workItemId: string,
  labelIds: readonly string[],
): Promise<WorkItemProblem | null> {
  if (labelIds.length === 0) return null;

  const found = await readLabelsByIds(tx, labelIds);
  if (found.length !== labelIds.length) return 'unknown_label';

  await tx.insert(workItemLabel).values(
    labelIds.map((labelId) => ({
      id: uuidv7(),
      workspaceId: resolved.workspace.id,
      workItemId,
      labelId,
    })),
  );

  return null;
}

/* ------------------------------------------------------------------------- */
/* What other services need to ask about work items                          */
/* ------------------------------------------------------------------------- */

/**
 * How many live items a workflow state holds.
 *
 * `workflow-states.ts` calls this to answer §4's "deleting a state holding
 * items requires choosing a migration target" — the guard it left as a TODO
 * because, in slice 4, there was no table to count.
 */
export async function countItemsInState(tx: TenantDb, stateId: string): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(workItem)
    .where(and(eq(workItem.stateId, stateId), isNull(workItem.deletedAt)));

  return rows[0]?.total ?? 0;
}

/** Moves every live item out of one state and into another, for that same rule. */
export async function migrateItemsBetweenStates(
  tx: TenantDb,
  from: string,
  to: string,
): Promise<number> {
  const moved = await tx
    .update(workItem)
    .set({ stateId: to, updatedAt: new Date() })
    .where(and(eq(workItem.stateId, from), isNull(workItem.deletedAt)))
    .returning({ id: workItem.id });

  return moved.length;
}

/** Re-exported so a caller needs one import to build the group list for a query. */
export { NONE };
