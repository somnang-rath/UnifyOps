import { useTranslations } from 'next-intl';
import { BookText, CircleDot, FolderOpen, Hash, StickyNote, User } from 'lucide-react';
import { EmptyState } from '@/components/ui/feedback';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { displayName } from '@/lib/seeded-name';
import type { PersonHit } from '@/server/queries/search';
import type {
  NoteSearchHit,
  PageSearchHit,
  ReferenceHit,
  SearchItemHit,
} from '@/server/services/search';
import type { ProjectSummary } from '@/server/services/projects';

/**
 * §7.9's results screen, drawn (slice 14).
 *
 * A **server component**. The palette is the interactive surface; this is the
 * one you land on, link to and print, and it needs no client at all — the form
 * above it is a plain `GET`, so the URL is the state, which is §5's rule for
 * every other view in the product. That also means a search result is
 * back-buttonable and shareable, which the palette by itself is not.
 *
 * Four sections in §7.9's order, each omitted when empty rather than shown with
 * a shrug beneath its heading — the same rule the palette follows, for the same
 * reason: a heading standing over nothing reads as a section that failed.
 */

export function SearchResults({
  workspaceSlug,
  query,
  searched,
  includeArchived,
  reference,
  items,
  itemTotal,
  pages,
  notes,
  projects,
  people,
}: {
  workspaceSlug: string;
  query: string;
  searched: boolean;
  includeArchived: boolean;
  reference: ReferenceHit | null;
  items: SearchItemHit[];
  itemTotal: number;
  pages: PageSearchHit[];
  notes: NoteSearchHit[];
  projects: ProjectSummary[];
  people: PersonHit[];
}) {
  const t = useTranslations();

  const nothing =
    reference === null &&
    items.length === 0 &&
    pages.length === 0 &&
    notes.length === 0 &&
    projects.length === 0 &&
    people.length === 0;

  if (!searched) {
    return <EmptyState title={t('search.hint', { min: 2 })} />;
  }

  if (nothing) {
    return (
      <EmptyState
        title={t('search.noResults', { query })}
        /*
         * §7.9's `[E]` asks for "No results for X **+ a create option**". The
         * honest option here is not "create an item" — a work item needs a
         * project, and §7.2's inline composer is where one is created, in the
         * project it belongs to. What a person who found nothing most often
         * wants is the search they did not realise they had narrowed, so the
         * offer is the archived half of the corpus (§17-17), and it disappears
         * once they have already asked for it.
         */
        action={
          includeArchived ? undefined : (
            <Link
              href={`/${workspaceSlug}/search?q=${encodeURIComponent(query)}&arch=1`}
              className="text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              {t('search.includeArchived')}
            </Link>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-8">
      {reference !== null && (
        <Section heading={t('search.sections.reference')}>
          <Row
            href={`/${workspaceSlug}/projects/${reference.projectSlug}/${reference.number}`}
            icon={<Hash size={16} strokeWidth={1.5} aria-hidden="true" />}
            title={reference.title}
            meta={reference.identifier}
            badge={reference.archived ? t('projects.archived') : undefined}
          />
        </Section>
      )}

      {items.length > 0 && (
        <Section heading={t('search.sections.items')} count={itemTotal}>
          {items.map((hit) => (
            <Row
              key={hit.id}
              href={`/${workspaceSlug}/projects/${hit.projectSlug}/${hit.number}`}
              icon={<CircleDot size={16} strokeWidth={1.5} aria-hidden="true" />}
              title={hit.title}
              meta={`${hit.identifier} · ${hit.projectName}`}
              badge={
                hit.archived
                  ? t('projects.archived')
                  : hit.blocked
                    ? t('workItems.blocked')
                    : undefined
              }
              tone={hit.blocked && !hit.archived ? 'danger' : 'muted'}
            />
          ))}
          {/*
            §7.9 does not page these and the count says why rather than hiding
            it: keyset paging goes through `/api/internal/list`, which returns
            rows for one project's context and one project's states, and a
            cross-project page two needs a project map it has no way to carry.
            The same limitation slice 13 stated for My Work, with the same honest
            escape — narrow the search.
          */}
          {itemTotal > items.length && (
            <p className="px-3 py-2 text-xs text-text-subtle">
              {t('search.showingFirst', { shown: items.length, total: itemTotal })}
            </p>
          )}
        </Section>
      )}

      {pages.length > 0 && (
        <Section heading={t('search.sections.pages')}>
          {pages.map((page) => (
            <Row
              key={page.id}
              href={`/${workspaceSlug}/wiki/${page.spaceSlug}/${page.slug}`}
              icon={<BookText size={16} strokeWidth={1.5} aria-hidden="true" />}
              title={page.title}
              // The space, not the preview: "Overview" is a title three spaces
              // in a company share, and the space is what tells them apart.
              // `displayName` because the seeded company space renders
              // translated until somebody renames it (§13).
              meta={displayName(
                { name: page.spaceName, nameKey: page.spaceNameKey },
                (key: string) => t(key),
              )}
            />
          ))}
        </Section>
      )}

      {notes.length > 0 && (
        <Section heading={t('search.sections.notes')}>
          {notes.map((note) => (
            <Row
              key={note.id}
              // A note has no route of its own (§20.11), so the row links to the
              // notes screen and the fragment names the row there.
              href={`/${workspaceSlug}/notes#note-${note.id}`}
              icon={<StickyNote size={16} strokeWidth={1.5} aria-hidden="true" />}
              title={note.title || t('notes.untitled')}
              meta={note.preview}
            />
          ))}
        </Section>
      )}

      {projects.length > 0 && (
        <Section heading={t('search.sections.projects')}>
          {projects.map((project) => (
            <Row
              key={project.id}
              href={`/${workspaceSlug}/projects/${project.slug}`}
              icon={<FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />}
              title={project.name}
              meta={project.key}
              badge={project.archivedAt !== null ? t('projects.archived') : undefined}
            />
          ))}
        </Section>
      )}

      {people.length > 0 && (
        <Section heading={t('search.sections.people')}>
          {people.map((person) => (
            <Row
              key={person.memberId}
              // §7.3's My Work, filtered to them — the useful thing to know about
              // a colleague is what they are working on, and the assignee filter
              // is the anchor that makes the question answerable at all.
              href={`/${workspaceSlug}?a=${person.memberId}`}
              icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
              title={person.name}
              meta={person.email}
              badge={person.active ? undefined : t('search.formerMember')}
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  heading,
  count,
  children,
}: {
  heading: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 font-[family-name:var(--font-display)] text-base font-semibold text-text">
        {heading}
        {count !== undefined && (
          <span className="text-xs font-normal text-text-subtle">{count}</span>
        )}
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

function Row({
  href,
  icon,
  title,
  meta,
  badge,
  tone = 'muted',
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  meta: string;
  badge?: string;
  tone?: 'muted' | 'danger';
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2 transition-colors duration-120 hover:bg-surface-hover"
    >
      <span className="shrink-0 text-text-subtle">{icon}</span>
      {/* Truncation is CSS rather than a slice, which is the only truncation that
          cannot break a Khmer grapheme cluster (§13). */}
      <span className="min-w-0 flex-1 truncate text-sm text-text">{title}</span>
      <span className="hidden shrink-0 text-xs text-text-subtle sm:inline">{meta}</span>
      {badge !== undefined && (
        <span
          className={cn(
            'shrink-0 rounded-xs border px-1.5 py-px text-2xs',
            tone === 'danger'
              ? 'border-danger bg-danger-subtle text-text'
              : 'border-border bg-surface-sunken text-text-muted',
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
