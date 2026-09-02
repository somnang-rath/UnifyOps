import { describe, expect, it } from 'vitest';
import { displayName } from './seeded-name';
import { compareStateGroups, defaultColorFor, isClosedGroup, STATE_GROUPS } from './state-groups';

/**
 * §13's awkward middle, pinned.
 *
 * A seeded default renders translated until a person renames it, and then their
 * literal wins for good. Getting this backwards shows a Khmer workspace the
 * English word "Done" — or, worse, shows everyone the raw message key.
 */

const catalogue: Record<string, string> = {
  'defaultState.done': 'ធ្វើរួច',
  'defaultTeam.general': 'ទូទៅ',
};

const t = (key: string): string => catalogue[key] ?? key;

describe('displayName', () => {
  it('translates a seeded name through its key', () => {
    expect(displayName({ name: 'Done', nameKey: 'defaultState.done' }, t)).toBe('ធ្វើរួច');
  });

  it('uses the literal once the key is cleared by a rename', () => {
    expect(displayName({ name: 'Shipped', nameKey: null }, t)).toBe('Shipped');
  });

  it('falls back to the literal rather than rendering a raw key at a user', () => {
    // The catalogues are checked key-for-key by messages.test.ts, so this should
    // never happen — but "Done" is a better failure than "defaultState.done".
    expect(displayName({ name: 'Done', nameKey: 'defaultState.missing' }, t)).toBe('Done');
  });

  it('survives a translator that throws on an unknown key', () => {
    const throwing = (key: string): string => {
      throw new Error(`no such key: ${key}`);
    };
    expect(displayName({ name: 'Todo', nameKey: 'defaultState.todo' }, throwing)).toBe('Todo');
  });
});

describe('state groups', () => {
  it('orders the way a board reads, not alphabetically', () => {
    const shuffled = [...STATE_GROUPS].sort();
    expect([...shuffled].sort(compareStateGroups)).toEqual([...STATE_GROUPS]);
  });

  // §4: progress and "is it done" derive from the group. Cancelled work is off
  // the active surface too — it was not finished, but it is not outstanding.
  it('treats completed and cancelled as closed', () => {
    expect(STATE_GROUPS.filter(isClosedGroup)).toEqual(['completed', 'cancelled']);
  });

  it('gives every group a default colour', () => {
    for (const group of STATE_GROUPS) {
      expect(defaultColorFor(group), group).toBeTruthy();
    }
  });
});
