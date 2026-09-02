import { describe, expect, it } from 'vitest';
import {
  KEY_MAX_LENGTH,
  deriveProjectKey,
  normalizeProjectKey,
  projectKeyProblem,
} from './project-key';

/**
 * The prefix is permanent in practice — §4 says human identifiers are never
 * reused, and by the time anyone regrets one it is in a hundred chat messages.
 * So the derivation is pinned here rather than left to be discovered later.
 */

describe('normalizeProjectKey', () => {
  it('uppercases and strips everything that is not a letter or digit', () => {
    expect(normalizeProjectKey('web-2')).toBe('WEB2');
    expect(normalizeProjectKey('  ops  ')).toBe('OPS');
    expect(normalizeProjectKey('Café')).toBe('CAFE');
  });

  it('romanises Khmer, so an IME in the name field still gives a typeable prefix', () => {
    expect(normalizeProjectKey('ការងារ')).toBe('KARNG');
  });

  it('caps at the maximum length rather than rejecting', () => {
    // The field is being typed into. Refusing a character mid-word is a worse
    // experience than simply not accepting a seventh one.
    expect(normalizeProjectKey('ENGINEERING').length).toBe(KEY_MAX_LENGTH);
  });
});

describe('projectKeyProblem', () => {
  it('accepts two to five characters beginning with a letter', () => {
    expect(projectKeyProblem('WEB')).toBeNull();
    expect(projectKeyProblem('A1')).toBeNull();
    expect(projectKeyProblem('ABCDE')).toBeNull();
  });

  it('refuses a single character and an empty key', () => {
    expect(projectKeyProblem('A')).toBe('too_short');
    expect(projectKeyProblem('')).toBe('too_short');
  });

  // `142-7` would otherwise be a plausible-looking identifier that means
  // nothing — ambiguous with the item number it precedes.
  it('refuses a leading digit', () => {
    expect(projectKeyProblem('1AB')).toBe('invalid');
  });

  it('refuses lowercase and punctuation, which normalize would have removed', () => {
    expect(projectKeyProblem('web')).toBe('invalid');
    expect(projectKeyProblem('WE-B')).toBe('invalid');
  });
});

describe('deriveProjectKey', () => {
  it('takes initials from a multi-word name', () => {
    expect(deriveProjectKey('Acme Trading')).toBe('AT');
    expect(deriveProjectKey('Site Operations Team')).toBe('SOT');
  });

  it('takes the first letters of a single word', () => {
    // §7.1's example is "Marketing → MKT". No rule short of a dictionary
    // produces that contraction, and the field is editable precisely because
    // the suggestion is a starting point — MAR is what the rule gives.
    expect(deriveProjectKey('Marketing')).toBe('MAR');
    expect(deriveProjectKey('Design')).toBe('DES');
  });

  it('suffixes a collision instead of failing', () => {
    expect(deriveProjectKey('Design', new Set(['DES']))).toBe('DES2');
    expect(deriveProjectKey('Design', new Set(['DES', 'DES2']))).toBe('DES3');
  });

  it('keeps the suffixed key within the maximum length', () => {
    const key = deriveProjectKey('Alpha Beta Gamma Delta Epsilon', new Set(['ABGDE']));
    expect(key.length).toBeLessThanOrEqual(KEY_MAX_LENGTH);
    expect(projectKeyProblem(key)).toBeNull();
  });

  it('falls back to a usable key when nothing romanises', () => {
    // Creating a project must not be a spelling test. An emoji name still has
    // to produce something a person can type into a search box.
    const key = deriveProjectKey('🚀');
    expect(projectKeyProblem(key)).toBeNull();
  });

  it('derives a Latin key from a Khmer name', () => {
    const key = deriveProjectKey('ការងារ សំណង់');
    expect(projectKeyProblem(key)).toBeNull();
    expect(key).toMatch(/^[A-Z][A-Z0-9]*$/);
  });
});
