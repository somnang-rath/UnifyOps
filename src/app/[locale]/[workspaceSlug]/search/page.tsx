import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SearchResults } from '@/components/search/search-results';
import { resolveActorContext } from '@/server/auth/context';
import { listProjects } from '@/server/services/projects';
import { searchWorkspace } from '@/server/services/search';
import { MAX_QUERY_LENGTH } from '@/lib/search';

/**
 * §7.9's results screen (§14, slice 14).
 *
 * The palette answers "take me to the thing"; this answers "show me everything
 * that matched", and it is the surface §7.9's scope rules actually live on —
 * the archived toggle, the counts, the link somebody pastes into a chat.
 *
 * **A plain `GET` form and no client component**, which is not minimalism: it is
 * the same rule §5 applies to every other view, that view state is a URL. A
 * search you can bookmark, share, print and reach with the back button follows
 * from the form method and from nothing else.
 *
 * The projects are resolved here and handed to the service, which is §16's
 * anchor: `listProjects` is §10's own answer to "what may this person see", and
 * an enumerated project set is what makes a workspace-wide text query a bounded
 * one. It is also what the archived toggle needs, so the page pays for it once
 * and the service does not pay for it again.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const search = await searchParams;
  const query = first(search.q) ?? '';
  // §7.9: "excluded by default, with a one-click include-archived toggle."
  const includeArchived = first(search.arch) === '1';

  const t = await getTranslations();

  /**
   * Archived projects are loaded whenever the toggle asks for them, and the two
   * halves of §7.9's scope rule are applied in different places on purpose: this
   * decides which projects may appear in the Projects section, and the flag
   * handed to the service decides which *items* may, through §9's builder and
   * §17-17's default filter.
   */
  const projects = await listProjects(resolved, { includeArchived });

  const results = await searchWorkspace(resolved, {
    text: query,
    projects,
    includeArchived,
    // More than the palette's five: this is the screen you come to when five was
    // not enough. Still capped rather than paged — see the note in
    // `SearchResults` about why a cross-project page two needs machinery §7.9
    // does not ask for.
    limit: 25,
  });

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-text">
          {t('search.title')}
        </h1>
      </div>

      {/*
        A `GET` form: submitting rewrites the URL, which is the whole of this
        screen's state. No `onSubmit`, no router push, no client boundary.
      */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          {/* §12: "Placeholders are never labels." */}
          <label htmlFor="search-q" className="mb-1 block text-xs text-text-muted">
            {t('search.label')}
          </label>
          <input
            id="search-q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={MAX_QUERY_LENGTH}
            autoComplete="off"
            // The one input in the product that is autofocused, and it earns it:
            // arriving on a search screen with the caret anywhere else means a
            // click before anybody can type.
            autoFocus
            placeholder={t('search.placeholder')}
            className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text placeholder:text-text-subtle"
          />
        </div>

        <label className="flex h-8 items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            name="arch"
            value="1"
            defaultChecked={includeArchived}
            className="size-4 rounded-xs border-border"
          />
          {t('search.includeArchived')}
        </label>

        <button
          type="submit"
          className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg transition-colors duration-120 hover:bg-accent-hover"
        >
          {t('search.submit')}
        </button>
      </form>

      <SearchResults
        workspaceSlug={workspaceSlug}
        query={results.text}
        searched={results.searched}
        includeArchived={includeArchived}
        reference={results.reference}
        items={results.items}
        itemTotal={results.itemTotal}
        pages={results.pages}
        notes={results.notes}
        projects={results.projects}
        people={results.people}
      />
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
