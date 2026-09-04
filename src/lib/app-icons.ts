/**
 * The product's own icon set — the one §15-8 checks by adding UnifyOps to a
 * phone home screen.
 *
 * **There is no icon here yet, and that is a deliberate refusal rather than an
 * oversight.** CLAUDE.md records the rule: UnifyOps uses the *parent Unify*
 * mark, never anything under `UnifyCharge_Brand_Assets/02_Logos/` — every
 * logomark there is a hexagon around a lightning bolt, and the bolt means EV
 * charging. The Unify file has not been supplied, and the instruction is to
 * ask rather than substitute.
 *
 * The alternative was a placeholder, and a placeholder is worse than an absence
 * in exactly this place: an icon ships to a home screen, sits there for months,
 * and is the one asset nobody re-opens a ticket about because it *looks* done.
 * An empty `icons` array makes Chrome decline to offer installation, which is
 * the product being honest about a thing it cannot yet do.
 *
 * Everything else the install pass needs is built and tested — the manifest,
 * its per-locale name, `display: standalone`, the scope, the start URL and the
 * theme colour. When the mark arrives this is the only file that changes:
 * drop the four files below into `public/icons/`, flip `MARK_AVAILABLE`, and
 * the manifest, the `apple-touch-icon` link and the favicon all pick them up.
 *
 * Recolour it to the Sky token or `currentColor` first — the UnifyCharge SVGs
 * are filled `#28A6DF`, which is not the palette's own Sky.
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

/** Flip to `true` in the same commit that adds the files below. */
export const MARK_AVAILABLE = false;

const ICONS: readonly AppIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** The manifest's `icons`. Empty until the mark exists — see above. */
export function appIcons(): readonly AppIcon[] {
  return MARK_AVAILABLE ? ICONS : [];
}

/**
 * iOS ignores the manifest's icons entirely and reads `<link rel="apple-touch-icon">`,
 * so it is a second declaration of the same asset rather than a duplicate.
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
