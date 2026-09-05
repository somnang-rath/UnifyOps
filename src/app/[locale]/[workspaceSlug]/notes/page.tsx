import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { NoteComposer } from '@/components/notes/note-composer';
import { NoteList } from '@/components/notes/note-list';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { listNotes } from '@/server/services/notes';
import { listProjects } from '@/server/services/projects';
import { listSpaces } from '@/server/services/wiki';
import { displayName } from '@/lib/seeded-name';

/**
 * §20.11's notes screen (slice 17).
 *
 * **Private to this person, and there is no permission check on the page**
 * (§20.5). Every screen in this product that shows a company's data re-asks §10
 * for itself; this one has nothing to ask, because the rows it renders are
 * bounded by `owner_member_id` before any of them exist. A permission gate here
 * would imply somebody could be granted access to it, which is exactly what
 * §20.1 promises cannot happen.
 *
 * **The word "private" is qualified on screen, and that is deliberate** (§20.5).
 * An Owner in a §7.13 view-as session reads these rows, because `withActor`
 * scopes as the target member — that is what view-as is *for*, and it is
 * audited. So the banner says "private to you and to anyone who can view as
 * you". A screen that promised more than the architecture delivers would be the
 * one lie in the product that matters most.
 *
 * The projects list is loaded for one reason only — §20.3.4's promotion picker —
 * and it is filtered to the projects this person may actually create work in, so
 * the picker offers nothing that would be refused.
 */
export default async function NotesPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, listing, projects, spaces] = await Promise.all([
    getTranslations(),
    listNotes(resolved),
    listProjects(resolved),
    // §20.3.4's second destination (slice 18). Loaded here for the same reason
    // the projects are: the promotion picker must offer only what the service
    // would accept, and `listSpaces` is the one place §20.5's write rule is
    // asked.
    listSpaces(resolved),
  ]);

  /**
   * Only projects §10 would let this person create work in (§20.3.4's `[!]`).
   *
   * Filtered rather than disabled, and asked of the policy module rather than
   * re-derived from a role — the composition rules for an implicit Lead, a
   * workspace-visible project and a Guest's cap all live in
   * `effectiveProjectRole`, and a second copy of them here would drift.
   */
  const promotable = projects
    .filter(
      (project) =>
        project.archivedAt === null &&
        can(resolved.actor, 'work_item.create', {
          id: project.id,
          workspaceId: resolved.workspace.id,
          visibility: project.visibility,
        }),
    )
    .map((project) => ({ id: project.id, name: project.name }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-semibold tracking-tight">{t('notes.title')}</h1>
        <p className="text-sm text-text-muted">{t('notes.subtitle')}</p>
      </header>

      <Alert>{t('notes.privacy')}</Alert>

      <NoteComposer workspaceSlug={workspaceSlug} locale={locale} />

      <NoteList
        notes={listing.notes}
        total={listing.total}
        workspaceSlug={workspaceSlug}
        locale={locale}
        projects={promotable}
        spaces={spaces
          // Only spaces this person may write in (§20.3.4's `[!]`). Filtered
          // rather than disabled, and the answer comes from `space-access.ts`
          // rather than being re-derived here.
          .filter((space) => space.canWrite)
          .map((space) => ({
            id: space.id,
            // The seeded company space renders translated until somebody
            // renames it (§13's awkward middle).
            name: displayName(space, (key) => t(key)),
          }))}
      />
    </div>
  );
}
