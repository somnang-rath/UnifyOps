import { describe, expect, it } from 'vitest';
import { deriveSlug, slugify, slugProblem, transliterateKhmer } from './slug';

/**
 * §7.1 promises that a Khmer company name produces a Latin, editable slug. The
 * Khmer half of this module is the part most likely to be quietly wrong — an
 * English-speaking reviewer cannot tell a good romanisation from a bad one by
 * looking — so it is the part with the most cases here.
 */

describe('transliterateKhmer', () => {
  /**
   * These are the module's actual output, not a reference romanisation, and
   * the difference is the point. A faithful romanisation has to segment
   * syllables to know where a consonant's inherent vowel is pronounced —
   * "ភ្នំពេញ" is *Phnom* Penh, and the o is written nowhere. This table does
   * not attempt that, which is why §7.1 makes the slug editable.
   *
   * Pinning the real output keeps the approximation honest: a change to the
   * table shows up here as a diff someone has to look at, rather than as a
   * company quietly getting a different URL.
   */
  it('romanises consonants and vowel signs', () => {
    expect(transliterateKhmer('ក្រុមហ៊ុន')).toBe('krumhun');
    expect(transliterateKhmer('សួស្តី')).toBe('suosti');
    expect(transliterateKhmer('ឧបករណ៍')).toBe('ubkrn');
  });

  it('drops coeng and leaves the stacked consonant to speak for itself', () => {
    // ្ is the subscript marker; "ស្រុក" is sruk, not s-ruk or s?ruk.
    expect(transliterateKhmer('ស្រុក')).toBe('sruk');
  });

  it('converts Khmer digits to Latin', () => {
    // §13 pins Latin digits everywhere in the UI; a slug is no exception.
    expect(transliterateKhmer('ក្រុមហ៊ុន២០')).toBe('krumhun20');
  });

  it('leaves Latin text alone', () => {
    expect(transliterateKhmer('Acme Ltd')).toBe('Acme Ltd');
  });
});

describe('slugify', () => {
  it('lowercases, strips punctuation and collapses separators', () => {
    expect(slugify('  Acme   Widgets, Ltd.  ')).toBe('acme-widgets-ltd');
  });

  it('strips Latin accents rather than dropping the letters', () => {
    expect(slugify('Café Créme')).toBe('cafe-creme');
  });

  it('produces a Latin slug from a Khmer name', () => {
    const slug = slugify('ក្រុមហ៊ុន សុវណ្ណា');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeGreaterThan(1);
  });

  it('never ends in a hyphen, including after the length cap', () => {
    const long = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40));
    expect(long.endsWith('-')).toBe(false);
    expect(long.length).toBeLessThanOrEqual(48);
  });

  it('returns empty for input with nothing romanisable', () => {
    // Not an error — `deriveSlug` is what decides the fallback.
    expect(slugify('🚀🚀')).toBe('');
  });
});

describe('slugProblem', () => {
  it('accepts an ordinary slug', () => {
    expect(slugProblem('acme-widgets')).toBeNull();
  });

  it('rejects the segments the router would win', () => {
    // A company called "Settings" must not be able to take the URL its own
    // settings screen lives at.
    expect(slugProblem('settings')).toBe('reserved');
    expect(slugProblem('sign-in')).toBe('reserved');
    expect(slugProblem('api')).toBe('reserved');
    expect(slugProblem('km')).toBe('reserved');
  });

  it('rejects anything not already canonical', () => {
    expect(slugProblem('Acme')).toBe('invalid');
    expect(slugProblem('acme--co')).toBe('invalid');
    expect(slugProblem('-acme')).toBe('invalid');
    expect(slugProblem('a')).toBe('too_short');
  });
});

describe('deriveSlug', () => {
  it('uses the name when it is free', () => {
    expect(deriveSlug('Acme Widgets')).toBe('acme-widgets');
  });

  it('suffixes numerically on collision, so names stay recognisable', () => {
    const taken = new Set(['acme', 'acme-2']);
    expect(deriveSlug('Acme', taken)).toBe('acme-3');
  });

  it('keeps the suffix inside the length cap', () => {
    const base = slugify('a'.repeat(60));
    const slug = deriveSlug('a'.repeat(60), new Set([base]));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug).not.toBe(base);
  });

  it('falls back rather than failing on an unromanisable name', () => {
    // Signup is not a spelling test: a name this module cannot read still has
    // to produce a working workspace.
    const slug = deriveSlug('🚀');
    expect(slugProblem(slug)).toBeNull();
    expect(slug.startsWith('workspace-')).toBe(true);
  });

  it('never derives a reserved slug', () => {
    const slug = deriveSlug('Settings');
    expect(slugProblem(slug)).toBeNull();
  });
});
