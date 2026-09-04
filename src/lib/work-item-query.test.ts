import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  GROUP_BY,
  NONE,
  PICKABLE_GROUP_BY,
  anchorOf,
  cursorFor,
  decodeCursor,
  emptyQuery,
  encodeCursor,
  hasActiveFilters,
  isAnchored,
  monthDays,
  monthOf,
  monthRange,
  parseWorkItemQuery,
  shiftMonth,
  toQueryString,
  toSearchParams,
} from './work-item-query';
import type { WorkItemQuery } from './work-item-query';

/**
 * §15 asks for unit tests on the filter DSL. The three things worth pinning are
 * the three the rest of the product leans on: the URL round trip (§5 —
 * "paste it in chat and a colleague sees exactly what you see"), the anchor
 * rule (§9, §16 — no unanchored workspace-wide scan), and the cursor contract
 * (§9 — keyset only).
 */

const project = '018f8f4a-0000-7000-8000-000000000001';
const other = '018f8f4a-0000-7000-8000-000000000002';
const member = '018f8f4a-0000-7000-8000-000000000003';
const item = '018f8f4a-0000-7000-8000-000000000004';
const sprint = '018f8f4a-0000-7000-8000-000000000005';

const withFilters = (filters: Record<string, unknown>) =>
  parseWorkItemQuery(
    Object.fromEntries(toSearchParams({ ...emptyQuery(), filters: { ...emptyQuery().filters, ...filters } })),
  );

describe('the URL round trip', () => {
  it('survives every filter it can express', () => {
    const original: WorkItemQuery = {
      ...emptyQuery(),
      filters: {
        ...emptyQuery().filters,
        projectIds: [project, other],
        stateGroups: ['started', 'completed'],
        assignees: [member, NONE],
        cycleIds: [sprint, NONE],
        priorities: ['urgent', 'low'],
        blocked: true,
        due: 'overdue' as const,
        parentId: null,
        includeArchivedProjects: true,
      },
      groupBy: 'assignee' as const,
      sort: 'due' as const,
      direction: 'desc' as const,
      limit: 25,
    };

    const restored = parseWorkItemQuery(Object.fromEntries(toSearchParams(original)));
    expect(restored).toEqual(original);
  });

  it('writes nothing for a query that asks for the defaults', () => {
    // A link to an unfiltered list is the bare path. The URL says what was
    // chosen and nothing else.
    const query = { ...emptyQuery(), filters: { ...emptyQuery().filters, projectIds: [project] } };
    expect(toQueryString(query)).toBe(`?p=${project}`);
  });

  it('tells "top-level only" apart from "any parent"', () => {
    // Two different requests. §11's list groups top-level items, and a filter
    // that collapsed these would silently show sub-items as duplicates.
    expect(withFilters({ projectIds: [project], parentId: null }).filters.parentId).toBeNull();
    expect(withFilters({ projectIds: [project] }).filters.parentId).toBeUndefined();
    expect(withFilters({ projectIds: [project], parentId: item }).filters.parentId).toBe(item);
  });
});

describe('parsing a URL somebody edited', () => {
  it('drops values that do not fit instead of failing the whole page', () => {
    // A link gets truncated by a chat client, hand-edited, or produced by a
    // version that has since dropped a filter. Showing the list slightly wider
    // than intended beats showing a stranger an error page.
    const query = parseWorkItemQuery({
      p: `${project},not-a-uuid`,
      pr: 'urgent,imaginary',
      by: 'phase-of-the-moon',
      sort: 'whatever',
      d: 'someday',
    });

    expect(query.filters.projectIds).toEqual([project]);
    expect(query.filters.priorities).toEqual(['urgent']);
    expect(query.groupBy).toBe('state');
    expect(query.sort).toBe('rank');
    expect(query.filters.due).toBe('any');
  });

  it('never lets a page size past the ceiling', () => {
    expect(parseWorkItemQuery({ p: project, n: '100000' }).limit).toBe(200);
    expect(parseWorkItemQuery({ p: project, n: '0' }).limit).toBe(DEFAULT_LIMIT);
    expect(parseWorkItemQuery({ p: project, n: 'lots' }).limit).toBe(DEFAULT_LIMIT);
  });

  it('ignores parameters it does not recognise', () => {
    const query = parseWorkItemQuery({ p: project, drop: 'table', __proto__: 'x' });
    expect(query.filters.projectIds).toEqual([project]);
  });

  it('accepts the `none` sentinel only where it means something', () => {
    expect(withFilters({ projectIds: [project], assignees: [NONE] }).filters.assignees).toEqual([
      NONE,
    ]);
    // A project id is an id. There is no "no project" bucket to fall into.
    expect(withFilters({ projectIds: [project, NONE as never] }).filters.projectIds).toEqual([
      project,
    ]);
  });
});

describe('the anchor rule (§9, §16)', () => {
  it('recognises the surfaces that are genuinely bounded', () => {
    expect(anchorOf(withFilters({ projectIds: [project] }))).toBe('project');
    expect(anchorOf(withFilters({ assignees: [member] }))).toBe('assignee');
    expect(anchorOf(withFilters({ parentId: item }))).toBe('parent');
    expect(anchorOf(withFilters({ parentId: null }))).toBe('parent');
    // Slice 11's. A cycle belongs to one project and holds a planned set, so it
    // bounds a scan at least as tightly as naming the project does.
    expect(anchorOf(withFilters({ cycleIds: [sprint] }))).toBe('cycle');
  });

  it('refuses a query that would scan a whole workspace', () => {
    // Adding a filter is not an anchor: "everything urgent in the company" is
    // exactly the query §16 says takes production down at 3am.
    expect(isAnchored(emptyQuery())).toBe(false);
    expect(isAnchored(withFilters({ priorities: ['urgent'] }))).toBe(false);
    expect(isAnchored(withFilters({ due: 'overdue' }))).toBe(false);
  });

  /**
   * The trap in making a cycle an anchor. `none` in the cycle filter means "not
   * planned into anything", which is the whole backlog of the whole workspace —
   * the unanchored scan, wearing a filter. Only a real id anchors.
   */
  it('does not let the backlog sentinel alone anchor a query', () => {
    expect(isAnchored(withFilters({ cycleIds: [NONE] }))).toBe(false);
    expect(anchorOf(withFilters({ cycleIds: [NONE, sprint] }))).toBe('cycle');
  });

  /**
   * The same trap, on the filter that had it first — and did not check for it
   * until slice 13.
   *
   * `a=none` is §7.4's unassigned row: "every item in this company that nobody
   * owns". That is not a bounded set, it is the §16 scan with an `a=` on it, and
   * the assignee anchor counted any non-empty list until Needs Attention made
   * the query reachable from a screen. Needs Attention supplies its own project
   * set, which is what makes the row answerable at all.
   */
  it('does not let the unassigned sentinel alone anchor a query', () => {
    expect(isAnchored(withFilters({ assignees: [NONE] }))).toBe(false);
    expect(anchorOf(withFilters({ assignees: [NONE, member] }))).toBe('assignee');
    expect(anchorOf(withFilters({ assignees: [NONE], projectIds: [project] }))).toBe('project');
  });
});

describe('hasActiveFilters', () => {
  it('ignores the anchor, which is not a filter the user chose', () => {
    expect(hasActiveFilters(withFilters({ projectIds: [project] }))).toBe(false);
    expect(hasActiveFilters(withFilters({ projectIds: [project], blocked: false }))).toBe(true);
  });
});

describe('cursors', () => {
  const row = {
    id: item,
    rank: 'i',
    createdAt: new Date('2026-09-02T08:30:00.000Z'),
    updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    dueDate: '2026-09-10',
    priority: 'high' as const,
    number: 142,
  };

  it('round-trips a timestamp, whose dots would otherwise split the encoding', () => {
    const cursor = cursorFor(row, 'created');
    expect(decodeCursor(encodeCursor(cursor), 'created')).toEqual(cursor);
  });

  it('round-trips every sort', () => {
    for (const sort of ['rank', 'created', 'updated', 'due', 'priority', 'number'] as const) {
      const cursor = cursorFor(row, sort);
      expect(decodeCursor(encodeCursor(cursor), sort), sort).toEqual(cursor);
    }
  });

  it('sorts priority by §12 order, not alphabetically', () => {
    // Alphabetically "high" falls between "cancelled" and "low", and the second
    // page of a priority-sorted group would be a different list from the first.
    expect(cursorFor({ ...row, priority: 'urgent' }, 'priority').value).toBe('0');
    expect(cursorFor({ ...row, priority: 'high' }, 'priority').value).toBe('1');
    expect(cursorFor({ ...row, priority: 'none' }, 'priority').value).toBe('4');
  });

  it('carries a null due date, because an item with no date still has a position', () => {
    const cursor = cursorFor({ ...row, dueDate: null }, 'due');
    expect(cursor.value).toBeNull();
    expect(decodeCursor(encodeCursor(cursor), 'due')).toEqual(cursor);
  });

  it('refuses a cursor cut for a different ordering', () => {
    // The position it describes does not exist in the new order, so the group
    // starts again rather than returning an arbitrary slice.
    const cursor = encodeCursor(cursorFor(row, 'due'));
    expect(decodeCursor(cursor, 'created')).toBeNull();
  });

  it('discards a cursor that does not decode', () => {
    expect(decodeCursor('nonsense', 'rank')).toBeNull();
    expect(decodeCursor('rank.i.not-a-uuid', 'rank')).toBeNull();
    expect(decodeCursor('rank.%E0%A4%A.' + item, 'rank')).toBeNull();
    expect(decodeCursor(null, 'rank')).toBeNull();
    expect(decodeCursor('', 'rank')).toBeNull();
  });
});

/**
 * §6-4's custom fields in the DSL (slice 10).
 *
 * The same three questions as everything above — does the URL round trip,
 * is junk discarded rather than fatal, does the anchor rule still hold — asked
 * of the one filter that is repeated in the query string rather than
 * comma-joined, because a `has` payload is text somebody typed.
 */
const fieldA = '018f8f4a-0000-7000-8000-0000000000a1';
const fieldB = '018f8f4a-0000-7000-8000-0000000000a2';
const option = '018f8f4a-0000-7000-8000-0000000000b1';

/**
 * A parameter bag the way a framework hands one over: a repeated key arrives as
 * an array. `Object.fromEntries` keeps only the last value, which would quietly
 * make every multi-field test pass for the wrong reason.
 */
function bagOf(params: URLSearchParams): Record<string, string | string[]> {
  const bag: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    bag[key] = values.length > 1 ? values : values[0]!;
  }
  return bag;
}

const roundTrip = (query: WorkItemQuery) => parseWorkItemQuery(bagOf(toSearchParams(query)));

describe('custom-field filters', () => {
  it('round-trips every operator, several fields at once', () => {
    const original: WorkItemQuery = {
      ...emptyQuery(),
      filters: {
        ...emptyQuery().filters,
        projectIds: [project],
        custom: [
          { fieldId: fieldA, op: 'in', ids: [option, NONE] },
          { fieldId: fieldB, op: 'has', text: 'Acme, Ltd. ~ 50%' },
        ],
      },
    };

    expect(roundTrip(original)).toEqual(original);
  });

  it('survives a tilde and a comma in free text, which the separators use', () => {
    // `~` separates the three parts and `encodeURIComponent` does not escape
    // it, so it is escaped by hand — the same correction `encodeCursor` makes
    // for `.`. Without it the filter splits into four parts and decodes as
    // nothing.
    for (const text of ['a~b', 'a,b', '100%', 'ក្នុង~ព្រៃ']) {
      const query: WorkItemQuery = {
        ...emptyQuery(),
        filters: {
          ...emptyQuery().filters,
          projectIds: [project],
          custom: [{ fieldId: fieldA, op: 'has', text }],
        },
      };
      expect(roundTrip(query).filters.custom, text).toEqual(query.filters.custom);
    }
  });

  it('round-trips the boolean and range operators', () => {
    const cases = [
      { fieldId: fieldA, op: 'is', value: true },
      { fieldId: fieldA, op: 'set', value: false },
      { fieldId: fieldA, op: 'range', from: '10.5', to: null },
      { fieldId: fieldA, op: 'range', from: null, to: '2026-09-03' },
      { fieldId: fieldA, op: 'range', from: '2026-01-01', to: '2026-12-31' },
    ] as const;

    for (const filter of cases) {
      const query: WorkItemQuery = {
        ...emptyQuery(),
        filters: { ...emptyQuery().filters, projectIds: [project], custom: [filter] },
      };
      expect(roundTrip(query).filters.custom, filter.op).toEqual([filter]);
    }
  });

  it('drops a malformed filter rather than failing the page', () => {
    const bag = {
      p: project,
      cf: [
        `${fieldA}~in~${option}`,
        'not-a-uuid~in~x',
        `${fieldB}~nonsense~1`,
        `${fieldB}~range~|`,
        `${fieldB}~has~`,
        'too~few',
      ],
    };

    expect(parseWorkItemQuery(bag).filters.custom).toEqual([
      { fieldId: fieldA, op: 'in', ids: [option] },
    ]);
  });

  it('refuses a range with both ends open, which is not a filter', () => {
    expect(parseWorkItemQuery({ p: project, cf: `${fieldA}~range~|` }).filters.custom).toEqual([]);
  });

  it('refuses a range bound that is neither a number nor a date', () => {
    // Both are bound as parameters, so the worst case is a Postgres cast error
    // reaching somebody who pasted a link — which a DSL that already discards
    // what it cannot use should never let happen.
    expect(parseWorkItemQuery({ p: project, cf: `${fieldA}~range~soon|` }).filters.custom).toEqual(
      [],
    );
  });

  it('keeps one filter per field', () => {
    // Two conditions on one field is an AND no control can express, and the
    // first is the one the bar can show.
    const bag = { p: project, cf: [`${fieldA}~set~1`, `${fieldA}~set~0`] };
    expect(parseWorkItemQuery(bag).filters.custom).toEqual([
      { fieldId: fieldA, op: 'set', value: true },
    ]);
  });

  it('counts as an active filter, so "clear" is offered', () => {
    const query = {
      ...emptyQuery(),
      filters: {
        ...emptyQuery().filters,
        projectIds: [project],
        custom: [{ fieldId: fieldA, op: 'set', value: true } as const],
      },
    };
    expect(hasActiveFilters(query)).toBe(true);
  });
});

describe('grouping by a custom field', () => {
  it('round-trips a `custom:{fieldId}` grouping', () => {
    const query = { ...emptyQuery(), groupBy: `custom:${fieldA}` as const };
    expect(roundTrip(query).groupBy).toBe(`custom:${fieldA}`);
  });

  it('falls back to state for a grouping that is not one', () => {
    expect(parseWorkItemQuery({ by: 'custom:nope' }).groupBy).toBe('state');
    expect(parseWorkItemQuery({ by: 'custom:' }).groupBy).toBe('state');
    expect(parseWorkItemQuery({ by: 'whatever' }).groupBy).toBe('state');
  });
});

/**
 * Slice 12: the two new views, the calendar's month, and the grouping the
 * calendar imposes. The month is the only filter in the DSL that is a *date*
 * rather than a set of ids or a named window, so its round trip and its
 * rejection of junk are worth pinning separately.
 */
describe('the table and calendar views (slice 12)', () => {
  it('round-trips every view through the URL', () => {
    for (const view of ['list', 'board', 'table', 'calendar'] as const) {
      const parsed = parseWorkItemQuery(
        Object.fromEntries(toSearchParams({ ...emptyQuery(), view })),
      );
      expect(parsed.view).toBe(view);
    }
  });

  it('round-trips the calendar month', () => {
    const parsed = withFilters({ month: '2026-09' });
    expect(parsed.filters.month).toBe('2026-09');
    expect(toQueryString(parsed)).toContain('m=2026-09');
  });

  it('drops a month that is not YYYY-MM rather than failing', () => {
    // §9's "discarding rather than failing": a link a chat client truncated
    // opens the calendar on the current month, not on an error page.
    for (const junk of ['2026-13', '2026', 'september', '2026-9', '2026-09-01']) {
      expect(parseWorkItemQuery({ m: junk }).filters.month).toBeUndefined();
    }
  });

  it('does not count the month as an active filter', () => {
    // The calendar always sets one — it is that view's axis, not a narrowing
    // somebody chose — so offering "clear the filters" over it would be wrong
    // and clearing it would leave the calendar with no month to draw.
    expect(hasActiveFilters(withFilters({ month: '2026-09' }))).toBe(false);
  });

  it('round-trips the day grouping but keeps it out of the picker', () => {
    expect(parseWorkItemQuery({ by: 'day' }).groupBy).toBe('day');
    expect(PICKABLE_GROUP_BY).not.toContain('day');
    expect(GROUP_BY).toContain('day');
  });

  it('does not let a month anchor a query', () => {
    // A month of due dates across a workspace is not a bounded set of rows —
    // §16's scan wearing a date filter. The project still has to anchor it.
    expect(isAnchored(withFilters({ month: '2026-09' }))).toBe(false);
    expect(anchorOf(withFilters({ month: '2026-09', projectIds: [project] }))).toBe('project');
  });
});

describe('month arithmetic', () => {
  it('knows how long every month is, leap years included', () => {
    expect(monthRange('2026-09')).toEqual({ first: '2026-09-01', last: '2026-09-30' });
    expect(monthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });

  it('lists a month one day at a time, in order', () => {
    const days = monthDays('2026-02');
    expect(days).toHaveLength(28);
    expect(days[0]).toBe('2026-02-01');
    expect(days[27]).toBe('2026-02-28');
  });

  it('crosses a year boundary in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });

  it('reads the month out of a calendar date', () => {
    expect(monthOf('2026-09-02')).toBe('2026-09');
  });
});

/**
 * Slice 13's two additions to the DSL (§7.3, §7.4).
 *
 * Both are one field, and both are the kind of field whose *absence* from the
 * URL round trip would be invisible until somebody shared a link.
 */
describe('My Work and Needs Attention (slice 13)', () => {
  it('round-trips a staleness threshold', () => {
    const query = withFilters({ stale: 7 });
    expect(query.filters.stale).toBe(7);
    expect(toQueryString(query)).toContain('st=7');
  });

  it('drops a staleness threshold it cannot use, rather than clamping it', () => {
    /**
     * §9's "discarding rather than failing", and deliberately not a clamp: a
     * clamp would answer a different question than the link asked, silently. The
     * surface that needs this supplies its own default when the URL says
     * nothing, so dropping it is the honest failure.
     */
    expect(parseWorkItemQuery({ st: '0' }).filters.stale).toBeUndefined();
    expect(parseWorkItemQuery({ st: '400' }).filters.stale).toBeUndefined();
    expect(parseWorkItemQuery({ st: 'five' }).filters.stale).toBeUndefined();
    expect(parseWorkItemQuery({ st: '2.5' }).filters.stale).toBeUndefined();
  });

  it('counts staleness as an active filter, unlike the calendar month', () => {
    // The month is the calendar's axis and is set on every render, so counting
    // it would report filters on a screen nobody filtered. Nothing sets `stale`
    // except a person, so "clear" should take it away.
    expect(hasActiveFilters(withFilters({ stale: 5, projectIds: [project] }))).toBe(true);
    expect(hasActiveFilters(withFilters({ month: '2026-09', projectIds: [project] }))).toBe(false);
  });

  it('offers the due grouping in the picker, where `day` stays out', () => {
    /**
     * The distinction the picker exists to make. Both key on a due date; only
     * one has a finite key set without a second filter to bound it. `due` is
     * always exactly the five buckets §7.3 names, so it is safe on any list.
     */
    expect(GROUP_BY).toContain('due');
    expect(PICKABLE_GROUP_BY).toContain('due');
    expect(PICKABLE_GROUP_BY).not.toContain('day');
  });

  it('round-trips the due grouping through the URL', () => {
    const query = parseWorkItemQuery({ by: 'due' });
    expect(query.groupBy).toBe('due');
    expect(toQueryString(query)).toContain('by=due');
  });
});

/**
 * §7.9's search text, in the DSL (slice 14).
 *
 * Search is a filter rather than a query of its own, so these are the same three
 * questions everything above asks — does it round-trip, does a hand-edited URL
 * survive it, and does it change the anchor. The third answer is the one worth
 * pinning: **no**.
 */
describe('search text (slice 14)', () => {
  it('round-trips through the URL as `q`', () => {
    const query = withFilters({ projectIds: [project], text: 'login bug' });
    expect(query.filters.text).toBe('login bug');
    expect(toQueryString(query)).toContain('q=login+bug');
  });

  it('keeps Khmer intact, with its zero-width breaks', () => {
    // The URL carries what the person typed; `normalizeQuery` strips the
    // zero-width characters where the text meets the database, not here — so a
    // colleague opening the link sees the same text in the same search box.
    const typed = 'ភ្នំ\u200bពេញ';
    const query = withFilters({ projectIds: [project], text: typed });
    expect(query.filters.text).toBe(typed);
  });

  it('drops whitespace-only text rather than filtering on nothing', () => {
    expect(parseWorkItemQuery({ q: '   ' }).filters.text).toBeUndefined();
    expect(parseWorkItemQuery({ q: '' }).filters.text).toBeUndefined();
  });

  it('trims, so a pasted link with a trailing space is the same query', () => {
    expect(parseWorkItemQuery({ q: '  login ' }).filters.text).toBe('login');
  });

  /**
   * **The decision this slice rests on.** A text predicate looks like it bounds
   * a scan and does not — below three characters no trigram index can serve a
   * `LIKE '%ab%'`, and a one-letter Latin prefix matches most of a company. So
   * §7.9's workspace-wide search is anchored the way slice 13's cross-project
   * screens are: by an enumerated set of visible projects, resolved before the
   * query is built.
   */
  it('does not anchor a query on its own', () => {
    expect(isAnchored(withFilters({ text: 'login' }))).toBe(false);
    expect(anchorOf(withFilters({ text: 'login', projectIds: [project] }))).toBe('project');
  });

  it('counts as an active filter, so "clear" takes it away', () => {
    expect(hasActiveFilters(withFilters({ projectIds: [project], text: 'login' }))).toBe(true);
  });
});
