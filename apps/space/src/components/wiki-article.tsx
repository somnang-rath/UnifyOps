import type { PublicWikiPage } from '@/lib/public-api';
import { sanitizeContent } from '@/lib/public-api';
import { SpaceCover } from './space-cover';
import { WikiToc } from './wiki-toc';

/**
 * Published wiki article — the pre-ADR-0012 [anchor] page markup, moved here
 * verbatim so the route can branch on payload type. Do not restyle: the wiki
 * path is explicitly unchanged (ADR 0012 scope).
 */
export function WikiArticle({ page }: { page: PublicWikiPage }) {
  const html = sanitizeContent(page.contentHTML);
  const updated = new Date(page.updatedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <main className="min-h-screen">
      <article className="mx-auto max-w-[720px] px-6 py-14">
        {page.coverImage && <SpaceCover src={page.coverImage} />}
        <header className="mb-8 border-b border-gray-100 dark:border-gray-800 pb-6">
          <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
          <p className="mt-2 text-[13px] text-gray-500">
            Last updated {updated}
          </p>
        </header>
        <WikiToc html={html} />
        <div
          className="prose-space"
          // Sanitized in sanitizeContent() — the single security boundary for
          // public rendering (ADR 0002 §5).
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <footer className="mt-14 pt-6 border-t border-gray-100 dark:border-gray-800 text-[12px] text-gray-400">
          Published with Prism
        </footer>
      </article>
    </main>
  );
}
