import { describe, expect, it } from 'vitest';
import {
  MAX_CYCLE_DAYS,
  addDays,
  burndownStanding,
  calendarDaysBetween,
  cycleStatus,
  emptyCounts,
  isOpen,
  progressFrom,
  validatePeriod,
  withIdealLine,
} from './cycles';

const period = (startDate: string, endDate: string, completedAt: Date | null = null) => ({
  startDate,
  endDate,
  completedAt,
});

describe('cycleStatus', () => {
  it('derives the four situations from two dates and today', () => {
    const cycle = period('2026-09-07', '2026-09-20');

    expect(cycleStatus(cycle, '2026-09-01')).toBe('upcoming');
    expect(cycleStatus(cycle, '2026-09-07')).toBe('active');
    expect(cycleStatus(cycle, '2026-09-14')).toBe('active');
    expect(cycleStatus(cycle, '2026-09-20')).toBe('active');
    expect(cycleStatus(cycle, '2026-09-21')).toBe('ended');
  });

  /**
   * The distinction §7.6's prompt depends on. `ended` puts a decision in front
   * of somebody; `completed` records that they made one. A status that could
   * not tell them apart would either nag forever or never ask.
   */
  it('separates "the end date passed" from "somebody answered the prompt"', () => {
    const answered = period('2026-09-07', '2026-09-20', new Date('2026-09-21T10:00:00Z'));

    expect(cycleStatus(period('2026-09-07', '2026-09-20'), '2026-09-25')).toBe('ended');
    expect(cycleStatus(answered, '2026-09-25')).toBe('completed');
  });

  /** Closing early is legitimate: the sprint finished, so the prompt is answered. */
  it('reports a cycle closed before its end date as completed, not active', () => {
    const closed = period('2026-09-07', '2026-09-20', new Date('2026-09-10T10:00:00Z'));
    expect(cycleStatus(closed, '2026-09-11')).toBe('completed');
  });

  it('only lets work be planned into a cycle that has not closed', () => {
    expect(isOpen('upcoming')).toBe(true);
    expect(isOpen('active')).toBe(true);
    expect(isOpen('ended')).toBe(false);
    expect(isOpen('completed')).toBe(false);
  });
});

describe('validatePeriod', () => {
  const valid = { name: 'Sprint 14', startDate: '2026-09-07', endDate: '2026-09-20' };

  it('accepts a two-week cycle', () => {
    expect(validatePeriod(valid)).toBeNull();
  });

  it('accepts a single-day cycle', () => {
    expect(validatePeriod({ ...valid, endDate: valid.startDate })).toBeNull();
  });

  it('refuses a range that ends before it starts', () => {
    expect(validatePeriod({ ...valid, endDate: '2026-09-01' })).toBe('end_before_start');
  });

  it('refuses anything that is not a calendar date', () => {
    expect(validatePeriod({ ...valid, startDate: '07/09/2026' })).toBe('invalid_dates');
    expect(validatePeriod({ ...valid, endDate: '' })).toBe('invalid_dates');
  });

  it('requires a name and trims it before deciding', () => {
    expect(validatePeriod({ ...valid, name: '   ' })).toBe('name_required');
  });

  /**
   * The §13 rule, pointed at a cap rather than at truncation. `[...text].length`
   * counts code points, which gives a Khmer workspace roughly a third of the
   * field an English one gets — one syllable is routinely three or four.
   */
  it('counts the name by grapheme, not code point', () => {
    // Six Khmer graphemes, considerably more code points.
    const khmer = 'ព្រឹត្តិការណ៍';
    expect([...khmer].length).toBeGreaterThan(6);
    expect(validatePeriod({ ...valid, name: khmer.repeat(3) })).toBeNull();
  });

  it('refuses a name past the cap', () => {
    expect(validatePeriod({ ...valid, name: 'x'.repeat(61) })).toBe('name_too_long');
  });

  /** The bound exists so the burndown cannot be asked for 36,000 rows by a typo. */
  it('refuses a range longer than the burndown can draw', () => {
    const start = '2026-01-01';
    expect(validatePeriod({ ...valid, startDate: start, endDate: addDays(start, MAX_CYCLE_DAYS - 1) })).toBeNull();
    expect(validatePeriod({ ...valid, startDate: start, endDate: addDays(start, MAX_CYCLE_DAYS) })).toBe('too_long');
  });

  /** §7.6: "overlapping cycles → allowed, warned". A warning is not a refusal. */
  it('says nothing about overlap, which is a warning and not a validation failure', () => {
    expect(validatePeriod(valid)).toBeNull();
  });
});

describe('date arithmetic', () => {
  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(calendarDaysBetween('2028-02-01', '2028-03-01')).toBe(29);
  });

  it('is signed, so one call answers both directions', () => {
    expect(calendarDaysBetween('2026-09-07', '2026-09-20')).toBe(13);
    expect(calendarDaysBetween('2026-09-20', '2026-09-07')).toBe(-13);
  });
});

describe('progressFrom', () => {
  const counts = (over: Partial<ReturnType<typeof emptyCounts>>) => ({ ...emptyCounts(), ...over });

  it('derives the bar from the state group, never from a count of "done"', () => {
    const progress = progressFrom(counts({ started: 3, completed: 7 }));

    expect(progress.total).toBe(10);
    expect(progress.completed).toBe(7);
    expect(progress.percent).toBe(70);
  });

  /**
   * §4 gives `cancelled` its own group precisely so this can be a third answer.
   * Counted as done, a team hits 100% by abandoning the sprint; counted as
   * outstanding, the cycle never finishes for work somebody decided not to do.
   */
  it('takes cancelled work out of the denominator rather than either side of it', () => {
    const progress = progressFrom(counts({ completed: 5, cancelled: 5 }));

    expect(progress.total).toBe(10);
    expect(progress.inScope).toBe(5);
    expect(progress.percent).toBe(100);
  });

  it('reports an empty cycle as 0%, not NaN and not complete', () => {
    const progress = progressFrom(emptyCounts());
    expect(progress.percent).toBe(0);
  });

  /** §17-9 hides estimates by default; a cycle nobody estimated shows no points. */
  it('reports points only when somebody actually estimated', () => {
    expect(progressFrom(counts({ started: 2 }), { total: 0, completed: 0 }).estimate).toBeNull();
    expect(progressFrom(counts({ started: 2 }), { total: 8, completed: 3 })?.estimate).toEqual({
      total: 8,
      completed: 3,
    });
  });
});

describe('withIdealLine', () => {
  const day = (date: string, working: boolean, remaining: number | null = null) => ({
    date,
    remaining,
    working,
  });

  /**
   * The reason §9 puts `business_days_between` behind one SQL function, as
   * arithmetic. A Monday-to-Saturday market (§2.5, and the schema's default of
   * 63) works twelve days in a two-week cycle, not fourteen — and an ideal line
   * that descended across the Sundays would tell a team they were behind every
   * Monday morning.
   */
  it('holds the ideal line flat across a non-working day', () => {
    const points = withIdealLine(
      [
        day('2026-09-07', true),
        day('2026-09-08', true),
        day('2026-09-09', false),
        day('2026-09-10', true),
        day('2026-09-11', true),
      ],
      4,
    );

    expect(points.map((p) => p.ideal)).toEqual([3, 2, 2, 1, 0]);
  });

  it('reaches zero on the last working day', () => {
    const points = withIdealLine(
      [day('2026-09-07', true), day('2026-09-08', true), day('2026-09-09', false)],
      6,
    );

    expect(points.at(-1)?.ideal).toBe(0);
  });

  /**
   * A range sitting entirely inside a holiday cluster — Khmer New Year is
   * multi-day (§17-18) — is a planning mistake somebody should be able to see,
   * not a division by zero that takes the page down.
   */
  it('falls back to calendar days when the cycle contains no working day at all', () => {
    const points = withIdealLine([day('2026-04-14', false), day('2026-04-15', false)], 2);

    expect(points.map((p) => p.ideal)).toEqual([1, 0]);
  });

  it('draws nothing for an empty range', () => {
    expect(withIdealLine([], 5)).toEqual([]);
  });

  it('carries the future through as null rather than inventing a number', () => {
    const points = withIdealLine([day('2026-09-07', true, 4), day('2026-09-08', true, null)], 4);

    expect(points.map((p) => p.remaining)).toEqual([4, null]);
  });
});

describe('burndownStanding', () => {
  const points = (pairs: [number | null, number][]) =>
    pairs.map(([remaining, ideal], index) => ({
      date: addDays('2026-09-07', index),
      remaining,
      ideal,
      working: true,
    }));

  /**
   * Compared at the last day that has actually happened. Against the *final*
   * ideal of zero, every cycle reads as behind until its last afternoon.
   */
  it('judges today against today, not against the end of the cycle', () => {
    expect(burndownStanding(points([[8, 8], [5, 6], [null, 4], [null, 2], [null, 0]]))).toBe(
      'ahead',
    );
  });

  it('reports behind and on track', () => {
    expect(burndownStanding(points([[9, 6], [null, 3]]))).toBe('behind');
    expect(burndownStanding(points([[6, 6], [null, 3]]))).toBe('on_track');
  });

  it('says nothing about a cycle that has not started', () => {
    expect(burndownStanding(points([[null, 4], [null, 0]]))).toBeNull();
    expect(burndownStanding([])).toBeNull();
  });
});
