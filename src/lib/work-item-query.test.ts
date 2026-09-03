import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  NONE,
  anchorOf,
  cursorFor,
  decodeCursor,
  emptyQuery,
  encodeCursor,
  hasActiveFilters,
  isAnchored,
  parseWorkItemQuery,
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
  it('recognises the three surfaces that are genuinely bounded', () => {
    expect(anchorOf(withFilters({ projectIds: [project] }))).toBe('project');
    expect(anchorOf(withFilters({ assignees: [member] }))).toBe('assignee');
    expect(anchorOf(withFilters({ parentId: item }))).toBe('parent');
    expect(anchorOf(withFilters({ parentId: null }))).toBe('parent');
  });

  it('refuses a query that would scan a whole workspace', () => {
    // Adding a filter is not an anchor: "everything urgent in the company" is
    // exactly the query §16 says takes production down at 3am.
    expect(isAnchored(emptyQuery())).toBe(false);
    expect(isAnchored(withFilters({ priorities: ['urgent'] }))).toBe(false);
    expect(isAnchored(withFilters({ due: 'overdue' }))).toBe(false);
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
