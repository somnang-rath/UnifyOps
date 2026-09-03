import { cn } from '@/lib/cn';

/**
 * §12 Avatar: 20 / 24 / 32px, initials fallback on a **deterministic colour
 * from user ID**, groups capped at 3 + `+N`.
 *
 * Deterministic matters more than it looks. The same person has to be the same
 * colour on every screen and across sessions, or the colour stops being a way
 * to recognise somebody at a glance and becomes noise — so it is hashed from
 * the id, never randomised and never assigned on first render.
 *
 * The eight fills are their own token family rather than a reuse of the label
 * colours: these carry text, so they owe 4.5:1 rather than 3:1, and the label
 * steps sit at 3.8–4.3:1 against Ivory. Initials are drawn in `--bg`, which
 * inverts with the theme, so both directions stay legible.
 *
 * Initials are taken by **grapheme**, not by character (§13). `name[0]` on a
 * Khmer name returns half a cluster and renders as a broken glyph.
 */

const FILLS = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
] as const;

/**
 * §12's three sizes. The type stays on the 11/12/14 scale rather than shrinking
 * to fit — two initials at 11px inside a 20px circle is tight but legible, and
 * an off-scale 9px would be neither.
 */
const SIZES = {
  sm: 'size-5 text-2xs',
  md: 'size-6 text-2xs',
  lg: 'size-8 text-xs',
} as const;

export type AvatarSize = keyof typeof SIZES;

function fillFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)!) % 100_000;
  return FILLS[hash % FILLS.length]!;
}

/**
 * Up to two leading graphemes — the first of the first word and the first of
 * the last, when there are two.
 *
 * `Intl.Segmenter` rather than `slice`, because a Khmer cluster is several code
 * points and cutting inside one produces a glyph that is not a letter (§13).
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';

  const firstGrapheme = (word: string): string => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const [first] = segmenter.segment(word);
    return first?.segment ?? '';
  };

  const head = firstGrapheme(words[0]!);
  const tail = words.length > 1 ? firstGrapheme(words.at(-1)!) : '';
  return (head + tail).toUpperCase();
}

export function Avatar({
  id,
  name,
  size = 'md',
  className,
}: {
  /** Stable per person — the workspace member or user id. Never the name. */
  id: string;
  name: string;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      // The name is the accessible content and lives on the title attribute's
      // sibling in AvatarGroup; on its own an avatar carries it here so a
      // screen reader says who this is rather than "S R".
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium text-bg',
        fillFor(id),
        SIZES[size],
        className,
      )}
    >
      <span aria-hidden>{initialsOf(name)}</span>
    </span>
  );
}

/**
 * §12: groups cap at 3 + `+N`.
 *
 * The cap is not cosmetic — §11's edge cases include "50 assignees", and fifty
 * overlapping circles push every other column of a list row off a 390px screen
 * (§15-6).
 */
export function AvatarGroup({
  people,
  size = 'md',
  max = 3,
  className,
}: {
  people: readonly { id: string; name: string }[];
  size?: AvatarSize;
  max?: number;
  className?: string;
}) {
  if (people.length === 0) return null;

  const shown = people.slice(0, max);
  const hidden = people.length - shown.length;

  return (
    <span
      className={cn('inline-flex items-center -space-x-1.5', className)}
      // One label for the group rather than one per avatar: a row with four
      // assignees should not make a screen reader read four separate images.
      role="img"
      aria-label={people.map((person) => person.name).join(', ')}
    >
      {shown.map((person) => (
        <span
          key={person.id}
          aria-hidden
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full font-medium text-bg ring-1 ring-surface',
            fillFor(person.id),
            SIZES[size],
          )}
        >
          {initialsOf(person.name)}
        </span>
      ))}
      {hidden > 0 && (
        <span
          aria-hidden
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-sunken font-medium text-text-muted ring-1 ring-surface',
            SIZES[size],
          )}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}
