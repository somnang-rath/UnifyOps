/**
 * §6-7's branding: the accent colour a company may choose, and the shape of a
 * workspace logo.
 *
 * A closed set of **token names**, never a hex, for the third time in this
 * product after `STATE_COLORS` (slice 4) and `LABEL_COLORS` (slice 5). The
 * reason is the same one and it is the whole of §12's three-layer architecture:
 * a hex written into a row in 2026 cannot resolve differently in dark mode, and
 * every other colour decision in the product is already made by a semantic
 * alias that flips. An accent stored as `#54A6DB` would be the one colour in
 * the product that stayed a light-mode colour on a dark screen.
 *
 * What the name resolves to is `[data-accent]` in `globals.css`, which
 * overrides the five `--accent-*` aliases for both themes. Components are
 * untouched — they already say `bg-accent` — which is the payoff for never
 * having let a raw ramp value reach one.
 *
 * In `src/lib` because both sides read it: the settings screen renders a swatch
 * per choice, the schema builds its `pgEnum` from the same list, and the layout
 * puts the chosen name on an attribute.
 */
export const ACCENT_COLORS = [
  /**
   * The product default, and the reason `accent` is nullable rather than
   * defaulted to this name: a company that never opens Settings has not
   * *chosen* Navy, it has simply not chosen, and the two should not be stored
   * as the same fact. §6's governing rule is that every setting is an override
   * of a working default.
   */
  'navy',
  /** The brand's own blue, one step brighter than Navy. */
  'sky',
  'lilac',
  'chartreuse',
] as const;

/**
 * **Crimson is deliberately not on this list**, though it is one of the seven
 * brand colours.
 *
 * `--danger` is Crimson, and a company that chose it as their accent would have
 * a primary action button the same colour as every delete button in the
 * product. That is not a preference somebody can be allowed to express — it is a
 * usability defect a settings screen would be handing them. §12 assigns Crimson
 * a meaning; an accent is the one colour that must not carry one.
 */

export type AccentColor = (typeof ACCENT_COLORS)[number];

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && (ACCENT_COLORS as readonly string[]).includes(value);
}

/**
 * What a company logo may be, and it is deliberately narrower than
 * `src/lib/attachments.ts` allows for a file on a work item.
 *
 * SVG is refused here for the reason it is refused there — it is a document
 * that can carry script, and the development driver serves bytes from the app's
 * own origin — but the cap is far smaller. A logo is drawn at 32px in a header;
 * 25 MiB of it is somebody uploading the wrong file, and §2.5's phone-heavy
 * market pays for every byte of a header that renders on every screen.
 *
 * Raised from 512 KiB to 2 MiB on request (2026-09-04). The reasoning above is
 * unchanged, and is why it did not go further: what a 32px header actually
 * needs is closer to 100 KB, so this is headroom for an unoptimised export
 * rather than a licence to serve a photograph as a logomark.
 */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function isLogoType(value: string): boolean {
  return (LOGO_TYPES as readonly string[]).includes(value);
}
