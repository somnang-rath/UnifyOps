import { CUSTOM_PREFIX, customFieldIdOf } from './custom-fields';

/**
 * Saved views (§4's "filter, group, sort, saved views, shareable URL", §14
 * slice 12) and the Table view's column layout, as pure data.
 *
 * In `src/lib` for the reason `work-item-query.ts` is: both sides run this. The
 * server validates a name and a column layout before writing the row, and the
 * browser validates the same name as it is typed and resizes the same columns
 * before it asks the server to remember them. One implementation, so a layout
 * the table can express is a layout the service will store.
 *
 * **A saved view stores a query string, not a parsed query.** §5 already makes
 * the URL the whole of a view's state — "any view state is a URL. Paste it in
 * chat and a colleague sees exactly what you see" — so a saved view is a name
 * for a URL somebody wanted again, and storing the query string means the DSL
 * stays the single definition of what a filter is. Storing a parsed filter
 * object would be a second schema for the same thing, kept in step by hand, and
 * the first slice that added a filter would silently invalidate every saved row
 * that predated it. A query string parses through `parseWorkItemQuery`, which
 * already discards what it does not understand (§9) — so a view saved by an
 * older build opens in a newer one, one filter wider at worst.
 *
 * **Views are personal in v1.** §4 puts "saved view sharing with teammates" in
 * the should-have list, not the must-have one, so a row belongs to the member
 * who wrote it and nothing reads anybody else's. That is also why no §10 row
 * was invented for them — the sixth time this decision has gone the same way,
 * after labels, attachments, notifications, custom fields and cycles. What
 * stops one person reaching another's saved views is not a role: every query is
 * keyed on the acting member's own id, underneath RLS that has already scoped
 * the rows to the workspace. Sharing is the slice that adds a visibility
 * column and *then* has a question to ask §10.
 */

/** §12's Table spec, as column identifiers. The order here is the default order. */
export const TABLE_COLUMNS = [
  'identifier',
  'title',
  'state',
  'assignees',
  'priority',
  'due',
  'labels',
  'estimate',
  'cycle',
  'updated',
] as const;

export type TableColumn = (typeof TABLE_COLUMNS)[number];

/**
 * The columns whose values are numbers, and which §12 therefore right-aligns.
 *
 * A set rather than a per-column flag on a spec object, because alignment is
 * the only property that varies and one exported set is cheaper to read at the
 * two call sites than a table of mostly-identical rows.
 */
export const NUMERIC_COLUMNS: ReadonlySet<string> = new Set<TableColumn>([
  'identifier',
  'estimate',
]);

/** The columns a table shows before anybody has chosen otherwise. */
export const DEFAULT_TABLE_COLUMNS: readonly TableColumn[] = [
  'identifier',
  'title',
  'state',
  'assignees',
  'priority',
  'due',
  'labels',
];

/**
 * A column identifier is a built-in one, or one custom field (§6-4).
 *
 * `custom:{fieldId}` is the same phrasing the filter DSL and the group-by use,
 * for the reason that one gives: everything downstream treats a column as one
 * opaque string, and a second parameter that has to agree with the first is a
 * second parameter that eventually will not.
 *
 * This is the last part of §14 slice 10's outcome line to be built — "define a
 * field; it appears in create, detail, filter, group, **table**" — and it is
 * built here rather than in slice 10 because slice 10 had no table to appear
 * in.
 */
export function isTableColumn(value: string): boolean {
  return (TABLE_COLUMNS as readonly string[]).includes(value) || customFieldIdOf(value) !== null;
}

export function customColumn(fieldId: string): string {
  return `${CUSTOM_PREFIX}${fieldId}`;
}

/**
 * §12: "column widths persisted per saved view."
 *
 * Clamped rather than validated-and-rejected. A width arrives from a drag, so
 * a wrong value is a slip of the wrist or a browser reporting a fractional
 * pixel — not an attack, and not worth an error message. The floor keeps a
 * column somebody dragged to nothing findable again; the ceiling stops one
 * column pushing every other off a 390px phone (§15-6).
 */
export const MIN_COLUMN_WIDTH = 64;
export const MAX_COLUMN_WIDTH = 640;

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

/** The width each column starts at, before anybody drags one. */
export const DEFAULT_COLUMN_WIDTH: Readonly<Record<TableColumn, number>> = {
  identifier: 96,
  title: 360,
  state: 140,
  assignees: 120,
  priority: 110,
  due: 120,
  labels: 180,
  estimate: 90,
  cycle: 140,
  updated: 130,
};

/** A custom field's column has no per-kind default; one width suits all seven. */
export const DEFAULT_CUSTOM_COLUMN_WIDTH = 160;

export function defaultWidthOf(column: string): number {
  return DEFAULT_COLUMN_WIDTH[column as TableColumn] ?? DEFAULT_CUSTOM_COLUMN_WIDTH;
}

/**
 * What a saved view remembers about the table, beyond the query string.
 *
 * Deliberately small, and deliberately not a snapshot of every visual choice a
 * table can hold. Widths and which columns are shown are the two things §12
 * names; the sort and the grouping are already in the query string, and storing
 * them twice is how the two come to disagree.
 */
export type TableLayout = {
  /** In display order. An unknown identifier is dropped on read, never rendered. */
  columns: string[];
  /** Pixels, by column identifier. A column with no entry uses its default. */
  widths: Record<string, number>;
};

export function defaultTableLayout(): TableLayout {
  return { columns: [...DEFAULT_TABLE_COLUMNS], widths: {} };
}

/**
 * Parses a stored layout, dropping anything that no longer makes sense.
 *
 * Dropping rather than failing, for the reason `parseWorkItemQuery` gives: this
 * is data written by an older build, or naming a custom field that has since
 * been deleted, and a saved view that renders an error page is worse than one
 * that renders a column short. A layout with nothing left falls back to the
 * default set rather than to a table with no columns — which would be a screen
 * with no way to get its columns back.
 */
export function parseTableLayout(raw: unknown): TableLayout {
  if (raw === null || typeof raw !== 'object') return defaultTableLayout();

  const source = raw as { columns?: unknown; widths?: unknown };

  const columns = Array.isArray(source.columns)
    ? [
        ...new Set(
          source.columns.filter(
            (value): value is string => typeof value === 'string' && isTableColumn(value),
          ),
        ),
      ]
    : [];

  const widths: Record<string, number> = {};
  if (source.widths !== null && typeof source.widths === 'object' && source.widths !== undefined) {
    for (const [column, width] of Object.entries(source.widths as Record<string, unknown>)) {
      if (!isTableColumn(column)) continue;
      if (typeof width !== 'number') continue;
      widths[column] = clampWidth(width);
    }
  }

  return columns.length > 0 ? { columns, widths } : { ...defaultTableLayout(), widths };
}

/**
 * The layout a table actually draws, given the custom fields this project has.
 *
 * A stored column naming a field that has since been deleted is dropped here
 * rather than at parse time, because `parseTableLayout` runs in `lib` and does
 * not know what a project holds. §7.11 promises a rename preserves values; a
 * column identifier is a field **id**, so a rename does not touch this either.
 */
export function resolveColumns(layout: TableLayout, fieldIds: readonly string[]): string[] {
  const known = new Set(fieldIds);
  const resolved = layout.columns.filter((column) => {
    const fieldId = customFieldIdOf(column);
    return fieldId === null || known.has(fieldId);
  });
  // Never nothing: a table with no columns is a screen with no way back.
  return resolved.length > 0 ? resolved : [...DEFAULT_TABLE_COLUMNS];
}

/* ------------------------------------------------------------------------- */
/* The saved view itself                                                     */
/* ------------------------------------------------------------------------- */

/**
 * A name is capped by **grapheme**, not by code point.
 *
 * `[...text].length` gives a Khmer workspace roughly a third of the field an
 * English one gets, silently, and refuses names that fit — one Khmer syllable
 * is routinely three or four code points (§13). The same arithmetic slice 10's
 * field names use, pointed the same way.
 */
export const MAX_VIEW_NAME_LENGTH = 60;

/** A query string is bounded because it is stored; a URL nobody can share is not one. */
export const MAX_VIEW_QUERY_LENGTH = 2048;

export const MAX_VIEWS_PER_MEMBER = 50;

export function nameLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

export type SavedViewProblem = 'name_required' | 'name_too_long' | 'query_too_long' | 'too_many';

/**
 * The rules a saved view has to satisfy, in one place both sides call.
 *
 * Returns the problem rather than throwing, and the problem is an identifier
 * rather than a sentence — §13's rule that every failure crosses the wire as a
 * message key, because an English string returned from a server action is the
 * one place Khmer silently degrades.
 */
export function validateSavedView(input: {
  name: string;
  query: string;
  existingCount?: number;
}): SavedViewProblem | null {
  const name = input.name.trim();
  if (name.length === 0) return 'name_required';
  if (nameLength(name) > MAX_VIEW_NAME_LENGTH) return 'name_too_long';
  if (input.query.length > MAX_VIEW_QUERY_LENGTH) return 'query_too_long';
  if ((input.existingCount ?? 0) >= MAX_VIEWS_PER_MEMBER) return 'too_many';
  return null;
}

/**
 * True when a saved view describes the query on screen.
 *
 * Compared as **sorted parameters** rather than as raw strings. Both are built
 * by the same serialiser, but one of them may have been stored by a build that
 * emitted them in a different order — and a saved view that silently stops
 * highlighting itself after an unrelated slice reordered one `if` is a bug
 * nobody would think to look for. Cursors never appear here: they are not in
 * the URL by design (§9).
 */
export function sameQuery(a: string, b: string): boolean {
  const normalise = (value: string) => {
    // `replace` rather than a slice off the front: this is a query string and
    // never user text, and the design-token hook's slicing check is right to
    // ask about every other one in the codebase.
    const params = [...new URLSearchParams(value.replace(/^\?/, ''))];
    params.sort(([keyA, valueA], [keyB, valueB]) =>
      keyA === keyB ? valueA.localeCompare(valueB) : keyA.localeCompare(keyB),
    );
    return params.map(([key, value]) => `${key}=${value}`).join('&');
  };

  return normalise(a) === normalise(b);
}
