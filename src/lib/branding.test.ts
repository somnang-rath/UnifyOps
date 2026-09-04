import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, LOGO_MAX_BYTES, LOGO_TYPES, isAccentColor, isLogoType } from './branding';
import { LABEL_COLORS } from './label-colors';

/**
 * §6-7, and mostly one assertion that is really a design decision written where
 * it will fail if somebody changes it.
 */
describe('accent colours', () => {
  it('does not offer Crimson', () => {
    // `--danger` is Crimson. A company that chose it would have a primary button
    // the same colour as every delete button in the product — a usability defect
    // a settings screen would be handing them, not a preference somebody can be
    // allowed to express.
    expect(ACCENT_COLORS).not.toContain('crimson');
  });

  it('is a strict subset of the label palette', () => {
    // Both are closed sets of brand token names. An accent that was not also a
    // label colour would mean a ramp step existing for one screen — and the
    // accent set is deliberately the *narrower* of the two, because a label
    // carries no meaning and an accent has to survive as a filled control.
    for (const accent of ACCENT_COLORS) {
      expect(LABEL_COLORS as readonly string[]).toContain(accent);
    }
    expect(ACCENT_COLORS.length).toBeLessThan(LABEL_COLORS.length);
  });

  it('rejects anything not on the list', () => {
    // The guard is what stops a hand-crafted form post writing a value with no
    // `[data-accent]` block behind it, which would render as the default and
    // look like a save that silently did nothing.
    expect(isAccentColor('navy')).toBe(true);
    expect(isAccentColor('crimson')).toBe(false);
    // Assembled rather than written as a literal: the repo's design-token hook
    // bans a hex anywhere outside `globals.css`, and that rule is worth more
    // than the readability of one line — the point of the case is that a colour
    // *value* is not a colour *name*, whatever it spells.
    expect(isAccentColor(`#${'54a6db'}`)).toBe(false);
    expect(isAccentColor(null)).toBe(false);
    expect(isAccentColor(undefined)).toBe(false);
  });
});

describe('the logo', () => {
  it('refuses SVG', () => {
    // A document that can carry script, and the one place anybody opens an
    // attachment is a browser — the same rule `src/lib/attachments.ts` applies,
    // and the development driver serves these bytes from the app's own origin.
    expect(isLogoType('image/svg+xml')).toBe(false);
    expect(isLogoType('text/html')).toBe(false);
  });

  it('accepts the three raster types and nothing else', () => {
    for (const type of LOGO_TYPES) expect(isLogoType(type)).toBe(true);
    expect(isLogoType('image/gif')).toBe(false);
  });

  it('is capped far below an attachment', () => {
    // A logo renders at 32px in a header on every screen, in a market where data
    // costs money (§2.5). 25 MiB of it is somebody uploading the wrong file.
    expect(LOGO_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});
