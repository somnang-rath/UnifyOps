import { describe, expect, it } from 'vitest';
import {
  BINDINGS,
  CHORD_TIMEOUT_MS,
  SHORTCUTS,
  advance,
  describeBinding,
  isMacLike,
  keystrokeOf,
  matchSequence,
} from './shortcuts';

const event = (
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
) => ({
  key,
  ctrlKey: modifiers.ctrlKey ?? false,
  metaKey: modifiers.metaKey ?? false,
  altKey: modifiers.altKey ?? false,
});

describe('keystrokeOf', () => {
  // One name for one intent: §7.9 writes `⌘K`, a Windows user presses Ctrl, and
  // the binding table should not have to know which.
  it('folds Command and Control into one modifier', () => {
    expect(keystrokeOf(event('k', { metaKey: true }))).toBe('mod+k');
    expect(keystrokeOf(event('k', { ctrlKey: true }))).toBe('mod+k');
  });

  it('lower-cases single characters, so caps lock does not break a chord', () => {
    expect(keystrokeOf(event('G'))).toBe('g');
    expect(keystrokeOf(event('g'))).toBe('g');
  });

  it('leaves named keys alone', () => {
    expect(keystrokeOf(event('Escape'))).toBe('Escape');
    expect(keystrokeOf(event('ArrowDown'))).toBe('ArrowDown');
  });

  // AltGr produces characters on a Khmer layout. A binding that ate them would
  // make the product unusable in one of its two languages, so Alt is namespaced
  // away from every binding rather than ignored.
  it('never produces a bare key when Alt is held', () => {
    expect(keystrokeOf(event('m', { altKey: true }))).toBe('alt+m');
    expect(matchSequence(['alt+m'])).toEqual({ kind: 'none' });
  });
});

describe('matchSequence', () => {
  it('matches a single-key binding', () => {
    expect(matchSequence(['mod+k'])).toEqual({ kind: 'match', id: 'palette' });
    expect(matchSequence(['/'])).toEqual({ kind: 'match', id: 'search' });
    expect(matchSequence(['?'])).toEqual({ kind: 'match', id: 'help' });
  });

  // "Wait" is a real answer. Treating it as "no" is what makes a chord fire only
  // when you type it twice.
  it('reports a chord prefix as pending, not as a miss', () => {
    expect(matchSequence(['g'])).toEqual({ kind: 'pending' });
    expect(matchSequence(['g', 'm'])).toEqual({ kind: 'match', id: 'goMyWork' });
    expect(matchSequence(['g', 'z'])).toEqual({ kind: 'none' });
  });

  it('has no binding for the empty sequence', () => {
    expect(matchSequence([])).toEqual({ kind: 'none' });
  });
});

describe('advance', () => {
  it('carries a chord across two keys', () => {
    const first = advance([], 'g', { now: 1_000, lastAt: 1_000 });
    expect(first.result).toEqual({ kind: 'pending' });

    const second = advance(first.buffer, 'i', { now: 1_200, lastAt: 1_000 });
    expect(second.result).toEqual({ kind: 'match', id: 'goInbox' });
    expect(second.buffer).toEqual([]);
  });

  /**
   * The failure that matters. A chord with no timeout makes every later
   * keystroke unpredictable, which is exactly what teaches people to stop using
   * shortcuts.
   */
  it('drops a stale chord rather than completing it a minute later', () => {
    const stale = advance(['g'], 'i', {
      now: 1_000 + CHORD_TIMEOUT_MS + 1,
      lastAt: 1_000,
    });
    expect(stale.result).toEqual({ kind: 'none' });
    expect(stale.buffer).toEqual([]);
  });

  // Pressing `g` and then `⌘K` should open the palette, not be swallowed as the
  // failed second half of a chord.
  it('retries a dead-end key on its own', () => {
    const next = advance(['g'], 'mod+k', { now: 1_100, lastAt: 1_000 });
    expect(next.result).toEqual({ kind: 'match', id: 'palette' });
  });

  it('restarts a chord when the dead-end key is itself a prefix', () => {
    const next = advance(['g'], 'g', { now: 1_100, lastAt: 1_000 });
    expect(next.result).toEqual({ kind: 'pending' });
    expect(next.buffer).toEqual(['g']);
  });
});

describe('the binding table', () => {
  it('gives every shortcut exactly one binding', () => {
    expect(BINDINGS.map((binding) => binding.id).sort()).toEqual([...SHORTCUTS].sort());
  });

  // Two bindings where one is a prefix of the other would make the shorter one
  // unreachable — it would sit pending forever, waiting for a second key.
  it('has no binding that is a prefix of another', () => {
    for (const binding of BINDINGS) {
      const shadowed = BINDINGS.filter(
        (other) =>
          other !== binding &&
          other.sequence.length > binding.sequence.length &&
          binding.sequence.every((key, index) => other.sequence[index] === key),
      );
      expect(shadowed, binding.id).toEqual([]);
    }
  });
});

describe('describeBinding', () => {
  it('renders the modifier as the platform names it', () => {
    const palette = BINDINGS.find((binding) => binding.id === 'palette');
    expect(describeBinding(palette!, 'mac')).toEqual(['⌘K']);
    expect(describeBinding(palette!, 'other')).toEqual(['CtrlK']);
  });

  it('renders a chord as two caps', () => {
    const goMyWork = BINDINGS.find((binding) => binding.id === 'goMyWork');
    expect(describeBinding(goMyWork!, 'mac')).toEqual(['G', 'M']);
  });

  it('detects Apple platforms', () => {
    expect(isMacLike('MacIntel')).toBe(true);
    expect(isMacLike('iPhone')).toBe(true);
    expect(isMacLike('Win32')).toBe(false);
    expect(isMacLike('Linux x86_64')).toBe(false);
  });
});
