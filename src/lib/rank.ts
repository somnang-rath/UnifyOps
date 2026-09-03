/**
 * Fractional index keys — the `rank` a board orders by (§9).
 *
 * "Fractional-index base-62 strings, jittered. The client sends **neighbour
 * IDs**, never a rank; the server reads neighbours under `FOR UPDATE` and
 * computes the key. A stale drag lands correctly relative to present state —
 * this is what stops boards feeling haunted."
 *
 * Slice 5 only ever appends: a new item goes at the end of the group it was
 * created in. Slice 6 is the one that computes a key *between* two neighbours.
 * Both use the function below, and it is written and tested now rather than
 * then, because §15 lists rank generation among the pure logic that must have
 * unit tests, and because a rank column filled by one algorithm and later read
 * by another is a board that reorders itself once, silently, on deploy day.
 *
 * **Base 36, not 62.** §9 says 62, and this deliberately narrows it: Postgres
 * compares `text` under the database collation, and in almost every collation
 * but `C` the ordering of upper and lower case is not ASCII order — so `Z` and
 * `a` sort in an order the application did not choose. Migration 0008 pins the
 * column to `COLLATE "C"` as well, but an alphabet with no case at all means
 * the two layers cannot disagree even if that collation is ever lost. The cost
 * is longer keys after many insertions at the same point, which is arithmetic
 * nobody sees.
 *
 * The invariant every key upholds: **no key ends in `0`**. A trailing zero has
 * no room beneath it — there is no key between `a0` and `a` — so the midpoint
 * algorithm would have nowhere to go, and the whole point of a fractional index
 * is that there is always somewhere to go.
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const FIRST = DIGITS[0]!;
const LAST = DIGITS[DIGITS.length - 1]!;

export class RankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankError';
  }
}

function assertKey(key: string, name: string): void {
  if (key === '') throw new RankError(`${name} must not be empty`);
  for (const char of key) {
    if (!DIGITS.includes(char)) throw new RankError(`${name} contains "${char}", not a rank digit`);
  }
  if (key.endsWith(FIRST)) throw new RankError(`${name} ends in "${FIRST}", which has no room beneath it`);
}

/**
 * A key strictly between `a` and `b`, either of which may be null for "the
 * start" and "the end".
 *
 * Recursive on the shared prefix: once two keys agree on their first character
 * there is no room between them at that position, so the search moves one digit
 * deeper. That is why keys lengthen when items are repeatedly inserted at the
 * same point, and why they never need renumbering — the property the whole
 * scheme exists for.
 */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null) assertKey(a, 'the preceding rank');
  if (b !== null) assertKey(b, 'the following rank');
  if (a !== null && b !== null && a >= b) {
    throw new RankError(`ranks are out of order: "${a}" is not before "${b}"`);
  }

  return midpoint(a ?? '', b);
}

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Walk the shared prefix. `a` is padded with the lowest digit because a
    // shorter key is understood as having implicit zeros after it.
    let shared = 0;
    while ((a[shared] ?? FIRST) === b[shared]) shared += 1;
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }

  const low = a === '' ? 0 : DIGITS.indexOf(a[0]!);
  const high = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;

  // Room for a whole digit between them: take it, and stop.
  if (high - low > 1) {
    return DIGITS[Math.floor((low + high) / 2)]!;
  }

  // `b` is adjacent to `a` at this position but has more digits of its own, so
  // anything under b's first digit is below b.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }

  // No room here at all: keep a's digit and go one deeper.
  return (a === '' ? FIRST : a[0]!) + midpoint(a.slice(1), null);
}

/** The first key in an empty list. */
export function firstRank(): string {
  return rankBetween(null, null);
}

/**
 * A key after `last`, jittered.
 *
 * The jitter is §9's, and it earns its place only here: two people creating an
 * item in the same column in the same second both read the same `last` and both
 * compute the same successor, and identical ranks make the two cards swap
 * places on every reload until somebody drags one. A random suffix makes that
 * collision vanishingly unlikely, and it is safe *in this direction only* —
 * appending digits to a key always produces something larger than the key, but
 * not necessarily smaller than a following one. So `rankBetween` stays exact
 * and unjittered, and the append path is the one that jitters.
 */
export function rankAfter(last: string | null, random: () => number = Math.random): string {
  const base = rankBetween(last, null);
  return base + jitter(random);
}

/** Two digits, never a trailing `0`, so the result is still a legal key. */
function jitter(random: () => number): string {
  const pick = () => DIGITS[Math.floor(random() * DIGITS.length)]!;
  const first = pick();
  let second = pick();
  if (second === FIRST) second = LAST;
  return first + second;
}

/** Whether a string could have come out of this module. Used when one arrives from outside. */
export function isRank(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.endsWith(FIRST)) return false;
  return [...value].every((char) => DIGITS.includes(char));
}
