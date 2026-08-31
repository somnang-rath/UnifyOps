import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import km from './messages/km.json';
import { locales, localeNames } from './routing';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? flatten(v as Tree, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function get(tree: Tree, path: string): string | undefined {
  const v = path.split('.').reduce<string | Tree | undefined>(
    (acc, part) => (typeof acc === 'object' && acc !== null ? acc[part] : undefined),
    tree,
  );
  return typeof v === 'string' ? v : undefined;
}

const enKeys = flatten(en as Tree);
const kmKeys = flatten(km as Tree);

describe('message catalogues', () => {
  // §13: "en.json and km.json must stay key-for-key identical. Adding a string
  // to one without the other is a defect, not a TODO."
  it('are key-for-key identical', () => {
    expect(kmKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !kmKeys.includes(k))).toEqual([]);
  });

  it('covers every configured locale', () => {
    expect(locales).toEqual(['en', 'km']);
    for (const l of locales) expect(localeNames[l]).toBeTruthy();
  });

  it('has no empty strings', () => {
    for (const k of enKeys) {
      expect(get(en as Tree, k)?.trim(), `en.${k}`).toBeTruthy();
      expect(get(km as Tree, k)?.trim(), `km.${k}`).toBeTruthy();
    }
  });

  // Brand names are not translated. Everything else being byte-identical in
  // both catalogues means an English string was pasted into km.json — the
  // usual way Khmer quietly becomes the degraded path.
  it('is actually translated, not copied', () => {
    const brandStrings = ['app.name', 'home.heading'];
    const copied = enKeys.filter((k) => get(en as Tree, k) === get(km as Tree, k));
    expect(copied.sort()).toEqual(brandStrings.sort());
  });

  // §13: Khmer numerals are pinned out of the UI via numberingSystem: 'latn'.
  // A literal Khmer digit typed into a catalogue bypasses that entirely.
  it('contains no literal Khmer numerals', () => {
    const offenders = kmKeys.filter((k) => /[០-៩]/.test(get(km as Tree, k) ?? ''));
    expect(offenders).toEqual([]);
  });
});
