import { z } from 'zod';

import { PRIORITIES, priorityWeight, type Priority } from './priorities';
import { STATE_GROUPS } from './state-groups';

/**
 * The list query's filter DSL, its URL form, and its cursors (§9).
 *
 * **One** Zod DSL, and this is it. Every surface that lists work — the List
 * view, the board in slice 6, My Work, Needs Attention, a saved view, the Phase
 * 2 MCP tool §19.6 explicitly forbids from re-implementing it — parses into
 * this shape and hands it to the one builder in
 * `src/server/queries/work-items.ts`. A second query written beside it is how a
 * product ends up with two different answers to "what is overdue".
 *
 * In `src/lib` rather than `src/server` because both sides genuinely run it:
 * the filter bar builds a URL in the browser as you click, and the server
 * parses that same URL back. One implementation, so a filter the UI can express
 * is a filter the server understands, and vice versa — the same bargain
 * `recipients.ts` makes between the invite form's chips and the send.
 *
 * §5 asks any view state to be a URL you can paste in chat. That is what
 * `toSearchParams` and `parseWorkItemQuery` are: an exact round trip, pinned by
 * a test, so the colleague who opens the link sees what you saw.
 *
 * Cursors are deliberately *not* in the URL. A filter is a description of what
 * you want to see and survives being shared; a cursor is a position in one
 * person's scroll and does not.
 */

/** The sentinel for "has none of these" in an id-valued filter. */
export const NONE = 'none' as const;

export const GROUP_BY = ['state', 'assignee', 'priority', 'label', 'project', 'none'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const SORT_FIELDS = ['rank', 'created', 'updated', 'due', 'priority', 'number'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type SortDirection = 'asc' | 'desc';

/**
 * The named due-date windows, resolved against the **workspace** timezone by
 * the caller and never against the viewer's device (§4, §17-13).
 *
 * They are names rather than dates on purpose: a URL holding `d=overdue` still
 * means "overdue" tomorrow, while one holding a resolved date silently becomes
 * a different question overnight.
 */
export const DUE_WINDOWS = ['overdue', 'today', 'week', 'none', 'any'] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

const uuid = z.string().uuid();
const idOrNone = z.union([uuid, z.literal(NONE)]);

/** How many rows one group's page holds. A board column, not a whole list. */
export const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const filtersSchema = z
  .object({
    /** Anchors the query. Empty means "not anchored by project" — see `anchorOf`. */
    projectIds: z.array(uuid).default([]),
    stateIds: z.array(uuid).default([]),
    stateGroups: z.array(z.enum(STATE_GROUPS)).default([]),
    /** `none` is the unassigned bucket, which is one of §7.4's Needs Attention rows. */
    assignees: z.array(idOrNone).default([]),
    labels: z.array(idOrNone).default([]),
    priorities: z.array(z.enum(PRIORITIES)).default([]),
    /** Undefined means "either"; §4 makes this a flag rather than a state. */
    blocked: z.boolean().optional(),
    due: z.enum(DUE_WINDOWS).default('any'),
    /**
     * `null` asks for top-level items only — the List view's default, because a
     * flat list that interleaves parents and their sub-items reads as
     * duplicates. A uuid asks for one item's children.
     */
    parentId: z.union([uuid, z.null()]).optional(),
    /**
     * §9: archived is a default filter in the query builder, not a view that
     * hides rows — four legitimate screens have to be able to see them (§17-17).
     */
    includeArchivedProjects: z.boolean().default(false),
  })
  .strict();

export type WorkItemFilters = z.infer<typeof filtersSchema>;

export const workItemQuerySchema = z
  .object({
    filters: filtersSchema,
    groupBy: z.enum(GROUP_BY).default('state'),
    sort: z.enum(SORT_FIELDS).default('rank'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  })
  .strict();

export type WorkItemQuery = z.infer<typeof workItemQuerySchema>;

/** The empty query, for a caller that only wants to override a field or two. */
export function emptyQuery(): WorkItemQuery {
  return workItemQuerySchema.parse({ filters: {} });
}

/**
 * What anchors this query to a bounded set of rows, or `null` if nothing does.
 *
 * §9 and §16: an `invariant` must refuse to emit an unanchored workspace-wide
 * scan — "the query that otherwise takes production down at 3am". The invariant
 * itself lives in the builder, where the SQL is actually emitted; the *rule* is
 * here so the UI can grey out a control rather than let someone click into an
 * error.
 *
 * The three anchors are the three real surfaces: a project (the List view and
 * the board), a set of people (My Work, workload), and one parent (sub-items).
 * A workspace-wide "all work" view is a §4 should-have, and when it is built it
 * has to arrive with its own anchor rather than by deleting this rule.
 */
export function anchorOf(query: WorkItemQuery): 'project' | 'assignee' | 'parent' | null {
  const { filters } = query;
  if (filters.projectIds.length > 0) return 'project';
  if (filters.assignees.length > 0) return 'assignee';
  if (filters.parentId !== undefined) return 'parent';
  return null;
}

export function isAnchored(query: WorkItemQuery): boolean {
  return anchorOf(query) !== null;
}

/* ------------------------------------------------------------------------- */
/* The URL form                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Short parameter names, because these end up in a link someone pastes into a
 * chat message. Frozen, and the only names the parser recognises — a query
 * string is user input, and an unrecognised key is ignored rather than trusted.
 */
const PARAM = {
  projectIds: 'p',
  stateIds: 's',
  stateGroups: 'g',
  assignees: 'a',
  labels: 'l',
  priorities: 'pr',
  blocked: 'b',
  due: 'd',
  parentId: 'parent',
  includeArchivedProjects: 'arch',
  groupBy: 'by',
  sort: 'sort',
  direction: 'dir',
  limit: 'n',
} as const;

type ParamBag = Record<string, string | string[] | undefined>;

function read(params: ParamBag, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** `a=1,2,3` rather than `a=1&a=2&a=3`: shorter, and one shape to parse. */
function readList(params: ParamBag, key: string): string[] {
  const raw = read(params, key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Parses a query string into the DSL, discarding anything that does not fit.
 *
 * Discarding rather than failing is the deliberate choice: a link is pasted
 * into chat, truncated by a client, edited by hand, or produced by a version of
 * the app that has since dropped a filter. Rejecting the whole URL over one bad
 * token would show a stranger an error page instead of a list; dropping the
 * token shows them the list, slightly wider than intended. What is *not*
 * tolerated is a malformed value reaching SQL — every id is checked against a
 * uuid, every enum against its frozen set, and the builder takes column
 * identifiers only from its own maps.
 */
export function parseWorkItemQuery(params: ParamBag): WorkItemQuery {
  const keep = <T>(values: string[], guard: (value: string) => boolean): T[] =>
    values.filter(guard) as T[];

  const isUuid = (value: string) => uuid.safeParse(value).success;
  const isUuidOrNone = (value: string) => value === NONE || isUuid(value);

  const blockedRaw = read(params, PARAM.blocked);
  const parentRaw = read(params, PARAM.parentId);
  const limitRaw = Number(read(params, PARAM.limit));

  const candidate = {
    filters: {
      projectIds: keep(readList(params, PARAM.projectIds), isUuid),
      stateIds: keep(readList(params, PARAM.stateIds), isUuid),
      stateGroups: keep(readList(params, PARAM.stateGroups), (v) =>
        (STATE_GROUPS as readonly string[]).includes(v),
      ),
      assignees: keep(readList(params, PARAM.assignees), isUuidOrNone),
      labels: keep(readList(params, PARAM.labels), isUuidOrNone),
      priorities: keep(readList(params, PARAM.priorities), (v) =>
        (PRIORITIES as readonly string[]).includes(v),
      ),
      blocked: blockedRaw === '1' ? true : blockedRaw === '0' ? false : undefined,
      due: (DUE_WINDOWS as readonly string[]).includes(read(params, PARAM.due) ?? '')
        ? (read(params, PARAM.due) as DueWindow)
        : 'any',
      // `parent=root` is "top-level only", which is a different request from
      // "any parent", and both have to survive the round trip.
      parentId:
        parentRaw === 'root' ? null : parentRaw && isUuid(parentRaw) ? parentRaw : undefined,
      includeArchivedProjects: read(params, PARAM.includeArchivedProjects) === '1',
    },
    groupBy: (GROUP_BY as readonly string[]).includes(read(params, PARAM.groupBy) ?? '')
      ? (read(params, PARAM.groupBy) as GroupBy)
      : 'state',
    sort: (SORT_FIELDS as readonly string[]).includes(read(params, PARAM.sort) ?? '')
      ? (read(params, PARAM.sort) as SortField)
      : 'rank',
    direction: read(params, PARAM.direction) === 'desc' ? 'desc' : 'asc',
    limit:
      Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT,
  };

  return workItemQuerySchema.parse(candidate);
}

/**
 * The inverse. Only non-default values are written, so a link to an unfiltered
 * list is the bare path — the URL says what was chosen and nothing else.
 */
export function toSearchParams(query: WorkItemQuery): URLSearchParams {
  const params = new URLSearchParams();
  const { filters } = query;

  const list = (key: string, values: readonly string[]) => {
    if (values.length > 0) params.set(key, values.join(','));
  };

  list(PARAM.projectIds, filters.projectIds);
  list(PARAM.stateIds, filters.stateIds);
  list(PARAM.stateGroups, filters.stateGroups);
  list(PARAM.assignees, filters.assignees);
  list(PARAM.labels, filters.labels);
  list(PARAM.priorities, filters.priorities);

  if (filters.blocked !== undefined) params.set(PARAM.blocked, filters.blocked ? '1' : '0');
  if (filters.due !== 'any') params.set(PARAM.due, filters.due);
  if (filters.parentId === null) params.set(PARAM.parentId, 'root');
  else if (filters.parentId !== undefined) params.set(PARAM.parentId, filters.parentId);
  if (filters.includeArchivedProjects) params.set(PARAM.includeArchivedProjects, '1');

  if (query.groupBy !== 'state') params.set(PARAM.groupBy, query.groupBy);
  if (query.sort !== 'rank') params.set(PARAM.sort, query.sort);
  if (query.direction !== 'asc') params.set(PARAM.direction, query.direction);
  if (query.limit !== DEFAULT_LIMIT) params.set(PARAM.limit, String(query.limit));

  return params;
}

/** `?a=b` or `''` — what a `Link` href appends. */
export function toQueryString(query: WorkItemQuery): string {
  const params = toSearchParams(query);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

/**
 * True when the query asks for anything narrower than "everything in scope".
 * The filter bar uses it to decide whether to offer "clear".
 */
export function hasActiveFilters(query: WorkItemQuery): boolean {
  const f = query.filters;
  return (
    f.stateIds.length > 0 ||
    f.stateGroups.length > 0 ||
    f.assignees.length > 0 ||
    f.labels.length > 0 ||
    f.priorities.length > 0 ||
    f.blocked !== undefined ||
    f.due !== 'any' ||
    f.includeArchivedProjects
  );
}

/* ------------------------------------------------------------------------- */
/* Cursors                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * A keyset cursor: the sort tuple of the last row a page returned.
 *
 * Keyset only, never an offset (§9). Offset pagination degrades exactly when a
 * workspace becomes valuable — page 40 of a 50k-item list makes the database
 * count 2,000 rows it will throw away — and it silently skips or repeats rows
 * when somebody inserts while you are reading, which on a board is indis-
 * tinguishable from a bug.
 *
 * The `sort` field travels with the cursor so a page cannot be resumed against
 * a different ordering. A cursor whose sort no longer matches is discarded and
 * the group starts again, which is correct: the position it described does not
 * exist in the new order.
 */
export type Cursor = {
  sort: SortField;
  /**
   * The primary sort value, as text. Null is a real value here — an item with
   * no due date sorts last, and resuming after it has to be expressible.
   */
  value: string | null;
  /** The id tiebreak, so the total order is total and no row is skipped. */
  id: string;
};

const cursorSchema = z
  .object({
    sort: z.enum(SORT_FIELDS),
    value: z.union([z.string(), z.null()]),
    id: uuid,
  })
  .strict();

/**
 * `sort.value.id`, percent-encoded.
 *
 * Not base64: `Buffer` is a Node global and this module is imported by the
 * filter bar, which runs in a browser. Three URL-safe segments need no
 * polyfill, survive being put in a query string, and are legible in a log when
 * a paging bug has to be diagnosed from one.
 */
const NULL_VALUE = '~';

export function encodeCursor(cursor: Cursor): string {
  // `.` is the separator and `encodeURIComponent` does not escape it — an ISO
  // timestamp carries one, so it is escaped by hand or every `created` cursor
  // splits into four parts and decodes as nothing.
  const value =
    cursor.value === null ? NULL_VALUE : encodeURIComponent(cursor.value).replaceAll('.', '%2E');
  return `${cursor.sort}.${value}.${cursor.id}`;
}

/** Null for anything that does not decode, or that was cut for a different sort. */
export function decodeCursor(encoded: string | null | undefined, sort: SortField): Cursor | null {
  if (!encoded) return null;

  const parts = encoded.split('.');
  if (parts.length !== 3) return null;

  try {
    const candidate = cursorSchema.safeParse({
      sort: parts[0],
      value: parts[1] === NULL_VALUE ? null : decodeURIComponent(parts[1]!),
      id: parts[2],
    });
    if (!candidate.success) return null;

    return candidate.data.sort === sort ? candidate.data : null;
  } catch {
    // decodeURIComponent throws on a malformed escape. A cursor is a position,
    // never data — losing one costs a page, so it is dropped, not reported.
    return null;
  }
}

/**
 * The cursor pointing just past a row, for the sort in force.
 *
 * `priority` sorts by §12's order rather than alphabetically, so the cursor
 * carries the weight and not the name — otherwise "high" would follow
 * "cancelled" and precede "low", and the second page of a priority-sorted group
 * would be a different list from the first.
 */
export function cursorFor(
  row: {
    id: string;
    rank: string;
    createdAt: Date;
    updatedAt: Date;
    dueDate: string | null;
    priority: Priority;
    number: number;
  },
  sort: SortField,
): Cursor {
  const value: string | null =
    sort === 'rank'
      ? row.rank
      : sort === 'created'
        ? row.createdAt.toISOString()
        : sort === 'updated'
          ? row.updatedAt.toISOString()
          : sort === 'due'
            ? row.dueDate
            : sort === 'priority'
              ? String(priorityWeight(row.priority))
              : String(row.number);

  return { sort, value, id: row.id };
}
