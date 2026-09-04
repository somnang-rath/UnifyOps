import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLE_TOUCH_ICON,
  MARK_AVAILABLE,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  appIcons,
  favicons,
} from './app-icons';

/**
 * §4's **Installable** row and §15-8's pass condition.
 *
 * Two things are worth a test here, and they are the two that fail silently.
 */

const globalsCss = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The value a `--color-*` ramp step resolves to in `@theme`. */
function ramp(name: string): string {
  const match = globalsCss.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,8});`));
  if (!match) throw new Error(`no ramp step --color-${name} in globals.css`);
  return match[1]!.toLowerCase();
}

/** The ramp step a semantic alias points at, in the given theme block. */
function bgAlias(theme: 'light' | 'dark'): string {
  // `:root { … }` is the light block and `.dark { … }` the dark one (layer 2).
  const block = theme === 'light' ? /:root\s*\{([\s\S]*?)\n\}/ : /\.dark\s*\{([\s\S]*?)\n\}/;
  const body = globalsCss.match(block)?.[1];
  if (!body) throw new Error(`no ${theme} block in globals.css`);
  const match = body.match(/--bg:\s*var\(--color-([a-z0-9-]+)\)/);
  if (!match) throw new Error(`no --bg alias in the ${theme} block`);
  return match[1]!;
}

describe('the theme colour', () => {
  /**
   * **This is the test that earns its place.** A manifest is JSON served to an
   * installer and a `theme-color` meta is read before any stylesheet, so
   * neither can resolve a custom property — the two values have to be literal
   * hex, which makes them the only place in `src/` outside `globals.css` and
   * `global-error.tsx` where the token layer is copied rather than referenced.
   *
   * A copy drifts. Retuning `--bg` in layer 2 leaves an installed app opening
   * on the *old* background for a frame on every launch, and nothing on screen
   * during development shows it, because the browser tab colour is not part of
   * any page.
   */
  it('is the light palette’s own --bg', () => {
    expect(THEME_COLOR_LIGHT).toBe(ramp(bgAlias('light')));
  });

  it('is the dark palette’s own --bg', () => {
    expect(THEME_COLOR_DARK).toBe(ramp(bgAlias('dark')));
  });

  it('is lowercase six-digit hex, which is what a manifest and a meta both take', () => {
    for (const value of [THEME_COLOR_LIGHT, THEME_COLOR_DARK]) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('is two different colours, or the dark install has a light chrome', () => {
    expect(THEME_COLOR_LIGHT).not.toBe(THEME_COLOR_DARK);
  });
});

describe('the icon set', () => {
  /**
   * The mark is the UnifyCharge primary logomark, by explicit instruction on
   * 2026-09-04, and it stays until the parent Unify mark is supplied.
   *
   * **The test that earns its place here is that every icon the manifest and
   * the metadata name is a file that exists.** A manifest naming a missing PNG
   * does not fail a build, a render or a page load — Chrome simply declines to
   * offer installation, and iOS draws a screenshot of the page instead. Both
   * failures are invisible from inside development, which is exactly the shape
   * `app-icons.ts` was written to avoid.
   */
  const declared = [
    ...appIcons().map((icon) => icon.src),
    ...favicons().map((icon) => icon.url),
    APPLE_TOUCH_ICON,
  ];

  it('has a mark', () => {
    expect(MARK_AVAILABLE).toBe(true);
    expect(appIcons().length).toBeGreaterThan(0);
    expect(favicons().length).toBeGreaterThan(0);
  });

  it.each(declared)('%s is a file in public/', (src) => {
    expect(existsSync(join(process.cwd(), 'public', src))).toBe(true);
  });

  it('offers Android a maskable icon, or the mark ships as a sticker', () => {
    expect(appIcons().some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('names an apple-touch-icon, because iOS reads none of the manifest', () => {
    expect(APPLE_TOUCH_ICON).toMatch(/^\/icons\/.+\.png$/);
  });

  it('offers the vector favicon before the raster one', () => {
    expect(favicons()[0]?.type).toBe('image/svg+xml');
  });
});
