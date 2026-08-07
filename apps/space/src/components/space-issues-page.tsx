import { EmptyState } from '@prism/ui';
import { formatDate, type Locale } from '@prism/i18n';
import type { PublicProject, PublicView } from '@/lib/public-api';
import { SpaceCover } from './space-cover';
import { SpaceBoard } from './space-board';
import { SpaceIssueList } from './space-issue-list';

/**
 * Page shell for a published view or project (spec publish-to-space §3.2).
 * Server component. Issue payloads are wider than prose, so the container is
 * wider than the wiki's 720px, but the page rhythm (px-6 py-14, header block,
 * "Published with Prism" footer) matches the wiki article exactly.
 */
export function SpaceIssuesPage({
  payload,
  locale,
}: {
  payload: PublicView | PublicProject;
  locale: Locale;
}) {
  // ADR 0012 §6: 'kanban' renders as a board ('board' accepted for forward
  // compat); calendar/timeline/spreadsheet all degrade to the list in v1.
  const isBoard = payload.layout === 'kanban' || payload.layout === 'board';
  const updated = formatDate(payload.updatedAt, locale);
  const projectName = payload.type === 'view' ? payload.projectName : null;
  const description = payload.type === 'project' ? payload.description : null;
  const coverImage = payload.type === 'project' ? payload.coverImage : null;

  return (
    <main className="min-h-screen">
      <div
        className={`mx-auto px-6 py-14 ${isBoard ? 'max-w-[1080px]' : 'max-w-[840px]'}`}
      >
        {coverImage && <SpaceCover src={coverImage} />}
        <header className="mb-8 border-b border-border pb-6">
          {projectName && (
            <p className="text-2xs uppercase tracking-wider text-text-muted">
              {projectName}
            </p>
          )}
          <h1 className="text-3xl font-bold tracking-tight">{payload.title}</h1>
          {description && (
            <p className="text-[14px] text-text-sub mt-2">{description}</p>
          )}
          <p className="text-[13px] text-text-muted mt-2">Last updated {updated}</p>
        </header>

        {payload.issues.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg py-16">
            <EmptyState
              label="Nothing here yet"
              hint="No work items are published in this view."
            />
          </div>
        ) : isBoard ? (
          <SpaceBoard
            issues={payload.issues}
            groupBy={payload.groupBy}
            columns={payload.columns}
            locale={locale}
          />
        ) : (
          <SpaceIssueList
            issues={payload.issues}
            columns={payload.columns}
            locale={locale}
          />
        )}

        <footer className="mt-14 pt-6 border-t border-border text-[12px] text-text-muted">
          Published with Prism
        </footer>
      </div>
    </main>
  );
}
