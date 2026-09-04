import { describe, expect, it } from 'vitest';
import {
  MAX_REASON_GRAPHEMES,
  MAX_UNAVAILABLE_DAYS,
  daysAway,
  isAway,
  validateAvailability,
} from './availability';

/**
 * §4's availability flag, and §17-25's correction.
 *
 * These pin the two things that would otherwise be re-decided at each call site:
 * **which side of the date "until" falls on**, and **what a reason is measured
 * in**. Both are one-line rules, and both are the kind that two call sites
 * eventually disagree about by exactly one.
 */

const TODAY = '2026-09-03';

describe('isAway', () => {
  it('treats the return date as a working day, not the last day away', () => {
    // "Back on the 3rd" means they are here on the 3rd. That is the reading the
    // form's label promises ("Back on"), and it is the whole reason this is a
    // function rather than a `>=` written twice.
    expect(isAway({ unavailableUntil: '2026-09-03', unavailableReason: null }, TODAY)).toBe(false);
    expect(isAway({ unavailableUntil: '2026-09-04', unavailableReason: null }, TODAY)).toBe(true);
  });

  it('is over when the date has passed, with no cleanup job to run', () => {
    // Derived rather than stored, exactly as a cycle's status is (slice 11). A
    // stored "is_away" would need something to flip it, and a missed flip is a
    // member who reads as on leave forever.
    expect(isAway({ unavailableUntil: '2026-08-01', unavailableReason: 'leave' }, TODAY)).toBe(false);
  });

  it('is false when nothing is set', () => {
    expect(isAway({ unavailableUntil: null, unavailableReason: null }, TODAY)).toBe(false);
  });
});

describe('daysAway', () => {
  it('counts calendar days, not working days', () => {
    // A person on leave is away on Sunday too. Working-day arithmetic belongs to
    // staleness and the digest; nothing about availability reads the company's
    // calendar, and conflating the two would make "back in 3 days" mean
    // something different in a six-day week.
    expect(daysAway({ unavailableUntil: '2026-09-10', unavailableReason: null }, TODAY)).toBe(7);
  });

  it('is null for somebody who is here', () => {
    expect(daysAway({ unavailableUntil: null, unavailableReason: null }, TODAY)).toBeNull();
  });
});

describe('validateAvailability', () => {
  it('accepts a future date, with or without a reason', () => {
    expect(validateAvailability({ until: '2026-09-20', reason: null }, TODAY)).toEqual({ ok: true });
    expect(validateAvailability({ until: '2026-09-20', reason: 'Leave' }, TODAY)).toEqual({
      ok: true,
    });
  });

  it('refuses a past date rather than silently clearing it', () => {
    // "Unavailable until yesterday" is a typo every time — they meant a year
    // they did not type. Clearing it would report success for a change nobody
    // made, which is the worst of the three available behaviours.
    expect(validateAvailability({ until: '2026-09-01', reason: null }, TODAY)).toEqual({
      ok: false,
      problem: 'past_date',
    });
    expect(validateAvailability({ until: TODAY, reason: null }, TODAY)).toEqual({
      ok: false,
      problem: 'past_date',
    });
  });

  it('refuses a date more than a year out', () => {
    const far = '2027-09-05';
    expect(validateAvailability({ until: far, reason: null }, TODAY)).toEqual({
      ok: false,
      problem: 'too_far',
    });
  });

  it('clears cleanly when the date is empty', () => {
    expect(validateAvailability({ until: null, reason: null }, TODAY)).toEqual({ ok: true });
  });

  it('refuses a reason with nothing to explain', () => {
    // Migration 0024 has the same rule as a CHECK. Refused rather than dropped,
    // so the form can point at the field instead of quietly discarding what
    // somebody typed.
    expect(validateAvailability({ until: null, reason: 'Leave' }, TODAY)).toEqual({
      ok: false,
      problem: 'reason_without_date',
    });
  });

  it('counts the reason by grapheme, so Khmer gets the same room as English', () => {
    /**
     * §13, and the defect slice 10 found in its own length cap. `[...text].length`
     * counts code points and one Khmer syllable is routinely three or four of
     * them, so a cap enforced that way refuses text that visibly fits.
     *
     * `ស្រី` is one grapheme and four code points. A reason of exactly the cap in
     * *graphemes* must be accepted whichever script it is written in.
     */
    const khmer = 'ស្រី'.repeat(MAX_REASON_GRAPHEMES);
    expect([...khmer].length).toBeGreaterThan(MAX_REASON_GRAPHEMES);
    expect(validateAvailability({ until: '2026-09-20', reason: khmer }, TODAY)).toEqual({
      ok: true,
    });

    const tooLong = 'ស្រី'.repeat(MAX_REASON_GRAPHEMES + 1);
    expect(validateAvailability({ until: '2026-09-20', reason: tooLong }, TODAY)).toEqual({
      ok: false,
      problem: 'reason_too_long',
    });
  });

  it('ignores whitespace-only reasons', () => {
    expect(validateAvailability({ until: null, reason: '   ' }, TODAY)).toEqual({ ok: true });
  });

  it('keeps the year bound and the reason cap where the UI can read them', () => {
    // Both are rendered into the form's help text, so a change to either is a
    // change to a sentence somebody reads.
    expect(MAX_UNAVAILABLE_DAYS).toBe(365);
    expect(MAX_REASON_GRAPHEMES).toBeGreaterThan(0);
  });
});
