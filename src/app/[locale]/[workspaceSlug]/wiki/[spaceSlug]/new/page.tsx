import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewPageForm } from '@/components/wiki/new-page-form';
import { PageBreadcrumb } from '@/components/wiki/page-breadcrumb';
import { Link } from '@/i18n/navigation';
import { resolveActorContext } from '@/server/auth/context';
import { getSpace } from '@/server/services/wiki';
import { createPageAction } from '../../actions';

/**
 * §20.3.2's create: "Space sidebar → 'New page' → title → body → save."
 *
 * A route rather than a dialog, because a page body is the longest thing anybody
 * types in this product and a modal is the wrong container for twenty minutes of
 * work — §12's Dialog is for a decision, and slice 14 built the first one in the
 * product for a palette. It is also what makes the draft survive a refresh: the
 * browser keeps a form's values on back-navigation, and a dialog has no URL to
 * come back to.
 *
 * A parent may be chosen, which is what makes the tree buildable at all — the
 * sidebar's "New page" link lands here with no parent, and the picker offers
 * every page shallow enough to take a child (§20.4's cap of 3).
 */
export default async function NewWikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; spaceSlug: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { locale, workspaceSlug, spaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  /**
   * §21.7's template, named in the URL.
   *
   * A search param rather than client state, and it is the same argument §5
   * makes about every other view: `new?template={id}` is a link somebody sends a
   * colleague — "start an incident report" — where a `<select>` would have been
   * a state only the person who clicked it can be in. It is also what keeps the
   * body out of the payload: `fetchSpaceTemplates` sends titles, and the one
   * chosen body is read by the render that shows it.
   *
   * Read before `getSpace`, because it changes what `getSpace` fetches.
   */
  const { template } = await searchParams;

  const [t, view] = await Promise.all([
    getTranslations(),
    getSpace(resolved, spaceSlug, template === undefined ? {} : { templateId: template }),
  ]);
  if (!view) notFound();

  /*
   * A space this person may read but not write in 404s rather than rendering a
   * disabled form. §7.11's rule about the disabled select, applied to a whole
   * screen: "the picker says why rather than showing a disabled row nobody can
   * explain", and the sidebar simply does not offer the link.
   */
  if (!view.space.canWrite) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageBreadcrumb
        workspaceSlug={workspaceSlug}
        space={view.space}
        ancestors={[]}
        title={t('wiki.new.title')}
      />

      <h1 className="font-display text-xl font-semibold tracking-tight">{t('wiki.new.title')}</h1>

      {/*
        §21.7's picker: links, not a control. Each starts the same form with a
        body already in it, and the URL says which — so the back button undoes
        the choice, which no `<select>` in a form would have done.
      */}
      {view.templates.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xs">
          <span className="text-text-muted">{t('wiki.template.startFrom')}</span>

          {view.templates.map((option) => (
            <Link
              key={option.id}
              href={`/${workspaceSlug}/wiki/${spaceSlug}/new?template=${option.id}`}
              aria-current={template === option.id ? 'true' : undefined}
              className={
                template === option.id
                  ? 'font-medium text-text underline underline-offset-2'
                  : 'text-accent hover:underline'
              }
            >
              {option.icon && <span aria-hidden="true">{option.icon} </span>}
              {option.title}
            </Link>
          ))}

          {template !== undefined && (
            <Link
              href={`/${workspaceSlug}/wiki/${spaceSlug}/new`}
              className="text-text-muted underline-offset-2 hover:underline"
            >
              {t('wiki.template.blank')}
            </Link>
          )}
        </div>
      )}

      <NewPageForm
        /*
          Keyed on the chosen template, so choosing one **remounts** the form.

          The form is controlled — it counts graphemes and detects script as you
          type — so its initial values are `useState` seeds, and React keeps
          state across a re-render of the same element. Without this key,
          clicking a second template would change the URL, re-run this server
          component, and leave the old body in the box: the create screen quietly
          ignoring the thing just clicked. A key is the React-shaped answer to
          "this is a different form now", and it is preferable to seeding state
          from props in an effect, which is the trap `GroupList` records from
          slice 5.
        */
        key={template ?? 'blank'}
        draft={view.draft}
        workspaceSlug={workspaceSlug}
        locale={locale === 'km' ? 'km' : 'en'}
        spaceId={view.space.id}
        parents={view.tree
          // Only pages that can still take a child: a parent at the cap would
          // put its child at depth 4, which 0032's trigger refuses. Offering it
          // and refusing afterwards is the shape §7.11 calls a disabled select.
          .filter((page) => page.depth < 3)
          .map((page) => ({ id: page.id, title: page.title, depth: page.depth }))}
        create={createPageAction}
      />
    </div>
  );
}
