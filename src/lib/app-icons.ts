/**
 * The product's own icon set — the one §15-8 checks by adding UnifyOps to a
 * phone home screen, and the one a browser tab shows.
 *
 * **The mark is the UnifyCharge primary logomark, by explicit instruction on
 * 2026-09-04.** CLAUDE.md's standing rule was to use the *parent Unify* mark
 * and to ask rather than substitute when it was missing; it is still missing,
 * the question was put, and this is the answer. The rule now reads: UnifyOps
 * ships the UnifyCharge logomark until the parent mark is supplied.
 *
 * Worth stating once, because it is the reason the rule existed: the logomark
 * is a hexagon around a lightning bolt, and the bolt means EV charging rather
 * than work management. It also carries UnifyCharge's own `#28a6df` rather
 * than the palette's Sky `#54A6DB`, and it is kept verbatim — recolouring a
 * brand's logomark to a *different* blue would leave it neither mark.
 *
 * The files are generated from
 * `UnifyCharge_Brand_Assets/…/02_Logos/01_Primary_Logomark/SVG/Primary_Logomark.svg`
 * and are the only images in the repo. Replacing them is the whole of swapping
 * the mark: nothing else in `src/` names an icon.
 */

export type AppIcon = {
  src: string;
  sizes: string;
  type: string;
  /**
   * `maskable` is the one that matters on Android: a `purpose: 'any'` icon is
   * dropped into a white circle with a border, which is how a good mark ends up
   * looking like a sticker on somebody's home screen.
   */
  purpose?: 'any' | 'maskable';
};

/**
 * Whether `public/icons/` holds a mark. Kept as a flag rather than deleted,
 * because the parent Unify mark arriving is a file swap plus a comment here —
 * and because an empty `icons` array is the honest state if one is ever pulled.
 */
export const MARK_AVAILABLE = true;

const ICONS: readonly AppIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** The manifest's `icons`. Empty if the mark is ever withdrawn — see above. */
export function appIcons(): readonly AppIcon[] {
  return MARK_AVAILABLE ? ICONS : [];
}

/**
 * The browser tab, which is a different question from the home screen.
 *
 * The SVG is the brand file verbatim and is what every current browser uses —
 * it stays crisp at whatever size the tab strip is drawing today. The 32px PNG
 * is the fallback for the ones that decline an SVG favicon; it is second in the
 * list because a browser that understands both should take the vector.
 */
const FAVICONS: readonly { url: string; type: string; sizes?: string }[] = [
  { url: '/icons/icon.svg', type: 'image/svg+xml' },
  { url: '/icons/icon-32.png', type: 'image/png', sizes: '32x32' },
];

export function favicons(): readonly { url: string; type: string; sizes?: string }[] {
  return MARK_AVAILABLE ? FAVICONS : [];
}

/**
 * iOS ignores the manifest's icons entirely and reads `<link rel="apple-touch-icon">`,
 * so it is a second declaration of the same asset rather than a duplicate. It
 * is the one PNG in the set that is deliberately **opaque**: iOS composites a
 * transparent touch icon onto black, which would put a dark square on a light
 * home screen.
 */
export const APPLE_TOUCH_ICON = '/icons/apple-touch-icon.png';

/**
 * The browser-chrome colour, and the colour behind a standalone window before
 * the first paint.
 *
 * These are the light and dark palettes' own `--bg` — BRAND Ivory and the
 * deepest step of the neutral ramp — copied rather than referenced, because a
 * manifest is JSON served to an installer and a `<meta>` is read before any
 * stylesheet: neither can resolve a custom property. They are the only two
 * places in `src/` outside `globals.css` and `global-error.tsx` where a hex is
 * correct, and they must be changed with layer 2 rather than on their own.
 */
export const THEME_COLOR_LIGHT = '#f2f0ed';
export const THEME_COLOR_DARK = '#161f28';
