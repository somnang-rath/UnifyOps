import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasKhmer } from '@/lib/search';
import { displayName } from '@/lib/seeded-name';
import type { PageSummary } from '@/server/queries/wiki';

/**
 * Where a page sits (§20.11's reader).
 *
 * A `<nav>` with an ordered list, which is the markup a breadcrumb *is* — the
 * order is the meaning, so an `<ol>` says it to a screen reader without an
 * `aria-label` per crumb having to.
 *
 * The separator is `aria-hidden` and drawn in CSS content rather than typed
 * between the links: a `/` inside the list is a list item somebody has to hear.
 */
export async function PageBreadcrumb({
  workspaceSlug,
  space,
  ancestors,
  title,
}: {
  workspaceSlug: string;
  space: { slug: string; name: string; nameKey: string | null };
  ancestors: PageSummary[];
  /** The current page. Rendered as text, never as a link to itself. */
  title?: string;
}) {
  const t = await getTranslations();

  /**
   * The seeded company space renders translated until somebody renames it
   * (§13's awkward middle). `displayName` is the one place that rule is
   * applied — a screen reading `space.name` directly shows a Khmer workspace the
   * English word "Company".
   */
  const spaceName = displayName(space, (key) => t(key));

  return (
    <nav aria-label={t('wiki.breadcrumb.label')}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-2xs text-text-muted">
        <li>
          <Link href={`/${workspaceSlug}/wiki`} className="hover:text-text">
            {t('wiki.title')}
          </Link>
        </li>

        <li aria-hidden className="text-text-subtle">
          /
        </li>

        <li>
          <Link
            href={`/${workspaceSlug}/wiki/${space.slug}`}
            lang={hasKhmer(spaceName) ? 'km' : undefined}
            className="hover:text-text"
          >
            {spaceName}
          </Link>
        </li>

        {ancestors.map((ancestor) => (
          <li key={ancestor.id} className="flex items-center gap-1">
            <span aria-hidden className="text-text-subtle">
              /
            </span>
            <Link
              href={`/${workspaceSlug}/wiki/${space.slug}/${ancestor.slug}`}
              lang={hasKhmer(ancestor.title) ? 'km' : undefined}
              className="hover:text-text"
            >
              {ancestor.title}
            </Link>
          </li>
        ))}

        {title !== undefined && (
          <li className="flex items-center gap-1">
            <span aria-hidden className="text-text-subtle">
              /
            </span>
            <span lang={hasKhmer(title) ? 'km' : undefined} className="text-text">
              {title}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
