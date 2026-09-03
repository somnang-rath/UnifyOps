import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, dueBucket, isOverdue, isTimeZone, todayIn } from './workspace-date';

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
