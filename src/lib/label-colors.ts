/**
 * The colours a label may carry (§12: Lilac and Chartreuse are "decorative,
 * labels").
 *
 * A closed set of semantic token names rather than free hex, for the reason
 * `STATE_COLORS` is one: the value has to resolve differently in dark mode, and
 * a hex stored in 2026 cannot. `LabelChip` is the only place one becomes a
 * class.
 *
 * Deliberately a wider set than `STATE_COLORS` and a separate one. A workflow
 * state's colour carries meaning — §12 assigns one per state group — so its
 * palette stays narrow. A label is a company's own vocabulary ("client",
 * "design", "Q3"), and the two brand colours that exist for exactly that
 * purpose belong here and nowhere else.
 */
export const LABEL_COLORS = [
  'ink',
  'sky',
  'navy',
  'lilac',
  'chartreuse',
  'warning',
  'success',
  'danger',
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];

export function isLabelColor(value: unknown): value is LabelColor {
  return typeof value === 'string' && (LABEL_COLORS as readonly string[]).includes(value);
}

/**
 * The colour a new label gets when nobody picked one.
 *
 * Deterministic from the name rather than random, so creating "design" twice in
 * two projects does not produce two differently coloured chips for what a
 * person reads as one thing — and so a test can assert it.
 */
export function defaultLabelColor(name: string): LabelColor {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)!) % 100_000;
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length]!;
}
