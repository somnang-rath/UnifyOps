/**
 * Custom fields (§6-4, §14 slice 10) — the kinds, and the pure rules for
 * turning what a form posts into what a column holds.
 *
 * In `src/lib` for the reason `work-item-query.ts` and `mentions.ts` are: both
 * sides run it. The settings editor and the item panel validate a value as it
 * is typed, and the service validates the same value on submit against the same
 * table — one implementation, so a value the UI accepts is a value the server
 * stores, and one it refuses is refused with the same reason in both languages.
 *
 * §6-4 names seven kinds and no eighth: "text, number, select, multi-select,
 * date, user, checkbox". Formula fields, cross-project fields and per-role
 * visibility are Phase 2 and are not anticipated here — each would change what
 * a *value* is, and guessing at that now is a column nothing fills.
 */

/**
 * The seven kinds, closed and ordered as §6-4 lists them.
 *
 * A closed enum, so it maps to messages in code and **no translation key ever
 * reaches the database** (§13). The `custom_field.kind` column is a Postgres
 * enum built from this constant, the same way `priority` and `state_group` are:
 * the schema and the product cannot drift apart because there is one list.
 */
export const CUSTOM_FIELD_KINDS = [
  'text',
  'number',
  'select',
  'multi_select',
  'date',
  'user',
  'checkbox',
] as const;

export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

export function isCustomFieldKind(value: unknown): value is CustomFieldKind {
  return typeof value === 'string' && (CUSTOM_FIELD_KINDS as readonly string[]).includes(value);
}

/** The kinds whose vocabulary is a list the company writes (§7.11's "options if select"). */
export const OPTION_KINDS = ['select', 'multi_select'] as const satisfies readonly CustomFieldKind[];

export function hasOptions(kind: CustomFieldKind): boolean {
  return (OPTION_KINDS as readonly string[]).includes(kind);
}

/**
 * The kinds a list may be **grouped** by, and why the other three are not.
 *
 * §9's page query takes its group keys as an argument rather than discovering
 * them — "a board column that disappears when it empties is a column nothing
 * can be dragged into" — so a grouping is only possible where the complete set
 * of keys is known before the query runs. A select's options, the workspace's
 * members and `true`/`false` are all enumerable; a free-text field, a number
 * and a date are not, and grouping by one would mean either scanning the table
 * to find the headings or showing only the groups this page happened to hold.
 *
 * Filtering has no such limit: every kind is filterable, which is the half of
 * §6-4's "Filter, group, show in views" that free text actually needs.
 */
export const GROUPABLE_KINDS = [
  'select',
  'multi_select',
  'user',
  'checkbox',
] as const satisfies readonly CustomFieldKind[];

export function isGroupable(kind: CustomFieldKind): boolean {
  return (GROUPABLE_KINDS as readonly string[]).includes(kind);
}

/** §12's Input caps: a field name is a label on a form, not a paragraph. */
export const MAX_NAME_LENGTH = 60;
/** A text value is a client name or an invoice number (§6), not a description. */
export const MAX_TEXT_LENGTH = 500;

/**
 * Length in **graphemes**, which is the only count a length limit may use here.
 *
 * `[...text].length` counts code points, and one Khmer syllable is routinely
 * three or four of them — so a limit enforced that way gives a Khmer workspace
 * roughly a third of the field an English one gets, silently, and refuses text
 * that fits. §13 makes this rule for truncation; a cap is the same arithmetic
 * pointed the other way, and `attachments.ts` already segments filenames for
 * exactly this reason.
 */
export function graphemeLength(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
}

/**
 * Per project. High enough that nobody meets it in normal use, low enough that
 * the item panel stays a form rather than a spreadsheet — and low enough that
 * the one EXISTS subquery a filtered field costs cannot become fifty.
 */
export const MAX_FIELDS_PER_PROJECT = 30;
/** Per select field. A vocabulary longer than this is a relation, not a dropdown. */
export const MAX_OPTIONS_PER_FIELD = 50;

/**
 * The columns one value occupies, exactly one of which is ever set.
 *
 * A row per (item, field) with a typed column per kind — §9's "Real tables, not
 * JSONB. Typed indexed columns per value kind." JSONB would make every filter a
 * sequential scan with a cast in it, which is precisely the §16 risk that says
 * custom fields must not slow the list query.
 *
 * `number` crosses as a string because the column is `numeric`: an invoice
 * total is the sort of thing people put in a custom field, and binary floating
 * point is the wrong shape for money. The database keeps the precision the
 * person typed; JavaScript is never asked to hold it.
 */
export type ValueColumns = {
  text: string | null;
  number: string | null;
  date: string | null;
  checkbox: boolean | null;
  optionIds: string[] | null;
  memberId: string | null;
};

const EMPTY: ValueColumns = {
  text: null,
  number: null,
  date: null,
  checkbox: null,
  optionIds: null,
  memberId: null,
};

export type ValueProblem =
  | 'value_too_long'
  | 'value_not_a_number'
  | 'value_not_a_date'
  | 'value_not_an_option'
  | 'value_too_many';

export type ParsedValue =
  /** Columns to write, or `null` for "this item has no value for this field". */
  | { ok: true; value: ValueColumns | null }
  | { ok: false; problem: ValueProblem };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `YYYY-MM-DD`, the shape §9's `date` columns are read and written as. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * What a form posted, for one field, turned into columns — or into `null`.
 *
 * **Absence is the absence of a row**, never a row full of nulls. Two reasons,
 * and both bite later: an index on a value column stays the size of the items
 * that actually use the field rather than the size of the project, and "has no
 * value" is then `NOT EXISTS`, which is one index probe rather than a scan
 * looking for nulls. It also means adding a field to a project holding 5,000
 * items writes nothing at all.
 *
 * A **checkbox is the same rule read honestly**: an unticked box is not a
 * stored `false`, it is the absence of a tick. So `false` clears the row, and
 * "is not ticked" is a `NOT EXISTS` — which is also the only answer that is
 * correct for the items that existed before the field did.
 */
export function parseValue(
  kind: CustomFieldKind,
  raw: string | readonly string[] | null | undefined,
  context: { optionIds?: readonly string[] } = {},
): ParsedValue {
  const list = raw === null || raw === undefined ? [] : Array.isArray(raw) ? [...raw] : [raw as string];
  const first = typeof list[0] === 'string' ? list[0] : '';

  switch (kind) {
    case 'text': {
      // NFC for the reason every other user string in this codebase is
      // normalized: two Khmer strings that look identical and are not compare
      // as different, which makes a filter miss the row somebody is looking at.
      const text = first.trim().normalize('NFC');
      if (!text) return { ok: true, value: null };
      if (graphemeLength(text) > MAX_TEXT_LENGTH) return { ok: false, problem: 'value_too_long' };
      return { ok: true, value: { ...EMPTY, text } };
    }

    case 'number': {
      const trimmed = first.trim();
      if (!trimmed) return { ok: true, value: null };
      // Number() accepts '', '0x10', 'Infinity' and whitespace; the shape test
      // is what refuses them. The value is then kept as the *string* that was
      // typed, because the column is numeric and a round trip through a double
      // is the one place the precision would quietly go.
      if (!/^-?\d+(\.\d+)?$/.test(trimmed) || !Number.isFinite(Number(trimmed))) {
        return { ok: false, problem: 'value_not_a_number' };
      }
      return { ok: true, value: { ...EMPTY, number: trimmed } };
    }

    case 'date': {
      const date = first.trim();
      if (!date) return { ok: true, value: null };
      if (!isCalendarDate(date)) return { ok: false, problem: 'value_not_a_date' };
      return { ok: true, value: { ...EMPTY, date } };
    }

    case 'checkbox': {
      // An HTML checkbox posts its value when ticked and nothing at all when
      // not, so anything that is not an affirmative is "not ticked".
      const ticked = first === '1' || first === 'on' || first === 'true';
      return ticked ? { ok: true, value: { ...EMPTY, checkbox: true } } : { ok: true, value: null };
    }

    case 'select':
    case 'multi_select': {
      const known = new Set(context.optionIds ?? []);
      const ids = [...new Set(list.filter((value) => value && UUID.test(value)))];
      if (ids.length === 0) return { ok: true, value: null };
      // An id naming no option of this field is a client defect, or a form left
      // open while somebody deleted the option. Either way it is refused rather
      // than dropped: silently storing four of five choices is worse than
      // saying which one no longer exists.
      if (ids.some((id) => !known.has(id))) return { ok: false, problem: 'value_not_an_option' };
      if (kind === 'select' && ids.length > 1) return { ok: false, problem: 'value_too_many' };
      if (ids.length > MAX_OPTIONS_PER_FIELD) return { ok: false, problem: 'value_too_many' };
      return { ok: true, value: { ...EMPTY, optionIds: ids } };
    }

    case 'user': {
      const memberId = first.trim();
      if (!memberId) return { ok: true, value: null };
      if (!UUID.test(memberId)) return { ok: false, problem: 'value_not_an_option' };
      return { ok: true, value: { ...EMPTY, memberId } };
    }
  }
}

/**
 * A real calendar date, not merely a well-shaped one.
 *
 * `new Date('2026-02-31')` rolls over to 2 March without complaining, and a
 * date of 31 February stored as 2 March is the kind of thing nobody notices
 * until it is in a report.
 */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * A stored value as the form holds it: a list of strings.
 *
 * The inverse of `parseValue`, and the reason both live here — the panel draws
 * controls from these strings and posts them straight back, so a value that
 * survives a round trip through the form is a value that survives a round trip
 * through the parser. A checkbox becomes `['1']` because that is what a ticked
 * box posts, and an empty list is "no value" for every kind.
 */
export function valueToStrings(value: ValueColumns | null): string[] {
  if (value === null) return [];
  if (value.text !== null) return [value.text];
  if (value.number !== null) return [value.number];
  if (value.date !== null) return [value.date];
  if (value.checkbox) return ['1'];
  if (value.memberId !== null) return [value.memberId];
  return value.optionIds ?? [];
}

/** Whether two values are the same, so a save that changed nothing emits nothing. */
export function sameValue(a: ValueColumns | null, b: ValueColumns | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.text === b.text &&
    a.number === b.number &&
    a.date === b.date &&
    a.checkbox === b.checkbox &&
    a.memberId === b.memberId &&
    sameIds(a.optionIds, b.optionIds)
  );
}

function sameIds(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

/* ------------------------------------------------------------------------- */
/* Grouping keys                                                             */
/* ------------------------------------------------------------------------- */

/**
 * `custom:{fieldId}` — §9's own phrasing, reused as the group key so the URL,
 * the DSL and the builder all spell it the same way.
 */
export const CUSTOM_PREFIX = 'custom:';

export function customGroupBy(fieldId: string): string {
  return `${CUSTOM_PREFIX}${fieldId}`;
}

/**
 * The field id inside a `custom:{id}` grouping, or null for anything else.
 *
 * Matched rather than split, because this parses a value that arrives from a
 * URL: anything that is not exactly the prefix followed by a uuid is not a
 * custom grouping, and saying so in one pattern leaves no shape in between.
 */
const CUSTOM_GROUP = /^custom:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function customFieldIdOf(groupBy: string): string | null {
  return CUSTOM_GROUP.exec(groupBy)?.[1] ?? null;
}

/** The two keys a checkbox grouping produces, as Postgres renders the column. */
export const CHECKBOX_KEYS = ['true', 'false'] as const;

/**
 * Which filter operator a kind can answer.
 *
 * The filter bar only ever offers the right one, so this exists for the other
 * caller: a URL. `parseWorkItemQuery` validates the *shape* of a filter and has
 * no idea what kind of field it names, so a hand-edited link can ask a date
 * field whether it contains "acme". The service drops those before the builder
 * sees them — the same "discard what does not fit" rule the rest of the DSL
 * follows, applied at the one layer that knows enough to apply it.
 *
 * `set` is deliberately available on every kind: "which items has nobody filled
 * this in for" is the question a company asks a fortnight after adding a field.
 */
export function operatorSuits(op: string, kind: CustomFieldKind): boolean {
  switch (op) {
    case 'set':
      return true;
    case 'is':
      return kind === 'checkbox';
    case 'has':
      return kind === 'text';
    case 'range':
      return kind === 'number' || kind === 'date';
    case 'in':
      return kind === 'select' || kind === 'multi_select' || kind === 'user';
    default:
      return false;
  }
}
