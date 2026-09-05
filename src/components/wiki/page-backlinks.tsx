import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasKhmer } from '@/lib/search';
import type { Backlink } from '@/server/queries/wiki';

/**
 * **What links here** (§21.4) — the pages whose bodies reference this one.
 *
 * "Automatic bidirectional linking is the cheapest thing in this section and the
 * one that most changes how a wiki feels. It is the difference between a folder
 * tree and a body of knowledge: you write a page about deployment, and the page
 * about onboarding — written by somebody else, six months earlier — starts
 * listing it without anybody maintaining an index."
 *
 * **Nobody maintains this and nobody can edit it**, which is why it is a list of
 * links and not a panel with controls. A backlink is not a thing somebody made —
 * it is a fact about somebody else's sentence, and the way to remove one is to
 * edit that sentence. That is the whole difference from the *Related items*
 * panel above it, which lists **authored** `wiki_page_link` rows and does carry
 * a detach control (§21.4's two kinds of edge).
 *
 * `[E]` §11: no referring pages renders **nothing**, not an empty panel. "No
 * pages link here" under a heading is a true sentence nobody needs, on the
 * majority of pages in a young wiki — §20.15's first-year risk is a wiki that
 * feels empty, and a product that says so on every page is not helping.
 *
 * The rows are already scoped to spaces this reader can see — `getPage` resolves
 * that before the query is built (§20.5), because a backlink is the one place a
 * page in a space somebody cannot read would otherwise announce its own title.
 */
export async function PageBacklinks({
  backlinks,
  workspaceSlug,
}: {
  backlinks: Backlink[];
  workspaceSlug: string;
}) {
  if (backlinks.length === 0) return null;

  const t = await getTranslations('wiki');

  return (
    <section aria-labelledby="backlinks-heading" className="space-y-2 border-t border-border pt-4">
      <h2 id="backlinks-heading" className="text-2xs font-medium uppercase tracking-wide text-text-subtle">
        {t('reader.backlinks', { count: backlinks.length })}
      </h2>

      <ul className="space-y-1 text-xs">
        {backlinks.map((page) => (
          <li key={page.id}>
            <Link
              href={`/${workspaceSlug}/wiki/${page.spaceSlug}/${page.slug}`}
              className="flex items-baseline gap-1.5 text-accent hover:underline"
            >
              {page.icon && (
                // Decorative: the title carries the meaning, and an emoji read
                // aloud before every entry is a list nobody can listen to.
                <span aria-hidden="true" className="shrink-0">
                  {page.icon}
                </span>
              )}
              <span lang={hasKhmer(page.title) ? 'km' : undefined} className="truncate">
                {page.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
