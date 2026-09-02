/**
 * The short prefix that human work-item identifiers are built from — the `ENG`
 * in `ENG-142` (§9).
 *
 * In `src/lib` for the same reason `slug.ts` is: the create-project form
 * previews the key as the user types and the server derives it again on submit.
 * One implementation, so the preview cannot promise a key the save does not
 * produce.
 *
 * §7.1 describes it as "auto-suggested" and the field is editable, which is
 * what makes an approximate derivation acceptable — the same bargain `slug.ts`
 * makes. The plan's example is "Marketing → MKT"; the rule below gives `MAR`,
 * because no simple rule produces the conventional contraction MKT without a
 * dictionary. The suggestion is a starting point a person can overwrite in one
 * keystroke, not a promise about English abbreviation.
 *
 * Unlike a slug, a key is *permanent in practice*: it is printed on every item
 * identifier that has ever been pasted into a chat message, and §4 says human
 * identifiers are never reused. Changing it later is deliberately not offered.
 */

import { transliterateKhmer } from './slug';

export const KEY_MIN_LENGTH = 2;
export const KEY_MAX_LENGTH = 5;

/**
 * The canonical form: uppercase Latin letters and digits, nothing else.
 *
 * Applied both to what we derive and to what a user types, so the two cannot
 * disagree about what a valid key is.
 */
export function normalizeProjectKey(input: string): string {
  return transliterateKhmer(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, KEY_MAX_LENGTH);
}

export type ProjectKeyProblem = 'too_short' | 'invalid';

/** Why a key is unusable, or null. Identifiers; the sentences are translated (§13). */
export function projectKeyProblem(key: string): ProjectKeyProblem | null {
  if (key.length < KEY_MIN_LENGTH) return 'too_short';
  if (key.length > KEY_MAX_LENGTH) return 'invalid';
  // A leading digit would make `142-7` a plausible-looking identifier, which is
  // ambiguous with the item number it precedes.
  if (!/^[A-Z][A-Z0-9]*$/.test(key)) return 'invalid';
  return null;
}

/**
 * A key for a project name, given the keys already taken in the workspace.
 *
 * Multi-word names take their initials ("Acme Trading" → `AT`), which is what
 * people write by hand; a single word takes its first letters ("Marketing" →
 * `MAR`). A name with nothing romanisable — an emoji, a script the
 * transliteration table does not cover — falls back to a generated key rather
 * than failing, because creating a project must not be a spelling test.
 *
 * The caller supplies the taken set rather than this reaching for a database,
 * which is what keeps the module pure and the whole table unit-testable.
 */
export function deriveProjectKey(name: string, taken: ReadonlySet<string> = new Set()): string {
  const words = normalizeWords(name);

  const initials = words
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, KEY_MAX_LENGTH);

  const single = words[0]?.slice(0, 3) ?? '';

  const base = words.length > 1 && initials.length >= KEY_MIN_LENGTH ? initials : single;
  const usable = projectKeyProblem(base) === null ? base : fallbackKey();

  if (!taken.has(usable)) return usable;

  // A numeric suffix rather than a random one: two projects called "Design"
  // read as DES and DES2, which is recognisable rather than cryptic.
  for (let n = 2; n < 100; n += 1) {
    const suffix = String(n);
    const candidate = `${usable.slice(0, KEY_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  return fallbackKey();
}

/** Words, romanised and stripped to `[A-Z0-9]`, empties dropped. */
function normalizeWords(name: string): string[] {
  return transliterateKhmer(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length > 0);
}

function fallbackKey(): string {
  return `P${Math.floor(Math.random() * 9000 + 1000)}`;
}
