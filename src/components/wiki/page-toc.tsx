import { getTranslations } from 'next-intl/server';
import { hasKhmer } from '@/lib/search';
import { tableOfContents } from '@/lib/documents';

/**
 * The table of contents §21.5 asks for — "jump to a heading from a generated
 * table of contents".
 *
 * **Generated, never authored.** There is no `[TOC]` marker and no stored
 * outline: the headings are the outline, so a contents list that could disagree
 * with them is a second source of truth that goes stale silently — the argument
 * slice 14 made when it generated the `?` sheet from `BINDINGS` rather than
 * keeping a table beside them.
 *
 * A **server** component, like `PageReader` beside it: the parse already runs on
 * this render, and a client component would ship `documents.ts` to the browser
 * to draw a list of links.
 *
 * **Plain fragment links, and no scroll script.** `href="#anchor"` is what the
 * platform already does well — it works with the keyboard, it is a real
 * destination the back button can return from, and it survives JavaScript
 * failing to load. `DocumentBody`'s headings carry `scroll-mt-16` and
 * `tabIndex={-1}` so the jump lands under the sticky header and takes focus with
 * it, which is the half a bare fragment gets wrong.
 *
 * `[E]` §11: a body with no headings renders **nothing at all** rather than an
 * empty panel with a title. A contents list for a document that has no structure
 * is a heading over a blank space, and the page below it is the answer.
 */
export async function PageToc({ body }: { body: string }) {
  const entries = tableOfContents(body);

  // One heading is not an outline — it is the top of the page, which is already
  // on screen. Two is the point at which jumping saves anybody anything.
  if (entries.length < 2) return null;

  const t = await getTranslations('wiki');

  return (
    <nav aria-labelledby="page-toc-heading" className="space-y-2">
      <h2 id="page-toc-heading" className="text-2xs font-medium uppercase tracking-wide text-text-subtle">
        {t('reader.contents')}
      </h2>

      <ol className="space-y-1 text-xs">
        {entries.map((entry) => (
          <li
            key={entry.anchor}
            /**
             * Indented by level, and clamped: `documents.ts` accepts six heading
             * levels and `DocumentBody` renders three, so a contents list that
             * indented all six would step further right than the page ever goes.
             * `ps-*` rather than `pl-*` — a logical property, the rule the
             * blockquote rule follows.
             */
            className={INDENT[Math.min(entry.level, 3)] ?? INDENT[1]}
          >
            <a
              href={`#${entry.anchor}`}
              lang={hasKhmer(entry.text) ? 'km' : undefined}
              className="block truncate text-text-muted hover:text-text hover:underline"
              // The full heading, for a title long enough to be truncated above.
              title={entry.text}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const INDENT: Record<number, string> = { 1: '', 2: 'ps-3', 3: 'ps-6' };
