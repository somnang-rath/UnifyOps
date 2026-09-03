import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert, Badge } from '@/components/ui/feedback';
import { ActivityFeed } from '@/components/work-item/activity-feed';
import { AttachmentPanel } from '@/components/work-item/attachment-panel';
import { CommentThread } from '@/components/work-item/comment-thread';
import { StatePill } from '@/components/ui/state-pill';
import { ItemEditor } from '@/components/work-item/item-editor';
import { StateSelect, type StateOption } from '@/components/work-item/state-select';
import { resolveActorContext } from '@/server/auth/context';
import { listLabels } from '@/server/services/labels';
import { listMembers } from '@/server/services/members';
import { getActivityFeed } from '@/server/services/activity';
import { getCommentThread } from '@/server/services/comments';
import { getProjectBySlug } from '@/server/services/projects';
import { getWorkItem } from '@/server/services/work-items';
import { displayName } from '@/lib/seeded-name';
import { isOverdue } from '@/lib/workspace-date';
import { Link } from '@/i18n/navigation';

/**
 * One work item, at `/{workspace}/projects/{project}/{number}` — the URL behind
 * `ENG-142`.
 *
 * The number rather than a uuid, because §7.9 makes `ENG-142` a thing people
 * paste to each other and the command palette short-circuits to it. A uuid in
 * the address bar would make the human identifier decorative.
 *
 * §11's five states: `[L]` server-rendered, so no client loading state ·
 * `[E]` not applicable — an item that exists has content · `[S]` each form
 * reports its own save · `[X]` a refusal lands on the form that caused it, as a
 * translated key · `[!]` an archived project renders everything read-only
 * rather than hiding it, so somebody looking at a stale tab can see *why* they
 * cannot type.
 *
 * Below the editor: the item's files, then the comment thread (slice 8), then
 * the activity feed (slice 7). That order is deliberate — a file attached to
 * the item is a property of the work, the conversation is what somebody opening
 * an item is usually looking for, and the history is context for both. Files
 * pasted into a comment render inside that comment rather than in the panel,
 * which is what keeps the two lists meaning different things.
 */
export default async function WorkItemPage({
  params,
  searchParams,
}: {
  params: Promise<{
    locale: string;
    workspaceSlug: string;
    projectSlug: string;
    number: string;
  }>;
  /**
   * `?activity=all` widens the feed and `?comments=all` widens the thread.
   * Links rather than buttons, because nothing about either needs the client:
   * each is the same page with a longer window, so both are shareable,
   * back-buttonable and work with JavaScript off — and they stay out of the
   * filter DSL, which describes a *query* over many items and has no business
   * carrying one item's scroll depth.
   */
  searchParams: Promise<{ activity?: string; comments?: string }>;
}) {
  const { locale, workspaceSlug, projectSlug, number } = await params;
  setRequestLocale(locale);

  const parsedNumber = Number(number);
  // A path segment is user input. A non-numeric one is not "no such item", it
  // is not an item reference at all.
  if (!Number.isInteger(parsedNumber) || parsedNumber < 1) notFound();

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const item = await getWorkItem(resolved, { projectSlug, number: parsedNumber });
  // Null covers "no such item" and "not visible to you" alike — one 404, as
  // everywhere else, because telling them apart says what exists.
  if (!item) notFound();

  const search = await searchParams;
  const allActivity = search.activity === 'all';
  const allComments = search.comments === 'all';

  const [t, project, members, labels, activity, thread] = await Promise.all([
    getTranslations(),
    getProjectBySlug(resolved, projectSlug),
    listMembers(resolved.context),
    listLabels(resolved.context),
    getActivityFeed(resolved, { workItemId: item.id, all: allActivity }),
    // Carries its own mentionable list, resolved in the same transaction (§7.7).
    getCommentThread(resolved, { workItemId: item.id, all: allComments }),
  ]);

  if (!project) notFound();

  const states: StateOption[] = project.states.map((state) => ({
    id: state.id,
    name: displayName(state, t),
    color: state.color,
  }));

  const currentState = states.find((state) => state.id === item.stateId);
  const overdue = isOverdue(item.dueDate, item.today, { completed: item.completedAt !== null });

  /**
   * A widening link that keeps whatever is already widened.
   *
   * Built from the current params rather than written literally, because the
   * two panels each own a search param and a link that named only its own would
   * silently collapse the other one the moment somebody used both.
   */
  const widen = (next: Record<string, string>) => {
    const params = new URLSearchParams({
      ...(allActivity ? { activity: 'all' } : {}),
      ...(allComments ? { comments: 'all' } : {}),
      ...next,
    });
    return `/${workspaceSlug}/projects/${projectSlug}/${item.number}?${params.toString()}`;
  };

  /** What every client control on this page needs to post back. Built once:
   * the files panel, the thread and the composer all take the same one. */
  const itemContext = {
    workspaceSlug,
    projectSlug,
    locale,
    workItemId: item.id,
    number: item.number,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav aria-label={t('nav.projects')} className="text-xs text-text-muted">
        <Link
          href={`/${workspaceSlug}/projects/${projectSlug}`}
          className="transition-colors duration-120 hover:text-text"
        >
          {project.name}
        </Link>
      </nav>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs font-medium tabular-nums text-text-subtle">
            {item.identifier}
          </span>
          {currentState && (
            <StatePill name={currentState.name} color={currentState.color} />
          )}
          {item.blocked && <Badge tone="danger">{t('workItems.blocked')}</Badge>}
          {overdue && <Badge tone="danger">{t('workItems.overdue')}</Badge>}
          {item.archived && <Badge>{t('projects.archived')}</Badge>}
        </div>

        <h1 className="font-display text-xl font-semibold tracking-tight">{item.title}</h1>
      </header>

      {item.archived && <Alert tone="warning">{t('projects.archivedNotice')}</Alert>}

      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">{t('workItems.state')}</span>
        <StateSelect
          context={{ workspaceSlug, projectSlug, locale }}
          itemLabel={item.identifier}
          workItemId={item.id}
          stateId={item.stateId}
          states={states}
          disabled={!item.canEdit}
        />
      </div>

      <ItemEditor
        context={{ workspaceSlug, projectSlug, projectId: project.id, locale }}
        item={{
          id: item.id,
          number: item.number,
          title: item.title,
          description: item.description,
          priority: item.priority,
          startDate: item.startDate,
          dueDate: item.dueDate,
          estimate: item.estimate,
          blocked: item.blocked,
          blockedReason: item.blockedReason,
          assigneeIds: item.assigneeIds,
          labelIds: item.labelIds,
        }}
        people={members.map((member) => ({
          memberId: member.memberId,
          name: member.name.trim() || member.email,
        }))}
        labels={labels}
        canEdit={item.canEdit}
      />

      {thread && (
        <AttachmentPanel
          files={thread.itemFiles}
          context={itemContext}
          // The same answer the composer gets: a Viewer and an archived project
          // both see the files and no way to add one.
          canUpload={thread.canComment}
        />
      )}

      {thread && (
        <CommentThread
          thread={thread}
          context={itemContext}
          timezone={resolved.workspace.timezone}
          showAllHref={allComments ? null : widen({ comments: 'all' })}
        />
      )}

      {activity && (
        <ActivityFeed
          feed={activity}
          timezone={resolved.workspace.timezone}
          showAllHref={allActivity ? null : widen({ activity: 'all' })}
        />
      )}
    </div>
  );
}
