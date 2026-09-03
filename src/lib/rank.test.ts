import { describe, expect, it } from 'vitest';
import { RankError, firstRank, isRank, rankAfter, rankBetween } from './rank';

/**
 * §15 lists rank generation among the pure logic that must have unit tests, and
 * §9 says why: a stale drag has to land correctly relative to present state,
 * "this is what stops boards feeling haunted". Every property below is one a
 * board depends on.
 */

describe('rankBetween', () => {
  it('produces a key strictly between its neighbours', () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    const mid = rankBetween(a, b);

    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('never runs out of room between two adjacent keys', () => {
    // The property the whole scheme exists for: insert at the same point a
    // hundred times and there is still somewhere to go, with no renumbering.
    let low = rankBetween(null, null);
    const high = rankBetween(low, null);

    for (let i = 0; i < 100; i += 1) {
      const next = rankBetween(low, high);
      expect(low < next).toBe(true);
      expect(next < high).toBe(true);
      low = next;
    }
  });

  it('keeps a list ordered when every insertion is at the front', () => {
    const keys: string[] = [rankBetween(null, null)];
    for (let i = 0; i < 50; i += 1) {
      keys.unshift(rankBetween(null, keys[0]!));
    }

    expect([...keys].sort()).toEqual(keys);
  });

  it('keeps a list ordered when every insertion is at the back', () => {
    const keys: string[] = [rankBetween(null, null)];
    for (let i = 0; i < 50; i += 1) {
      keys.push(rankBetween(keys.at(-1)!, null));
    }

    expect([...keys].sort()).toEqual(keys);
  });

  it('refuses neighbours that are out of order', () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);

    expect(() => rankBetween(b, a)).toThrow(RankError);
    expect(() => rankBetween(a, a)).toThrow(RankError);
  });

  it('refuses a key that could not have come from this module', () => {
    // A trailing zero has nothing beneath it, so accepting one would produce a
    // neighbour pair with no midpoint — a board that silently cannot be
    // dragged into one particular gap.
    expect(() => rankBetween('a0', null)).toThrow(RankError);
    expect(() => rankBetween('AZ', null)).toThrow(RankError);
    expect(() => rankBetween('', null)).toThrow(RankError);
  });

  it('only ever emits keys it would accept back', () => {
    let key = firstRank();
    for (let i = 0; i < 200; i += 1) {
      expect(isRank(key)).toBe(true);
      key = rankBetween(null, key);
    }
  });
});

describe('rankAfter', () => {
  it('sorts after the key it follows', () => {
    const a = firstRank();
    expect(a < rankAfter(a)).toBe(true);
  });

  it('starts a list when there is nothing to follow', () => {
    expect(isRank(rankAfter(null))).toBe(true);
  });

  it('jitters, so two simultaneous appends do not collide', () => {
    // The §9 reason: both requests read the same last rank, and identical keys
    // make two cards swap places on every reload until somebody drags one.
    const last = firstRank();
    const keys = new Set(Array.from({ length: 200 }, () => rankAfter(last)));
    expect(keys.size).toBeGreaterThan(100);
  });

  it('produces a jittered key that is still a legal key', () => {
    // Deterministic worst case: a random source that always picks the lowest
    // digit would append a trailing zero, and a trailing zero is unusable.
    const key = rankAfter(firstRank(), () => 0);
    expect(isRank(key)).toBe(true);
    expect(() => rankBetween(key, null)).not.toThrow();
  });
});

describe('isRank', () => {
  it('rejects anything the ordering could not rely on', () => {
    expect(isRank('a0')).toBe(false);
    expect(isRank('')).toBe(false);
    expect(isRank('A')).toBe(false);
    expect(isRank('a-b')).toBe(false);
    expect(isRank(42)).toBe(false);
    expect(isRank(null)).toBe(false);
  });
});
