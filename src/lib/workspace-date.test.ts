import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  dueBucket,
  hourIn,
  isOverdue,
  isTimeZone,
  todayIn,
} from './workspace-date';

/**
 * §17-13: "Overdue had no timezone authority — RESOLVED. Workspace timezone,
 * not device. Device timezone makes an item late for one person and on time for
 * another, turning a shared number into an argument."
 *
 * The first test is that finding, written as an assertion.
 */

describe('todayIn', () => {
  it('answers in the company timezone, not the machine running the code', () => {
    // 22:30 UTC. It is already tomorrow in Phnom Penh (+07) and still
    // yesterday-evening in Los Angeles — the same instant, two calendar days.
    const instant = new Date('2026-09-02T22:30:00Z');

    expect(todayIn('Asia/Phnom_Penh', instant)).toBe('2026-09-03');
    expect(todayIn('UTC', instant)).toBe('2026-09-02');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-09-02');
  });

  it('formats as YYYY-MM-DD, matching how a due date is stored', () => {
    expect(todayIn('Asia/Phnom_Penh', new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05');
  });
});

describe('isTimeZone', () => {
  it('accepts real zones and rejects invented ones', () => {
    expect(isTimeZone('Asia/Phnom_Penh')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Middle/Earth')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts whole days, in both directions', () => {
    expect(daysBetween('2026-09-02', '2026-09-09')).toBe(7);
    expect(daysBetween('2026-09-09', '2026-09-02')).toBe(-7);
    expect(daysBetween('2026-09-02', '2026-09-02')).toBe(0);
  });

  it('is unaffected by daylight saving, because it never leaves UTC', () => {
    // A naive local-time implementation returns 0 or 2 for this span in a zone
    // that changes offset inside it.
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
  });
});

describe('dueBucket', () => {
  const today = '2026-09-02';

  it('sorts a date into the buckets §7.3 groups My Work by', () => {
    expect(dueBucket('2026-08-30', today)).toBe('overdue');
    expect(dueBucket('2026-09-02', today)).toBe('today');
    expect(dueBucket('2026-09-05', today)).toBe('week');
    expect(dueBucket('2026-09-09', today)).toBe('later');
    expect(dueBucket(null, today)).toBe('none');
  });

  it('does not call finished work overdue, however late it was', () => {
    // §7.4's surface exists to show what still needs doing. Reporting work that
    // is already done is how a "needs attention" list teaches people to ignore
    // it.
    expect(dueBucket('2026-08-30', today, { completed: true })).not.toBe('overdue');
    expect(isOverdue('2026-08-30', today, { completed: true })).toBe(false);
    expect(isOverdue('2026-08-30', today)).toBe(true);
  });

  it('treats the seventh day out as later, so "this week" is a week', () => {
    expect(dueBucket('2026-09-08', today)).toBe('week');
    expect(dueBucket('2026-09-09', today)).toBe('later');
  });
});

/**
 * §7.8's digest goes out "per person per evening, in the workspace timezone",
 * and the hourly tick that decides whose evening it is asks this.
 */
describe('hourIn', () => {
  it('answers in the company timezone, like every other date question here', () => {
    // 11:00 UTC is 18:00 in Phnom Penh — the digest hour there, and the middle
    // of the morning in Los Angeles.
    const instant = new Date('2026-09-03T11:00:00Z');

    expect(hourIn('Asia/Phnom_Penh', instant)).toBe(18);
    expect(hourIn('UTC', instant)).toBe(11);
    expect(hourIn('America/Los_Angeles', instant)).toBe(4);
  });

  it('reports midnight as 0, not 24', () => {
    // `h23` is pinned for exactly this: some runtimes render midnight as 24
    // under the default hour cycle, and an hourly tick comparing against a
    // constant would then never fire at midnight or fire twice at noon.
    expect(hourIn('UTC', new Date('2026-09-03T00:00:00Z'))).toBe(0);
    expect(hourIn('UTC', new Date('2026-09-03T23:59:00Z'))).toBe(23);
  });

  it('handles a half-hour offset without rounding the hour the wrong way', () => {
    // +05:45. A zone whose offset is not a whole hour is where a naive
    // implementation using arithmetic on the UTC hour goes wrong.
    expect(hourIn('Asia/Kathmandu', new Date('2026-09-03T12:20:00Z'))).toBe(18);
  });
});
