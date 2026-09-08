import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { hasKhmer } from '@/lib/search';
import type { TemplateRow } from '@/server/queries/wiki';

/**
 * A space's templates (§21.7 — slice 22).
 *
 * **This list exists because the tree deliberately does not show them.** §21.7
 * hides a template from the sidebar, which is right — a wiki's navigation should
 * be the documents, not the stationery — and hidden with nowhere else to look is
 * a page nobody can ever edit again. So the templates are here, on the space's
 * own home, named and linked.
 *
 * A server component with no client anything: two links per row, both of which
 * are ordinary navigations. **Each template offers a link to *use* it as well as
 * one to read it**, and the "use" link is the whole feature — it is
 * `new?template={id}`, which is a URL somebody can send a colleague ("start an
 * incident report"). §5 asks that of every other state in the product; a
 * `<select>` on the create form could not have been one.
 *
 * **It renders nothing when the space has no templates**, which is `DeletedPages`
 * rule and the same argument: a permanent "Templates (0)" heading is furniture
 * that teaches people to skip the region, and §20.15's first-year risk is a wiki
 * nobody writes in rather than one with too few headings.
 */
export async function SpaceTemplates({
  workspaceSlug,
  spaceSlug,
  templates,
  canWrite,
}: {
  workspaceSlug: string;
  spaceSlug: string;
  templates: TemplateRow[];
  canWrite: boolean;
}) {
  if (templates.length === 0) return null;

  const t = await getTranslations('wiki');

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h2 className="text-2xs font-medium uppercase tracking-wide text-text-muted">
        {t('template.sectionTitle')}
      </h2>

      <ul className="space-y-1">
        {templates.map((template) => (
          <li key={template.id} className="flex flex-wrap items-center gap-2 text-xs">
            {template.icon && (
              /* Decorative, exactly as on the reader and in the backlink list. */
              <span aria-hidden="true">{template.icon}</span>
            )}

            <Link
              href={`/${workspaceSlug}/wiki/${spaceSlug}/${template.slug}`}
              lang={hasKhmer(template.title) ? 'km' : undefined}
              className="text-accent hover:underline"
            >
              {template.title}
            </Link>

            {canWrite && (
              <Link
                href={`/${workspaceSlug}/wiki/${spaceSlug}/new?template=${template.id}`}
                className="text-2xs text-text-muted underline-offset-2 hover:underline"
              >
                {t('template.use')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
