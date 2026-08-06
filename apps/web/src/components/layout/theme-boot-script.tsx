import { headers } from 'next/headers';
import { NONCE_HEADER } from '@prism/constants';

/**
 * Inline pre-paint script: applies persisted theme/accent/density to <html>
 * before the first paint, so users don't see a FOUC switching from light → dark.
 *
 * Carries the per-request CSP nonce set by `src/middleware.ts` — without it the
 * policy blocks this script and every user gets the flash it exists to prevent.
 * Reading `headers()` here (a server component) rather than in the root layout
 * keeps the plumbing next to the one tag that needs it.
 */
export function ThemeBootScript() {
  const nonce = headers().get(NONCE_HEADER) ?? undefined;
  const code = `(function(){try{
    var t=localStorage.getItem('pr_theme')||'dark';
    var a=localStorage.getItem('pr_accent')||'indigo';
    var d=localStorage.getItem('pr_density')||'compact';
    var h=document.documentElement;
    h.setAttribute('data-theme',t);
    h.setAttribute('data-accent',a);
    h.setAttribute('data-density',d);
  }catch(e){}})();`;
  // suppressHydrationWarning: browsers deliberately hide the nonce content
  // attribute once the document is parsed (it would otherwise be readable via
  // CSS attribute selectors and defeat the nonce). React's hydration compare
  // therefore reads "" off the DOM and warns about a mismatch that isn't one.
  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
