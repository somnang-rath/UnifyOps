import { describe, expect, it } from 'vitest';
import {
  CUSTOM_FIELD_KINDS,
  GROUPABLE_KINDS,
  MAX_TEXT_LENGTH,
  customFieldIdOf,
  customGroupBy,
  isCalendarDate,
  isGroupable,
  operatorSuits,
  parseValue,
  sameValue,
  valueToStrings,
  type CustomFieldKind,
} from './custom-fields';

/**
 * The pure half of custom fields (§6-4).
 *
 * What is worth testing here is the part both sides run: the form validates a
 * value as it is typed and the service validates the same value on submit, so a
 * disagreement between them is a value the UI accepts and the server refuses —
 * or worse, one it silently stores differently. Everything below pins a rule
 * that would otherwise be a comment.
 */

const OPTION_A = '018f2b3c-0000-7000-8000-000000000001';
const OPTION_B = '018f2b3c-0000-7000-8000-000000000002';
const MEMBER = '018f2b3c-0000-7000-8000-00000000000a';

const ok = (kind: CustomFieldKind, raw: string | string[] | null, options?: string[]) => {
  const parsed = parseValue(kind, raw, { optionIds: options });
  if (!parsed.ok) throw new Error(`expected ok, got ${parsed.problem}`);
  return parsed.value;
};

describe('parseValue', () => {
  it('treats an empty value as no value, for every kind', () => {
    // The rule the storage depends on: absence is the absence of a row, so
    // "cleared" and "never filled in" have to parse to the same thing.
    for (const kind of CUSTOM_FIELD_KINDS) {
      expect(ok(kind, ''), kind).toBeNull();
      expect(ok(kind, null), kind).toBeNull();
      expect(ok(kind, []), kind).toBeNull();
    }
  });

  it('normalizes text to NFC and trims it', () => {
    // Two Khmer strings that look identical and are not compare as different,
    // which makes a filter miss the row somebody is looking at (§13).
    const composed = ok('text', '  Angkoŕ  ');
    expect(composed?.text).toBe('Angkoŕ'.trim().normalize('NFC'));
  });

  it('refuses text longer than the field allows', () => {
    const parsed = parseValue('text', 'x'.repeat(MAX_TEXT_LENGTH + 1));
    expect(parsed).toEqual({ ok: false, problem: 'value_too_long' });
  });

  it('counts length by grapheme, so Khmer is not cut short of the limit', () => {
    // A Khmer syllable is several code points. Counting UTF-16 units would
    // refuse a value less than half the length the field claims to take.
    const syllable = 'ក្ន';
    const parsed = parseValue('text', syllable.repeat(MAX_TEXT_LENGTH - 1));
    expect(parsed.ok).toBe(true);
  });

  it('keeps a number as the string that was typed', () => {
    // The column is numeric precisely so a total keeps its precision; a round
    // trip through a double is where that would quietly go.
    expect(ok('number', '10.50')?.number).toBe('10.50');
    expect(ok('number', '-3')?.number).toBe('-3');
  });

  it('refuses everything that is not a plain decimal number', () => {
    for (const raw of ['0x10', 'Infinity', '1e3', '1,5', 'twelve', '--1']) {
      expect(parseValue('number', raw), raw).toEqual({
        ok: false,
        problem: 'value_not_a_number',
      });
    }
  });

  it('refuses a date that looks well-formed but is not a day', () => {
    expect(ok('date', '2026-02-28')?.date).toBe('2026-02-28');
    // `new Date('2026-02-31')` rolls silently to 2 March, which is how a wrong
    // date ends up in a report nobody questions.
    expect(parseValue('date', '2026-02-31')).toEqual({ ok: false, problem: 'value_not_a_date' });
    expect(parseValue('date', '2026-13-01')).toEqual({ ok: false, problem: 'value_not_a_date' });
    expect(parseValue('date', '02/03/2026')).toEqual({ ok: false, problem: 'value_not_a_date' });
  });

  it('stores a checkbox only when it is ticked', () => {
    expect(ok('checkbox', '1')?.checkbox).toBe(true);
    expect(ok('checkbox', 'on')?.checkbox).toBe(true);
    // An unticked box posts nothing at all, and "no row" is the answer that is
    // also correct for every item that existed before the field did.
    expect(ok('checkbox', '0')).toBeNull();
    expect(ok('checkbox', [])).toBeNull();
  });

  it('caps a single select at one option and lets multi-select take several', () => {
    const options = [OPTION_A, OPTION_B];
    expect(ok('select', [OPTION_A], options)?.optionIds).toEqual([OPTION_A]);
    expect(parseValue('select', [OPTION_A, OPTION_B], { optionIds: options })).toEqual({
      ok: false,
      problem: 'value_too_many',
    });
    expect(ok('multi_select', [OPTION_A, OPTION_B], options)?.optionIds).toEqual([
      OPTION_A,
      OPTION_B,
    ]);
  });

  it('refuses an option this field does not have, rather than dropping it', () => {
    // Silently storing four of five choices is worse than saying which one no
    // longer exists — a form left open while somebody deleted the option.
    expect(parseValue('multi_select', [OPTION_A, MEMBER], { optionIds: [OPTION_A] })).toEqual({
      ok: false,
      problem: 'value_not_an_option',
    });
  });

  it('collapses duplicate options', () => {
    expect(ok('multi_select', [OPTION_A, OPTION_A], [OPTION_A])?.optionIds).toEqual([OPTION_A]);
  });

  it('takes a member id for a user field and refuses anything else', () => {
    expect(ok('user', MEMBER)?.memberId).toBe(MEMBER);
    expect(parseValue('user', 'sophea')).toEqual({ ok: false, problem: 'value_not_an_option' });
  });
});

describe('valueToStrings', () => {
  it('round-trips every kind back through the parser', () => {
    // The property that makes the panel safe: what a control renders is what it
    // posts, and what it posts parses back to what was stored.
    const cases: [CustomFieldKind, string | string[], string[]?][] = [
      ['text', 'Acme Ltd'],
      ['number', '10.50'],
      ['date', '2026-09-03'],
      ['checkbox', '1'],
      ['user', MEMBER],
      ['select', [OPTION_A], [OPTION_A, OPTION_B]],
      ['multi_select', [OPTION_A, OPTION_B], [OPTION_A, OPTION_B]],
    ];

    for (const [kind, raw, options] of cases) {
      const stored = ok(kind, raw, options);
      const strings = valueToStrings(stored);
      expect(ok(kind, strings, options), kind).toEqual(stored);
    }
  });

  it('is an empty list for no value', () => {
    expect(valueToStrings(null)).toEqual([]);
  });
});

describe('sameValue', () => {
  it('is what stops a save that changed nothing from emitting an event', () => {
    expect(sameValue(ok('text', 'a'), ok('text', 'a'))).toBe(true);
    expect(sameValue(ok('text', 'a'), ok('text', 'b'))).toBe(false);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, ok('text', 'a'))).toBe(false);
  });

  it('compares option lists in order, so a reorder is a change', () => {
    const options = [OPTION_A, OPTION_B];
    expect(
      sameValue(ok('multi_select', [OPTION_A, OPTION_B], options), ok('multi_select', [OPTION_B, OPTION_A], options)),
    ).toBe(false);
  });
});

describe('grouping keys', () => {
  it('round-trips a field id through the `custom:` prefix', () => {
    expect(customFieldIdOf(customGroupBy(OPTION_A))).toBe(OPTION_A);
  });

  it('is null for a built-in grouping or a malformed one', () => {
    for (const value of ['state', 'assignee', 'custom:', 'custom:nope', 'custom', OPTION_A]) {
      expect(customFieldIdOf(value), value).toBeNull();
    }
  });

  it('allows grouping only by the kinds whose keys can be enumerated', () => {
    // §9 hands the page query its groups rather than discovering them, so a
    // free-text field has no set to hand it — see GROUPABLE_KINDS.
    expect([...GROUPABLE_KINDS].sort()).toEqual(
      ['checkbox', 'multi_select', 'select', 'user'].sort(),
    );
    expect(isGroupable('text')).toBe(false);
    expect(isGroupable('number')).toBe(false);
    expect(isGroupable('date')).toBe(false);
  });
});

describe('operatorSuits', () => {
  it('lets every kind answer "has a value"', () => {
    for (const kind of CUSTOM_FIELD_KINDS) expect(operatorSuits('set', kind), kind).toBe(true);
  });

  it('pairs each remaining operator with the kinds that can answer it', () => {
    expect(operatorSuits('has', 'text')).toBe(true);
    expect(operatorSuits('has', 'date')).toBe(false);
    expect(operatorSuits('range', 'number')).toBe(true);
    expect(operatorSuits('range', 'date')).toBe(true);
    expect(operatorSuits('range', 'text')).toBe(false);
    expect(operatorSuits('in', 'select')).toBe(true);
    expect(operatorSuits('in', 'user')).toBe(true);
    expect(operatorSuits('in', 'checkbox')).toBe(false);
    expect(operatorSuits('is', 'checkbox')).toBe(true);
    expect(operatorSuits('is', 'select')).toBe(false);
    expect(operatorSuits('nonsense', 'text')).toBe(false);
  });
});

describe('isCalendarDate', () => {
  it('accepts real days and refuses the rest', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-9-3')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });
});
