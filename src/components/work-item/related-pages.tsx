import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasKhmer } from '@/lib/search';

/**
 * The wiki pages linked to this item (§20.2, §20.12).
 *
 * **The half that makes a wiki get read.** §20.15 names the feature's usual
 * fate — "a wiki nobody writes in" — and gives two mitigations: the note as an
 * on-ramp, and this. "A page reached from work is a page that gets read."
 *
 * A **server** component with no state and no action, because the linking is
 * done from the page side (`page-links.tsx`): a panel that could also link would
 * be a second control for one relation, and the item page already carries five
 * panels. Reading is what this side is for.
 *
 * **It renders nothing when there is nothing**, unlike every other panel on the
 * item page. Attachments, comments and custom fields each have a control that
 * belongs on the screen whether or not anything has been added; this has none,
 * so an empty heading would be a permanent row of furniture on the busiest
 * screen in the product saying that a feature exists.
 *
 * The rows were filtered by readable space in `relatedPagesFor` — an item
 * somebody can see may be linked from a page in a project they cannot.
 */
export async function RelatedPages({
  pages,
  workspaceSlug,
}: {
  pages: { pageId: string; title: string; slug: string; spaceSlug: string }[];
  workspaceSlug: string;
}) {
  if (pages.length === 0) return null;

  const t = await getTranslations('wiki');

  return (
    <section className="space-y-2">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-text-muted">
        {t('related.title')}
      </h2>

      <ul className="space-y-1">
        {pages.map((page) => (
          <li key={page.pageId}>
            <Link
              href={`/${workspaceSlug}/wiki/${page.spaceSlug}/${page.slug}`}
              className="block text-xs text-accent hover:underline"
            >
              {/*
                §20.10: `lang` follows the content rather than the page. A Khmer
                page title in an English workspace clips its diacritics at a
                Latin line-height — the gap §13 has carried open since slice 8,
                closed everywhere at once in this slice.
              */}
              <span lang={hasKhmer(page.title) ? 'km' : undefined} className="line-clamp-2">
                {page.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
