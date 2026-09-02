/**
 * Turning a company name into a URL slug (§7.1).
 *
 * In `src/lib` rather than `src/server` because both sides run it: the
 * onboarding field derives the address as the user types, and the server
 * validates what arrives. One implementation, so the preview cannot disagree
 * with the result — two would differ first on exactly the input this module
 * exists for, a Khmer company name.
 *
 * Pure and dependency-free, so the whole table below is unit-testable without a
 * database — which matters, because the Khmer half of it is the part most
 * likely to be wrong in a way nobody notices until a Cambodian company signs
 * up.
 *
 * §7.1 states the requirement: "company name is Khmer → slug transliterates to
 * Latin, editable". Both halves are load-bearing. Transliteration exists so the
 * first suggestion is a readable URL rather than a percent-encoded one; the
 * slug being editable is why an approximate romanisation is acceptable here and
 * would not be anywhere else.
 */

/**
 * Khmer consonants, romanised in their first-series ("a") reading.
 *
 * Khmer consonants carry an inherent vowel that changes with the register of
 * the consonant, and a faithful romanisation has to track that register across
 * the whole syllable. This table does not: it is a slug generator, and a slug
 * only has to be recognisable and typeable. UNGEGN is the shape being
 * approximated, not implemented.
 */
const CONSONANTS: Record<string, string> = {
  ក: 'k', ខ: 'kh', គ: 'k', ឃ: 'kh', ង: 'ng',
  ច: 'ch', ឆ: 'chh', ជ: 'ch', ឈ: 'chh', ញ: 'nh',
  ដ: 'd', ឋ: 'th', ឌ: 'd', ឍ: 'th', ណ: 'n',
  ត: 't', ថ: 'th', ទ: 't', ធ: 'th', ន: 'n',
  ប: 'b', ផ: 'ph', ព: 'p', ភ: 'ph', ម: 'm',
  យ: 'y', រ: 'r', ល: 'l', វ: 'v',
  ស: 's', ហ: 'h', ឡ: 'l', អ: 'a',
};

/** Dependent vowels — the signs that attach to a consonant. */
const VOWELS: Record<string, string> = {
  'ា': 'a', 'ិ': 'i', 'ី': 'i', 'ឹ': 'oe', 'ឺ': 'oe',
  'ុ': 'u', 'ូ': 'u', 'ួ': 'uo', 'ើ': 'aeu', 'ឿ': 'oea',
  'ៀ': 'ie', 'េ': 'e', 'ែ': 'ae', 'ៃ': 'ai', 'ោ': 'ao',
  'ៅ': 'au', 'ំ': 'm', 'ះ': 'h', 'ៈ': 'a',
};

/** Independent vowels — full letters, written without a base consonant. */
const INDEPENDENT: Record<string, string> = {
  'ឥ': 'i', 'ឦ': 'i', 'ឧ': 'u', 'ឩ': 'u', 'ឪ': 'ou',
  'ឫ': 'rue', 'ឬ': 'rue', 'ឭ': 'lue', 'ឮ': 'lue',
  'ឯ': 'ae', 'ឰ': 'ai', 'ឱ': 'ao', 'ឲ': 'ao', 'ឳ': 'au',
};

/** Khmer digits. Latin digits are pinned throughout the product (§13). */
const DIGITS: Record<string, string> = {
  '០': '0', '១': '1', '២': '2', '៣': '3', '៤': '4',
  '៥': '5', '៦': '6', '៧': '7', '៨': '8', '៩': '9',
};

/**
 * Signs that carry no sound of their own in a slug.
 *
 * `្` is coeng, the subscript marker: it stacks the next consonant under this
 * one. Dropping it and letting the following consonant transliterate normally
 * is right for a slug — "ស្រុក" becomes "sruk", which is what a reader expects.
 * The rest are register shifters and vowel-shorteners whose effect this table
 * is too coarse to represent anyway.
 */
const SILENT = new Set(['្', '់', '៉', '៊', '័', '៍', '៎', '៏', '៑', '៌', '​']);

/** Romanises Khmer text, leaving everything else untouched. */
export function transliterateKhmer(input: string): string {
  let out = '';
  for (const char of input) {
    if (SILENT.has(char)) continue;
    out +=
      CONSONANTS[char] ??
      VOWELS[char] ??
      INDEPENDENT[char] ??
      DIGITS[char] ??
      char;
  }
  return out;
}

/**
 * Segments a URL cannot be a workspace slug, because the router would win.
 *
 * A workspace lives at `/{locale}/{workspaceSlug}`, so every sibling segment
 * under `[locale]` is a collision. Caught here rather than discovered when a
 * company called "Settings" cannot reach its own board.
 */
const RESERVED = new Set([
  'api',
  'sign-in',
  'sign-up',
  'sign-out',
  'verify',
  'verify-email',
  'check-email',
  'forgot-password',
  'reset-password',
  'invite',
  'new',
  'new-workspace',
  'settings',
  'admin',
  'account',
  'help',
  'support',
  'static',
  'public',
  'en',
  'km',
]);

export const SLUG_MAX_LENGTH = 48;
const SLUG_MIN_LENGTH = 2;

/**
 * The canonical form. Applied both to what we derive from a name and to what a
 * user types into the editable field, so the two can never disagree about what
 * a valid slug is.
 */
export function slugify(input: string): string {
  const romanised = transliterateKhmer(input)
    // Strips Latin accents: "Café" -> "Cafe". Decompose, then drop the marks.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  const cleaned = romanised
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  // Cut on a byte budget, then heal a trailing hyphen. Safe on graphemes
  // because everything reaching this line is already `[a-z0-9-]`.
  const capped = cleaned.length > SLUG_MAX_LENGTH ? cleaned.slice(0, SLUG_MAX_LENGTH) : cleaned;
  return capped.replace(/-+$/g, '');
}

export type SlugProblem = 'too_short' | 'reserved' | 'invalid';

/** Why a slug is unusable, or null. Identifiers; the sentences are translated (§13). */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN_LENGTH) return 'too_short';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return 'invalid';
  if (slug.length > SLUG_MAX_LENGTH) return 'invalid';
  if (RESERVED.has(slug)) return 'reserved';
  return null;
}

/**
 * A slug for a company name, given the slugs already taken.
 *
 * The caller supplies the taken set rather than this reaching for a database,
 * which keeps the whole module pure. Collisions get a numeric suffix rather
 * than a random one so that two companies with the same name read as "acme" and
 * "acme-2" — recognisable, and stable if the first is later renamed.
 *
 * A name with no romanisable characters at all — an emoji, a script this table
 * does not cover — falls back to a generated slug instead of failing. Signup
 * must not be a spelling test.
 */
export function deriveSlug(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = slugify(name);
  const usable = slugProblem(base) === null ? base : `workspace-${randomSuffix()}`;

  if (!taken.has(usable)) return usable;

  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const trimmed = usable.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '');
    const candidate = `${trimmed}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${usable.slice(0, SLUG_MAX_LENGTH - 7)}-${randomSuffix()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
