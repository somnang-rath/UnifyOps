import { getTranslations } from 'next-intl/server';

/**
 * §11's accessibility baseline, first row: "Keyboard-operable throughout."
 *
 * The workspace shell puts a logo, five navigation links, the command palette,
 * the inbox bell, two toggles and sign-out ahead of the page — so without this
 * a keyboard user pays eleven tab stops for every navigation in the product,
 * and a screen-reader user hears the whole header again on each one.
 *
 * Two details are the whole component:
 *
 *   * **It is visually hidden until focused, not hidden.** `sr-only` alone
 *     would keep it from sighted keyboard users, who are the people it helps
 *     most; `focus:not-sr-only` is what brings it back at the moment it matters.
 *   * **It states its own focus ring.** The same exception the accent picker
 *     makes and for the same reason — the global `:focus-visible` rule draws on
 *     an element that is clipped to a 1px box while unfocused, and the styles
 *     that un-clip it and the ring have to arrive together.
 *
 * The target is `#main`, which every layout in the product puts on its `<main>`.
 */
export async function SkipToContent() {
  const t = await getTranslations('a11y');

  return (
    <a
      href="#main"
      className="sr-only rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-fg outline-2 outline-offset-2 outline-accent-ring focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50"
    >
      {t('skipToContent')}
    </a>
  );
}
