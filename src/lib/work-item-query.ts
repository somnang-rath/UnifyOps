import { z } from 'zod';

import { CUSTOM_PREFIX, MAX_TEXT_LENGTH, customFieldIdOf, isCalendarDate } from './custom-fields';
import { PRIORITIES, priorityWeight, type Priority } from './priorities';
import { MAX_QUERY_LENGTH } from './search';
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

export const GROUP_BY = [
  'state',
  'assignee',
  'priority',
  'label',
  'project',
  'cycle',
  'due',
  'day',
  'none',
] as const;
export type BuiltInGroupBy = (typeof GROUP_BY)[number];

/**
 * The groupings a person may pick from a control.
 *
 * `day` is missing on purpose. It is the calendar's grouping and the calendar
 * imposes it the way the board imposes `state` (§14 slice 12) — one key per
 * calendar day, which is only a *bounded* set of headings because the calendar
 * also fixes a month. Offered on a list with no month it would ask the builder
 * for a heading per day of an unbounded range, which is §16's unanchored scan
 * wearing a group-by. It stays in `GROUP_BY` so the URL round-trips it and the
 * builder has one branch for it; it stays out of the picker so nobody can ask
 * for it without the month that makes it finite.
 *
 * **`due` is in the picker**, and the contrast with `day` is the whole reason
 * this list exists. Both key on a due date; only one of them has a finite set of
 * keys without a second filter to bound it. `day` is one heading per calendar
 * day of whatever range the rows happen to span; `due` is always exactly the
 * five buckets §7.3 names — overdue, today, this week, later, no date — so it is
 * safe on any list, anchored or not, and useful on most of them.
 */
export const PICKABLE_GROUP_BY = GROUP_BY.filter(
  (value): value is Exclude<BuiltInGroupBy, 'day'> => value !== 'day',
);

/**
 * The built-in groupings, plus one per custom field (§6-4: "Filter, group, show
 * in views").
 *
 * A custom grouping is `custom:{fieldId}` rather than a second `groupField`
 * parameter beside `by`, because everything downstream — the URL, the group
 * keys, the heading list — already treats a grouping as one opaque string, and
 * two parameters that must agree are two parameters that eventually will not.
 * §9 spells the filter branch the same way, so there is one phrasing.
 *
 * Only the kinds with an enumerable set of keys can be grouped by — see
 * `GROUPABLE_KINDS`. The DSL cannot check that (it does not know a field's
 * kind), so the caller that builds the headings does: an ungroupable field
 * produces no headings, which is the same "no groups" the builder already
 * handles.
 */
export type GroupBy = BuiltInGroupBy | `${typeof CUSTOM_PREFIX}${string}`;

export function isGroupBy(value: string): value is GroupBy {
  return (GROUP_BY as readonly string[]).includes(value) || customFieldIdOf(value) !== null;
}

/**
 * Which renderer draws the result.
 *
 * Presentation rather than filtering, and in this module anyway, because §5
 * says "any view state is a URL" and because the filter bar rewrites the whole
 * query string on every change — a `view` kept outside the DSL would be dropped
 * the first time somebody changed a filter.
 */
export const VIEWS = ['list', 'board', 'table', 'calendar'] as const;
export type View = (typeof VIEWS)[number];

/** `YYYY-MM`. The calendar's month, and the only shape the URL accepts. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** The month a `YYYY-MM-DD` falls in. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * The first and last calendar dates of a month, inclusive.
 *
 * Arithmetic on the string rather than through `Date`, because a `Date`
 * constructed from `YYYY-MM` is parsed as UTC midnight and formatted in the
 * viewer's zone — which in Phnom Penh (UTC+7) is the same instant and in
 * Honolulu is the previous month. Every date in this product is a calendar date
 * in the **workspace's** zone (§17-13), and the safest way to keep one that way
 * is never to let it become an instant.
 */
export function monthRange(month: string): { first: string; last: string } {
  const [yearText, monthText] = month.split('-') as [string, string];
  const year = Number(yearText);
  const index = Number(monthText);
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}` };
}

/** Every calendar date of a month, in order. The calendar's group keys. */
export function monthDays(month: string): string[] {
  const { last } = monthRange(month);
  const count = Number(last.slice(8));
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

/** The month `offset` months either side of this one. */
export function shiftMonth(month: string, offset: number): string {
  const [yearText, monthText] = month.split('-') as [string, string];
  const total = Number(yearText) * 12 + (Number(monthText) - 1) + offset;
  const year = Math.floor(total / 12);
  const index = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(index).padStart(2, '0')}`;
}

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
 *
 * `soon` is §7.8's digest window and the one that takes a second date: open work
 * due on or before a **horizon** the caller supplies, which is where "and what
 * is already overdue" comes from — everything late is on or before any horizon
 * at or after today. The horizon is a fetch option beside `today` rather than a
 * URL parameter, for the reason above: the digest's horizon is the workspace's
 * next *working* day, which is a fact about a company's calendar on one evening
 * and not a question anybody would want frozen into a shared link.
 */
export const DUE_WINDOWS = ['overdue', 'today', 'week', 'soon', 'none', 'any'] as const;
export type DueWindow = (typeof DUE_WINDOWS)[number];

const uuid = z.string().uuid();
const idOrNone = z.union([uuid, z.literal(NONE)]);

/** How many rows one group's page holds. A board column, not a whole list. */
export const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * One custom-field filter — §9's "a `custom:{fieldId}` filter is one branch in
 * the builder", as a value.
 *
 * Five operators rather than one per kind, because several kinds ask the same
 * question: a select, a multi-select and a user field are all "is it one of
 * these ids", and a number and a date are both "is it between these two". The
 * *kind* decides which operator a field offers and which column the builder
 * reads; the operator decides the shape of the comparison. That split is what
 * keeps this a closed set while §6-4's seven kinds all remain filterable.
 *
 *   `in`    — one of these ids (select, multi-select, user). `none` is allowed
 *             and means "has no value", exactly as it does for assignees.
 *   `is`    — a checkbox is ticked, or is not.
 *   `has`   — free text contains this (text).
 *   `range` — between two bounds, either of which may be open (number, date).
 *   `set`   — has any value at all, or none. Available on every kind, because
 *             "which items has nobody filled this in for" is the question a
 *             company asks a fortnight after adding a field.
 */
export type CustomFilter =
  | { fieldId: string; op: 'in'; ids: string[] }
  | { fieldId: string; op: 'is'; value: boolean }
  | { fieldId: string; op: 'has'; text: string }
  | { fieldId: string; op: 'range'; from: string | null; to: string | null }
  | { fieldId: string; op: 'set'; value: boolean };

export type CustomFilterOp = CustomFilter['op'];

/**
 * A range bound is a number or a calendar date, and nothing else.
 *
 * Checked here rather than left to the cast in the builder: both are bound as
 * parameters, so the worst a bad bound could do is raise a Postgres error — but
 * that error reaches somebody who pasted a link as a 500, and a filter DSL that
 * already drops what it does not understand should drop this too.
 */
const rangeBound = z
  .string()
  .refine((value) => /^-?\d+(\.\d+)?$/.test(value) || isCalendarDate(value));

const customFilterSchema = z.discriminatedUnion('op', [
  z.object({ fieldId: uuid, op: z.literal('in'), ids: z.array(idOrNone).min(1) }).strict(),
  z.object({ fieldId: uuid, op: z.literal('is'), value: z.boolean() }).strict(),
  z.object({ fieldId: uuid, op: z.literal('has'), text: z.string().min(1).max(MAX_TEXT_LENGTH) }).strict(),
  z
    .object({
      fieldId: uuid,
      op: z.literal('range'),
      from: rangeBound.nullable(),
      to: rangeBound.nullable(),
    })
    .strict()
    // Both bounds open is not a range, it is the absence of a filter — and it
    // would round-trip through the URL as a control that looks set and does
    // nothing.
    .refine((value) => value.from !== null || value.to !== null),
  z.object({ fieldId: uuid, op: z.literal('set'), value: z.boolean() }).strict(),
]);

export const filtersSchema = z
  .object({
    /** Anchors the query. Empty means "not anchored by project" — see `anchorOf`. */
    projectIds: z.array(uuid).default([]),
    stateIds: z.array(uuid).default([]),
    stateGroups: z.array(z.enum(STATE_GROUPS)).default([]),
    /** `none` is the unassigned bucket, which is one of §7.4's Needs Attention rows. */
    assignees: z.array(idOrNone).default([]),
    labels: z.array(idOrNone).default([]),
    /**
     * §7.6's cycles. `none` is the backlog — work planned into nothing — which
     * is the other half of every sprint-planning screen and the reason this
     * takes the same `idOrNone` shape assignees and labels do.
     */
    cycleIds: z.array(idOrNone).default([]),
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
    /**
     * The calendar's month, as `YYYY-MM` — every item whose **due date** falls
     * in it (§14 slice 12).
     *
     * A filter rather than a fetch option, unlike the `soon` horizon beside it,
     * and the difference is worth stating because the two look alike. A horizon
     * is the digest's own arithmetic on one evening and means something
     * different tomorrow, so freezing it into a shared link would be a lie. A
     * month is not: "September" is September when the colleague opens the link,
     * which is exactly §5's shareable view state.
     *
     * It filters on `due_date` and nothing else, so undated work is *outside*
     * every month rather than in all of them. A calendar cell for "no date"
     * would need this predicate to be `or due_date is null`, which would make
     * the filter mean "September, plus everything ever" — the list already
     * answers that question honestly with `d=none`.
     */
    month: z.string().refine(isMonth).optional(),
    /**
     * §7.4's fifth Needs Attention row: "stale (>N days)".
     *
     * The number of **working** days an item may go without an update before it
     * counts as neglected, and §4 is specific about the unit: "'Stale > N days'
     * counts **working** days from the same §6-1 setting, or every Monday
     * morning flags Friday's work and the surface trains people to ignore it."
     * Working days exclude the company's holidays too, which in this market is
     * the difference between a useful surface and one that fires on the entire
     * workspace the morning everyone comes back from Khmer New Year (§17-18).
     *
     * **N is in the URL; the date it resolves to is not.** That is the same
     * split `soon` and its horizon make, and it is here for the same reason:
     * "five working days" means the same thing next Tuesday, where the instant
     * it resolves to today would silently become a different question overnight.
     * The service asks the database for the cutoff — one call to `stale_before`,
     * §9's fourth working-day function — and hands it to the builder as a fetch
     * option beside `today`.
     *
     * Undefined is "do not filter by staleness", which is every surface but one.
     */
    stale: z.number().int().min(1).max(90).optional(),
    /**
     * §7.9's search text, and §14 slice 14's whole reason for touching this file.
     *
     * A **filter** rather than a separate query, and that is the decision the
     * rest of the slice rests on. §7.9's results screen offers "include
     * archived" — which is `includeArchivedProjects`, already here — and sections
     * that page, group and sort like any other list. Written as a second query
     * beside the builder it would be a second answer to "what is overdue", which
     * is the one thing §9's "one DSL, one builder" exists to prevent; written as
     * a filter it inherits the counts query, the `LATERAL` page, the keyset
     * cursors, the archived default and every §10 re-check for free.
     *
     * Stored as typed, not normalized. `normalizeQuery` runs where the text
     * meets the database, so what the URL carries is what the person typed —
     * which is what the search box has to show back to them, and what a
     * colleague opening the link should see in it.
     *
     * The cap is `MAX_QUERY_LENGTH` and the floor is not enforced here: a
     * one-character `q` is a legal query string that finds nothing useful, and
     * the *service* is the layer that decides a query is too short to run. The
     * DSL's job is to round-trip what a link says.
     */
    text: z.string().min(1).max(MAX_QUERY_LENGTH).optional(),
    /**
     * §6-4's custom fields, at most one filter per field (a second one on the
     * same field would be an AND of two conditions on one control, which no
     * screen can express and nobody asked for).
     */
    custom: z.array(customFilterSchema).default([]),
  })
  .strict();

export type WorkItemFilters = z.infer<typeof filtersSchema>;

export const workItemQuerySchema = z
  .object({
    filters: filtersSchema,
    view: z.enum(VIEWS).default('list'),
    groupBy: z
      .string()
      .refine(isGroupBy)
      .default('state')
      .transform((value) => value as GroupBy),
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
 * The anchors are the real surfaces: a project (the List view and the board), a
 * set of people (My Work, workload), one parent (sub-items), and from slice 11
 * one cycle (§7.6's active view). A workspace-wide "all work" view is a §4
 * should-have, and when it is built it has to arrive with its own anchor rather
 * than by deleting this rule — which is what adding `cycle` here did.
 *
 * **Slice 14 added a filter and no anchor, and that is the point worth keeping.**
 * §7.9's search is workspace-wide by nature, so the tempting move was a fifth
 * anchor — "a text predicate rides a GIN index, therefore it is bounded". It is
 * not bounded enough: below three characters no trigram index can serve a
 * `LIKE '%ab%'` at all, and a one-letter Latin prefix matches most of a company.
 * Search does not need one anyway, because slice 13 already built the anchor it
 * uses — `resolveWorkspaceScope` enumerates the projects the actor may see
 * *before* the query is built, exactly as My Work and Needs Attention do, and an
 * enumerated project set is the `project` anchor below. So the §16 invariant is
 * untouched by the one feature that most looked like it would have to weaken it.
 */
export function anchorOf(
  query: WorkItemQuery,
): 'project' | 'assignee' | 'parent' | 'cycle' | null {
  const { filters } = query;
  if (filters.projectIds.length > 0) return 'project';
  // A **named** person, never the `none` sentinel on its own. "Everything
  // assigned to nobody" is the whole workspace's unowned backlog, which is
  // exactly the §16 scan wearing a filter — the same distinction slice 11 drew
  // for a cycle's `none`, applied here in slice 13 when §7.4's unassigned row
  // made the query reachable from a screen for the first time.
  if (filters.assignees.some((value) => value !== NONE)) return 'assignee';
  if (filters.parentId !== undefined) return 'parent';
  // A cycle belongs to one project and holds a planned, bounded set of items,
  // so naming one bounds the scan at least as tightly as naming the project
  // does. **`none` alone does not anchor**: "everything in no cycle" is the
  // whole backlog of the whole workspace, which is exactly the unanchored scan
  // §16 refuses — so the anchor requires a real id, not merely a filter. The
  // assignee anchor above says the same thing and did not always: it counted
  // any non-empty list until slice 13, which is a defect this comment had
  // already described and the code above it did not implement.
  if (filters.cycleIds.some((value) => value !== NONE)) return 'cycle';
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
  cycleIds: 'c',
  priorities: 'pr',
  blocked: 'b',
  due: 'd',
  stale: 'st',
  month: 'm',
  /** §7.9's query text. `q`, because that is the parameter every search box on the web uses. */
  text: 'q',
  parentId: 'parent',
  includeArchivedProjects: 'arch',
  /**
   * Repeated, one per filtered field: `cf=<fieldId>~<op>~<payload>`. A repeated
   * parameter rather than a comma-joined list, because a `has` payload is free
   * text a person typed and a comma in it is ordinary.
   */
  custom: 'cf',
  view: 'view',
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

/** Every value of a repeated parameter. Only `cf` is repeated. */
function readAll(params: ParamBag, key: string): string[] {
  const value = params[key];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
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
 * `<fieldId>~<op>~<payload>`, with the payload percent-encoded.
 *
 * `~` is the separator and `encodeURIComponent` leaves it alone, so it is
 * escaped by hand — the same correction `encodeCursor` makes for `.`, and for
 * the same reason: a `has` payload is text somebody typed, and one tilde in it
 * would split the filter into four parts that decode as nothing.
 */
function encodeCustomFilter(filter: CustomFilter): string {
  const payload =
    filter.op === 'in'
      ? filter.ids.join(',')
      : filter.op === 'has'
        ? filter.text
        : filter.op === 'range'
          ? `${filter.from ?? ''}|${filter.to ?? ''}`
          : filter.value
            ? '1'
            : '0';

  return `${filter.fieldId}~${filter.op}~${encodeURIComponent(payload).replaceAll('~', '%7E')}`;
}

/** Null for anything that does not decode — one dropped filter, never an error page. */
function decodeCustomFilter(encoded: string): CustomFilter | null {
  const parts = encoded.split('~');
  if (parts.length !== 3) return null;
  const [fieldId, op, rawPayload] = parts as [string, string, string];

  let payload: string;
  try {
    payload = decodeURIComponent(rawPayload);
  } catch {
    // A malformed escape, from a link a chat client truncated. The filter is
    // lost, which widens the list; the page still renders.
    return null;
  }

  const candidate =
    op === 'in'
      ? { fieldId, op, ids: payload.split(',').filter(Boolean) }
      : op === 'has'
        ? { fieldId, op, text: payload }
        : op === 'range'
          ? (() => {
              const [from = '', to = ''] = payload.split('|');
              return { fieldId, op, from: from || null, to: to || null };
            })()
          : op === 'is' || op === 'set'
            ? { fieldId, op, value: payload === '1' }
            : null;

  if (candidate === null) return null;
  const parsed = customFilterSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
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
  // §7.4's staleness threshold, in working days. Out-of-range or unparseable is
  // dropped rather than clamped: a clamp would quietly answer a different
  // question than the link asked, and the surface that needs this supplies its
  // own default when the URL says nothing.
  const staleRaw = Number(read(params, PARAM.stale));

  const candidate = {
    filters: {
      projectIds: keep(readList(params, PARAM.projectIds), isUuid),
      stateIds: keep(readList(params, PARAM.stateIds), isUuid),
      stateGroups: keep(readList(params, PARAM.stateGroups), (v) =>
        (STATE_GROUPS as readonly string[]).includes(v),
      ),
      assignees: keep(readList(params, PARAM.assignees), isUuidOrNone),
      labels: keep(readList(params, PARAM.labels), isUuidOrNone),
      cycleIds: keep(readList(params, PARAM.cycleIds), isUuidOrNone),
      priorities: keep(readList(params, PARAM.priorities), (v) =>
        (PRIORITIES as readonly string[]).includes(v),
      ),
      blocked: blockedRaw === '1' ? true : blockedRaw === '0' ? false : undefined,
      due: (DUE_WINDOWS as readonly string[]).includes(read(params, PARAM.due) ?? '')
        ? (read(params, PARAM.due) as DueWindow)
        : 'any',
      // A month that is not `YYYY-MM` is dropped like any other unparseable
      // token; the calendar falls back to the workspace's current month, which
      // is the only month it could honestly show instead.
      month: isMonth(read(params, PARAM.month) ?? '') ? read(params, PARAM.month) : undefined,
      stale:
        Number.isInteger(staleRaw) && staleRaw >= 1 && staleRaw <= 90 ? staleRaw : undefined,
      // Trimmed only, and capped by the schema. Nothing else is done to it here:
      // the person's own text is what the search box shows back to them, and
      // `normalizeQuery` runs where the text meets the database.
      text: (read(params, PARAM.text) ?? '').trim() || undefined,
      // `parent=root` is "top-level only", which is a different request from
      // "any parent", and both have to survive the round trip.
      parentId:
        parentRaw === 'root' ? null : parentRaw && isUuid(parentRaw) ? parentRaw : undefined,
      includeArchivedProjects: read(params, PARAM.includeArchivedProjects) === '1',
      // One filter per field: a URL carrying two conditions on one field is
      // either hand-edited or from a version that allowed it, and the first is
      // the one the controls can show.
      custom: dedupeByField(
        readAll(params, PARAM.custom)
          .map(decodeCustomFilter)
          .filter((filter): filter is CustomFilter => filter !== null),
      ),
    },
    view: (VIEWS as readonly string[]).includes(read(params, PARAM.view) ?? '')
      ? (read(params, PARAM.view) as View)
      : 'list',
    groupBy: isGroupBy(read(params, PARAM.groupBy) ?? '')
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
  list(PARAM.cycleIds, filters.cycleIds);
  list(PARAM.priorities, filters.priorities);

  if (filters.blocked !== undefined) params.set(PARAM.blocked, filters.blocked ? '1' : '0');
  if (filters.due !== 'any') params.set(PARAM.due, filters.due);
  if (filters.month !== undefined) params.set(PARAM.month, filters.month);
  if (filters.stale !== undefined) params.set(PARAM.stale, String(filters.stale));
  if (filters.text !== undefined) params.set(PARAM.text, filters.text);
  if (filters.parentId === null) params.set(PARAM.parentId, 'root');
  else if (filters.parentId !== undefined) params.set(PARAM.parentId, filters.parentId);
  if (filters.includeArchivedProjects) params.set(PARAM.includeArchivedProjects, '1');
  // Appended, not set: this is the one repeated parameter, and `set` would keep
  // only the last field somebody filtered on.
  for (const filter of filters.custom) params.append(PARAM.custom, encodeCustomFilter(filter));

  if (query.view !== 'list') params.set(PARAM.view, query.view);
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
    f.cycleIds.length > 0 ||
    f.priorities.length > 0 ||
    f.blocked !== undefined ||
    f.due !== 'any' ||
    // The month is deliberately not counted. The calendar always sets one — it
    // is that view's axis rather than a narrowing somebody chose — so counting
    // it would offer "clear the filters" on a screen with none applied, and
    // clearing it would leave the calendar with no month to draw.
    // Counted, unlike the month, and the difference is which screen sets it.
    // The calendar sets a month on every render, so counting that would report
    // filters on a screen nobody had filtered. Nothing sets `stale` except
    // §7.4's Needs Attention, which has no filter bar at all — so anywhere this
    // function is asked, a staleness threshold is a narrowing somebody chose
    // (or pasted), and "clear" should take it away.
    f.stale !== undefined ||
    // Counted. §7.9's results screen is reached *by* typing, so its search text
    // is never the axis a view imposes the way the calendar's month is — it is
    // always the narrowing somebody asked for, and "clear" should take it away.
    f.text !== undefined ||
    f.includeArchivedProjects ||
    f.custom.length > 0
  );
}

/** The first filter on each field, in the order they arrived. */
function dedupeByField(filters: readonly CustomFilter[]): CustomFilter[] {
  const seen = new Set<string>();
  return filters.filter((filter) => {
    if (seen.has(filter.fieldId)) return false;
    seen.add(filter.fieldId);
    return true;
  });
}

/**
 * The custom filter on one field, or null.
 *
 * The filter bar draws one control per field and needs to know what it is
 * currently set to; a linear scan over at most `MAX_FIELDS_PER_PROJECT` entries
 * is not worth a map, and a map would be a second representation to keep in
 * step with the array the URL round-trips.
 */
export function customFilterFor(
  query: WorkItemQuery,
  fieldId: string,
): CustomFilter | null {
  return query.filters.custom.find((filter) => filter.fieldId === fieldId) ?? null;
}

/**
 * The same query with one field's filter replaced, or removed when `next` is
 * null. Everything else — including the other fields' filters — is preserved.
 */
export function withCustomFilter(
  query: WorkItemQuery,
  fieldId: string,
  next: CustomFilter | null,
): WorkItemQuery {
  const others = query.filters.custom.filter((filter) => filter.fieldId !== fieldId);
  return {
    ...query,
    filters: { ...query.filters, custom: next ? [...others, next] : others },
  };
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
