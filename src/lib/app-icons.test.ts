import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPLE_TOUCH_ICON,
  MARK_AVAILABLE,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  appIcons,
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
   * CLAUDE.md's rule is that UnifyOps uses the parent Unify mark and that
   * nothing may be substituted for it; the mark is not in the repo. So the set
   * is empty, Chrome declines to offer installation, and that is the product
   * being honest rather than shipping a placeholder to somebody's home screen.
   *
   * The test is here so that the day it stops being empty, somebody has to come
   * and change this file on purpose.
   */
  it('is empty while the mark is missing', () => {
    expect(MARK_AVAILABLE).toBe(false);
    expect(appIcons()).toEqual([]);
  });

  it('names an apple-touch-icon, because iOS reads none of the manifest', () => {
    expect(APPLE_TOUCH_ICON).toMatch(/^\/icons\/.+\.png$/);
  });
});
