import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import km from './messages/km.json';
import { locales, localeNames } from './routing';
import { DUE_WINDOWS, PICKABLE_GROUP_BY, VIEWS } from '@/lib/work-item-query';
import { ATTENTION_ROWS } from '@/lib/needs-attention';
import { DUE_BUCKETS } from '@/lib/workspace-date';
import { PALETTE_ACTIONS, SEARCH_SECTIONS } from '@/lib/search';
import { SHORTCUTS } from '@/lib/shortcuts';
import { ACCENT_COLORS } from '@/lib/branding';
import { WEEK_DAYS } from '@/lib/workspace-date';
import { NOTIFICATION_KINDS } from '@/lib/notification-kinds';
import { CALLOUT_TONES } from '@/lib/documents';
import { INSERTIONS } from '@/lib/editor-commands';

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

  /**
   * The hole parity alone does not cover, closed (slice 13).
   *
   * Key-for-key identity catches a string added to one catalogue and not the
   * other. It does **not** catch one added to *neither* — and slice 10's `soon`
   * defect was exactly that: a new due window rendered by the filter bar, absent
   * from both files, so this suite stayed green while the dropdown threw
   * `MISSING_MESSAGE` into a server log next-intl swallows.
   *
   * Slice 13 reproduced it within the hour by adding a `due` grouping with no
   * `workItems.groups.due` label, so the rule is written down here instead of
   * being learned a third time: **a closed enum that a screen renders one label
   * per member of owes this test a row.** The e2e run is what caught it both
   * times, and an e2e run is a slow way to find a missing string.
   */
  it('has a label for every member of the enums a screen renders', () => {
    const missing: string[] = [];

    const require = (keys: readonly string[]) => {
      for (const key of keys) {
        if (get(en as Tree, key) === undefined || get(km as Tree, key) === undefined) {
          missing.push(key);
        }
      }
    };

    // The group-by picker draws one option per pickable grouping (`day` is
    // deliberately not pickable — it is the calendar's, imposed by the view).
    require(PICKABLE_GROUP_BY.map((value) => `workItems.groups.${value}`));
    // The view switcher draws one per view.
    require(VIEWS.map((value) => `view.${value}`));
    // My Work draws one heading per due bucket (§7.3).
    require(DUE_BUCKETS.map((value) => `myWork.bucket.${value}`));
    // Needs Attention draws one heading per row (§7.4).
    require(ATTENTION_ROWS.map((value) => `needsAttention.row.${value}`));
    /*
     * The filter bar's due windows, minus `soon`. `soon` is in the DSL for
     * §7.8's digest and takes a horizon the DSL deliberately keeps out of the
     * URL, so the bar omits it rather than offering a filter that would resolve
     * to `overdue` and lie about itself — which is why it is the one member of a
     * rendered enum that correctly has no label.
     */
    require(DUE_WINDOWS.filter((w) => w !== 'soon').map((value) => `workItems.due.${value}`));
    // §7.9's palette and results screen draw one heading per section and one row
    // per action (slice 14).
    require(SEARCH_SECTIONS.map((value) => `search.sections.${value}`));
    require(PALETTE_ACTIONS.map((value) => `search.actions.${value}`));
    // The `?` sheet draws one row per binding, and `describeBinding` supplies
    // the key caps — so the only thing that can be missing is the description.
    require(SHORTCUTS.map((value) => `shortcuts.${value}`));
    /*
     * Slice 15's three. The settings screens each render one control per member
     * of a closed set, which is exactly the shape that produced the `soon`
     * defect in slice 10 and the `due` one in slice 13.
     */
    // §6-7's accent picker draws one swatch per choice.
    require(ACCENT_COLORS.map((value) => `settings.branding.accents.${value}`));
    // §6-1's working-week checkboxes and week-start select both draw one per day.
    require(WEEK_DAYS.map((value) => `settings.company.days.${value}`));
    // §6-6's two preference grids draw one row per kind, in both screens.
    require(NOTIFICATION_KINDS.map((value) => `notificationSettings.kind.${value}`));
    /*
     * Slice 20's two. §21.5's `/` menu draws one row per insertion, and a
     * callout with no title of its own is named by its tone — both are closed
     * sets rendered one option per member, which is exactly the shape that
     * produced the `soon` defect in slice 10 and the `due` one in slice 13.
     */
    require(INSERTIONS.map((value) => `wiki.editor.insert.${value}`));
    require(CALLOUT_TONES.map((value) => `wiki.callout.${value}`));

    expect(missing).toEqual([]);
  });

  // §13: Khmer numerals are pinned out of the UI via numberingSystem: 'latn'.
  // A literal Khmer digit typed into a catalogue bypasses that entirely.
  it('contains no literal Khmer numerals', () => {
    const offenders = kmKeys.filter((k) => /[០-៩]/.test(get(km as Tree, k) ?? ''));
    expect(offenders).toEqual([]);
  });
});
