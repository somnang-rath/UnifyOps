/**
 * Display density (docs/plan/02-design-system.md §2.4).
 *
 * `compact` is the default: this is a tool people keep open all day, and more
 * rows on screen is the whole point. The roomier mode restores the old metrics
 * for anyone who wants them — same design, more air, no separate stylesheet.
 *
 * The value is one attribute on <html>; tokens.css does the rest.
 *
 * Note the two spellings. `comfy` is what apps/web has always written, and it is
 * persisted in localStorage and in the users collection's `density` enum, so it
 * stays the canonical value; `comfortable` is accepted as an alias for apps that
 * never carried that history.
 */
export const DENSITIES = ['compact', 'comfy'] as const;
export type Density = (typeof DENSITIES)[number];

export const DEFAULT_DENSITY: Density = 'compact';

export function isDensity(v: unknown): v is Density {
  return typeof v === 'string' && (DENSITIES as readonly string[]).includes(v);
}

/** Write the density onto <html>. Safe to call on the server (no-op). */
export function applyDensity(density: Density | 'comfortable'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = density;
}
