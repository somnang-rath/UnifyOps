'use client';

import { useEffect } from 'react';

/**
 * The last resort: the boundary that catches a failure in the **root layout
 * itself**, which is the one place `[locale]/error.tsx` cannot reach.
 *
 * Three things about it are deliberate and would otherwise look like
 * shortcuts:
 *
 *   * **It renders both languages.** Every other string in the product is
 *     translated, because next-intl's provider is in the layout — and this
 *     component only ever renders when that layout did not. There is no locale
 *     to read and no catalogue to read it from. §13's rule is that Khmer is
 *     never the degraded path, and on the one screen that cannot choose, the
 *     honest way to keep that promise is to say it in both rather than to pick
 *     English and call it a default.
 *   * **It uses inline styles and no token.** `globals.css` is imported by the
 *     locale layout, and the font variables are set by it; a screen that
 *     depends on the thing that just failed is a blank page. The Khmer face is
 *     named explicitly in the stack for the same reason §17-26 re-states it in
 *     the print stylesheet — inherit nothing here.
 *
 *     This is therefore the **one file in `src/` with literal hex in it**, and
 *     `check-design-tokens.sh` will say so. The four values are the light
 *     palette's own resolved anchors — BRAND Ivory, BRAND Charcoal, BRAND Navy
 *     and white — copied rather than referenced, because a reference is the
 *     failure this file exists to survive. It follows that it is always light:
 *     `.dark` is set by a script in a layout that did not run.
 *   * **A reload, not a `reset()`.** Everywhere else §11's "retains user input"
 *     argues for re-rendering a segment. Here the document itself never
 *     mounted, so there is no typed text to retain and nothing below to
 *     re-render.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error('[unifyops] fatal', error.digest ?? '(no digest)', error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#f2f0ed',
          color: '#212e3b',
          fontFamily:
            "'IBM Plex Sans', system-ui, -apple-system, 'Kantumruy Pro', 'Noto Sans Khmer', sans-serif",
        }}
      >
        <main style={{ maxWidth: '28rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            UnifyOps couldn&rsquo;t load
          </h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 0.5rem' }}>
            Reload the page. If it happens again, tell whoever set up your workspace.
          </p>
          {/* Khmer carries its own line-height: the diacritics stack vertically
              and clip at a Latin one (§13). */}
          <p
            lang="km"
            style={{ fontSize: '0.875rem', lineHeight: 1.75, margin: '0 0 1.5rem' }}
          >
            សូមផ្ទុកទំព័រឡើងវិញ។ បើកើតឡើងម្តងទៀត សូមប្រាប់អ្នកដែលបានរៀបចំកន្លែងធ្វើការរបស់អ្នក។
          </p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              height: '2.5rem',
              padding: '0 1rem',
              borderRadius: '0.375rem',
              border: 0,
              background: '#214775',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reload · ផ្ទុកឡើងវិញ
          </button>
        </main>
      </body>
    </html>
  );
}
