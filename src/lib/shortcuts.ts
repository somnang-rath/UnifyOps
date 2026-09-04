/**
 * §14 slice 14's third word: shortcuts.
 *
 * The **matching** is here, pure, because it is the part that is easy to get
 * subtly wrong and impossible to check by looking at it: which keystroke is
 * which, when a two-key chord is still waiting for its second key, when it has
 * waited too long, and — the one that actually breaks products — when a keypress
 * is somebody typing rather than somebody commanding. A `useEffect` full of
 * `if (event.key === …)` is untestable by construction; this is a function over
 * a sequence of strings, and `shortcuts.test.ts` walks every case.
 *
 * The DOM half — listening, and deciding whether the event target is a text
 * field — is in `src/components/search/shortcut-listener.tsx`.
 *
 * §11 asks for "keyboard-operable throughout", which these do not provide on
 * their own: every one of them is a faster way to reach something already
 * reachable by Tab and Enter. That is deliberate. A shortcut that is the *only*
 * way to do something is an accessibility failure wearing a power-user hat.
 */

/**
 * The closed set. One entry per thing a key can do, and adding one without a
 * label is caught by `messages.test.ts` — the rule slice 13 wrote down after a
 * grouping shipped with no string.
 */
export const SHORTCUTS = [
  'palette',
  'search',
  'help',
  'goMyWork',
  'goInbox',
  'goTeam',
  'goProjects',
] as const;
export type ShortcutId = (typeof SHORTCUTS)[number];

/**
 * A keystroke, normalized to a string.
 *
 * `mod` rather than `meta` or `ctrl`, because §7.9 writes the palette as `⌘K`
 * and a Windows or Linux user presses Ctrl for the same idea. One name for one
 * intent means the binding table has one row, and the *rendering* of that row is
 * the only thing that differs by platform — which is a label, not a behaviour.
 *
 * Single characters are lower-cased, so Shift+G and g are the same key: a chord
 * that stopped working with caps lock on would be a bug report nobody could
 * reproduce. `?` is the exception that proves it — it *is* Shift+/ on most
 * layouts, and it is matched as the character the layout produced rather than as
 * a modifier combination, which is the only way it works on a layout where it is
 * somewhere else entirely.
 */
export type Keystroke = string;

export function keystrokeOf(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): Keystroke {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  // Alt is deliberately not part of any binding: on a Khmer keyboard layout
  // AltGr produces characters, and a shortcut that eats them would make the
  // product unusable in one of its two languages.
  if (event.altKey) return `alt+${key}`;
  return event.ctrlKey || event.metaKey ? `mod+${key}` : key;
}

export type ShortcutBinding = {
  id: ShortcutId;
  /** One keystroke, or two for a chord. Nothing takes three. */
  sequence: readonly Keystroke[];
};

/**
 * The bindings.
 *
 * `g` chords for navigation, because they compose: `g` then a letter reads as
 * "go to …" and leaves the single letters free for the per-screen actions a
 * later slice will want. Two single keys are spent, and both are conventions
 * strong enough that spending them costs nothing: `/` puts the caret in search
 * on every product anybody has used, and `?` shows the list of shortcuts.
 *
 * **`/` and `mod+k` open the same palette**, and that is not redundancy. §7.9
 * describes one surface that does both search and commands, so binding them to
 * one thing is what stops the product having a "search box" and a "command bar"
 * that know different amounts about the workspace.
 */
export const BINDINGS: readonly ShortcutBinding[] = [
  { id: 'palette', sequence: ['mod+k'] },
  { id: 'search', sequence: ['/'] },
  { id: 'help', sequence: ['?'] },
  { id: 'goMyWork', sequence: ['g', 'm'] },
  { id: 'goInbox', sequence: ['g', 'i'] },
  { id: 'goTeam', sequence: ['g', 't'] },
  { id: 'goProjects', sequence: ['g', 'p'] },
];

/**
 * How long a chord waits for its second key.
 *
 * Long enough that `g` then `m` typed at a normal pace lands, short enough that
 * a stray `g` pressed a minute ago does not turn the next `i` into a navigation.
 * The failure that matters is the second one: a chord with no timeout makes
 * every subsequent keystroke unpredictable, which is exactly the feeling that
 * teaches people to stop using shortcuts.
 */
export const CHORD_TIMEOUT_MS = 1_200;

export type MatchResult =
  /** This sequence completes a binding. */
  | { kind: 'match'; id: ShortcutId }
  /** A prefix of one or more bindings — keep the buffer and wait. */
  | { kind: 'pending' }
  /** Nothing starts this way. Drop the buffer. */
  | { kind: 'none' };

/**
 * What a buffered sequence means.
 *
 * Three outcomes rather than a boolean, because "wait" is a real answer and
 * treating it as "no" is what makes a chord fire only when you type it twice.
 */
export function matchSequence(sequence: readonly Keystroke[]): MatchResult {
  if (sequence.length === 0) return { kind: 'none' };

  const exact = BINDINGS.find(
    (binding) =>
      binding.sequence.length === sequence.length &&
      binding.sequence.every((key, index) => key === sequence[index]),
  );
  if (exact !== undefined) return { kind: 'match', id: exact.id };

  const prefixed = BINDINGS.some(
    (binding) =>
      binding.sequence.length > sequence.length &&
      sequence.every((key, index) => binding.sequence[index] === key),
  );
  return prefixed ? { kind: 'pending' } : { kind: 'none' };
}

/**
 * The next buffer, given the one you had and the key just pressed.
 *
 * Folded into one function with the timeout so a caller cannot apply one and
 * forget the other — the buffer and its clock are the same fact.
 */
export function advance(
  buffer: readonly Keystroke[],
  key: Keystroke,
  options: { now: number; lastAt: number },
): { buffer: Keystroke[]; result: MatchResult } {
  const expired = options.now - options.lastAt > CHORD_TIMEOUT_MS;
  const base = expired ? [] : [...buffer];

  const next = [...base, key];
  const result = matchSequence(next);

  // A match consumes the buffer; a dead end drops it and — this is the part
  // worth stating — **retries the key on its own**. Pressing `g` and then
  // `mod+k` should open the palette rather than be swallowed as the failed
  // second half of a chord.
  if (result.kind === 'match') return { buffer: [], result };
  if (result.kind === 'pending') return { buffer: next, result };

  if (base.length > 0) {
    const alone = matchSequence([key]);
    if (alone.kind === 'match') return { buffer: [], result: alone };
    if (alone.kind === 'pending') return { buffer: [key], result: alone };
  }

  return { buffer: [], result: { kind: 'none' } };
}

/**
 * The rendering of a binding, per platform.
 *
 * Presentation, but here rather than in the component because it is derived from
 * the binding table and a second copy would eventually disagree with it. The
 * symbols are not translated — `⌘` and `⇧` are the same glyphs in a Khmer
 * workspace, and "Ctrl" is a key cap, not a word.
 */
export function describeBinding(
  binding: ShortcutBinding,
  platform: 'mac' | 'other',
): string[] {
  return binding.sequence.map((key) =>
    key.startsWith('mod+')
      ? `${platform === 'mac' ? '⌘' : 'Ctrl'}${key.slice(4).toUpperCase()}`
      : key.length === 1
        ? key.toUpperCase()
        : key,
  );
}

/** True on an Apple platform, where the modifier is Command rather than Control. */
export function isMacLike(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
