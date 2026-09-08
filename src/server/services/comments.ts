import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can, ForbiddenError, type Actor } from '@/server/authz/policy';
import type { ProjectRole } from '@/server/authz/roles';
import type { TenantDb } from '@/server/db/client';
import {
  comment,
  commentMention,
  projectMember,
  user,
  wikiPage,
  workItem,
  workspaceMember,
} from '@/server/db/schema';
import { inSequence } from '@/server/db/sequence';
import { withActor } from '@/server/db/tenant';
import type { CommentSubject } from '@/server/events/types';
import { fetchComments, type CommentRow } from '@/server/queries/comments';
import {
  canCommentInSpace,
  canModerateSpace,
  canReadSpace,
  checkSpaceComment,
  resolvePageSpace,
  type SpaceContext,
} from './space-access';
import {
  attachmentsForComments,
  claimPendingAttachments,
  itemAttachmentsFor,
  markAttachmentsReady,
  type AttachmentView,
} from './attachments';
import { normalizeBody, parseMentionIds } from '@/lib/mentions';
import { isArchived, loadProject, projectResource, type ProjectRow } from './project-access';

/**
 * Comments and the mentions in them (§7.7 — slice 8).
 *
 * Three rules shape everything below, and each one is a sentence from the plan:
 *
 *   * **A mention is a member id, resolved at render.** `src/lib/mentions.ts`
 *     holds the parse, and it is in `lib` because the composer runs it in the
 *     browser as somebody types and this module runs it again on submit. The
 *     names never enter the stored body (§13).
 *
 *   * **Mentioning somebody who cannot see the project is refused, and the
 *     refusal names them.** §7.7 offers two responses — add them, or block with
 *     a clear reason — and this is the second. The picker only offers people
 *     who can already see the project, so this path is a backstop against a
 *     hand-typed token and against a membership that changed while the composer
 *     was open, not the ordinary case.
 *
 *   * **The question "can they see it" is asked of the policy module**, about
 *     the mentioned member rather than about the actor. Re-deriving project
 *     visibility here would be a second implementation of §10's composition
 *     rules, and the two would drift the first time Guest handling changed.
 */

/**
 * Roughly four screens of text. Long enough for a real explanation, short
 * enough that a pasted log file is refused rather than stored. Counted in code
 * points, not UTF-16 units, so a Khmer comment is not cut off earlier than an
 * English one that reads as the same length.
 */
const MAX_BODY = 10_000;

/** The thread shown by default. */
const DEFAULT_LIMIT = 100;

/** What `?comments=all` widens to — the same bounded widening the feed gets. */
const FULL_LIMIT = 500;

/** Identifiers, not sentences (§13). */
export type CommentProblem =
  | 'not_found'
  | 'archived'
  | 'body_required'
  | 'body_too_long'
  | 'mention_not_visible';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: CommentProblem; names?: string[] };

/** One person a comment can mention, as the picker draws them. */
export type MentionablePerson = {
  memberId: string;
  name: string;
};

export type CommentEntry = CommentRow & {
  /** True when this actor may remove it — their own, or §10's Lead power. */
  canDelete: boolean;
  /** The files posted with it. Empty for most comments. */
  files: AttachmentView[];
};

export type CommentThreadView = {
  entries: CommentEntry[];
  /** Older comments exist above the window. The page offers to widen it. */
  truncated: boolean;
  /** Every member id any body mentions, resolved to a current name. */
  mentioned: Record<string, string>;
  /** Whether this actor may post at all — §10, plus §4's archived rule. */
  canComment: boolean;
  /**
   * Who the `@` picker may offer, already filtered to people who may read the
   * subject — so the ordinary path never reaches §7.7's refusal. For an item
   * that is "can see the project"; for a page it is "can read the space"
   * (§20.5, §21.6).
   *
   * Part of the thread rather than its own call, because it is the same
   * question about the same project and separating them cost a second
   * `withActor` transaction on every item page view. Empty when the actor
   * cannot comment: there is no picker to fill.
   */
  mentionable: MentionablePerson[];
  /**
   * Why not, when they may not.
   *
   * Two values rather than one boolean because they ask the person to do
   * different things: an archived project can be unarchived in one click by
   * somebody, and a missing role cannot. The same reason `project-access.ts`
   * keeps "archived" and "forbidden" apart at the top of every mutation.
   */
  cannotCommentReason: 'archived' | 'forbidden' | null;
};

/**
 * An item's thread, which is a thread plus the one thing only an item has.
 *
 * **Split from `CommentThreadView` in slice 21 rather than making `itemFiles`
 * optional**, because `CommentThread` — the component both subjects render
 * through — genuinely does not read it: the item page draws the item's own files
 * in their own panel. An optional field would have compiled either way and left
 * the component free to reach for something a page can never supply.
 */
export type ItemCommentThreadView = CommentThreadView & {
  /**
   * The files hanging on the *item* rather than on any comment.
   *
   * Carried here for the reason `mentionable` is: it is the same question about
   * the same project, asked inside a transaction that is already open and has
   * already applied §10 to this project. A second service call would be a third
   * `withActor` on every item page render — which is precisely the latency that
   * exposed the e2e race slice 8 had to fix.
   */
  itemFiles: AttachmentView[];
};

/**
 * The project behind a work item, once the actor is allowed to see it.
 *
 * Null covers "no such item", "deleted" and "in a project you cannot see"
 * alike. One 404 for all three, as everywhere else, because telling them apart
 * says what exists.
 */
async function loadItemProject(
  tx: TenantDb,
  actor: Actor,
  workItemId: string,
): Promise<{ project: ProjectRow; assigneeIds: string[] } | null> {
  const rows = await tx
    .select({ projectId: workItem.projectId, assigneeIds: workItem.assigneeIds })
    .from(workItem)
    .where(and(eq(workItem.id, workItemId), isNull(workItem.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const project = await loadProject(tx, row.projectId);
  if (!project) return null;

  // Asked here rather than trusted from the caller. RLS has scoped the rows to
  // the workspace; §10 decides whether *this member* may see this project, and
  // a thread is exactly the surface where forgetting that leaks a private
  // project one comment at a time.
  if (!can(actor, 'project.view', projectResource(project))) return null;

  // The assignees ride along because `comment.created` and `attachment.added`
  // both carry them to the registry's notify projector (§7.8), and this is
  // already the query that has the item row open.
  return { project, assigneeIds: row.assigneeIds };
}

/**
 * The members who can see this project, as §10 answers it for each of them.
 *
 * One query and then the policy module, member by member. The alternative — a
 * SQL predicate expressing visibility — is what `listProjects` does, and it is
 * right there because it filters hundreds of projects. Here the set is one
 * workspace's members, and the composition rules are subtle enough (implicit
 * Viewer, Guests getting nothing) that one implementation is worth more than
 * the round trip saved.
 */
async function membersPassing(
  tx: TenantDb,
  input: {
    workspaceId: string;
    /** The project whose explicit memberships a candidate Actor carries, if any. */
    projectId: string | null;
    allows: (actor: Actor) => boolean;
    memberIds?: string[];
  },
): Promise<Map<string, { name: string; email: string }>> {
  const { memberIds, projectId } = input;
  if (memberIds && memberIds.length === 0) return new Map();

  const rows = await tx
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      name: user.name,
      email: user.email,
      projectRole: projectMember.role,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .leftJoin(
      projectMember,
      projectId === null
        ? // No project to join against: the company space asks a workspace-wide
          // question (§20.5). A false join condition rather than a second query
          // shape, so `projectRole` is simply always null on that branch and the
          // loop below stays one loop.
          sql`false`
        : and(
            eq(projectMember.workspaceMemberId, workspaceMember.id),
            eq(projectMember.projectId, projectId),
            isNull(projectMember.deletedAt),
          ),
    )
    .where(
      memberIds
        ? and(inArray(workspaceMember.id, memberIds), isNull(workspaceMember.deletedAt))
        : isNull(workspaceMember.deletedAt),
    );

  const passing = new Map<string, { name: string; email: string }>();

  for (const row of rows) {
    // A candidate Actor. Everything §10 composes — Owner and Admin as implicit
    // Leads, a workspace-visible project granting Members a Viewer, Guests
    // getting nothing — is derived by the module from exactly this.
    //
    // `readOnly: false` throughout, and that is not an oversight. The question
    // is what *this other person* may see, and whether the actor running the
    // query happens to be in a view-as session says nothing about it. The
    // actor's own read-only refusal is applied where they act, not here.
    const candidate: Actor = {
      workspaceId: input.workspaceId,
      userId: row.userId,
      workspaceRole: row.role,
      projectRoles:
        projectId !== null && row.projectRole
          ? new Map<string, ProjectRole>([[projectId, row.projectRole]])
          : new Map<string, ProjectRole>(),
      readOnly: false,
    };

    if (input.allows(candidate)) {
      passing.set(row.memberId, { name: row.name, email: row.email });
    }
  }

  return passing;
}

/** The members who can see this project — `membersPassing` under §10's read row. */
async function visibleMembers(
  tx: TenantDb,
  project: ProjectRow,
  memberIds?: string[],
): Promise<Map<string, { name: string; email: string }>> {
  const resource = projectResource(project);
  return membersPassing(tx, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    allows: (candidate) => can(candidate, 'project.view', resource),
    memberIds,
  });
}

/**
 * The members who can read this **space** (§20.5, §21.6).
 *
 * The mention rule for a page thread, and it is `canReadSpace` rather than
 * `canWriteSpace` deliberately: §21.6 gives commenting to every reader, so a
 * picker that could not offer somebody who is allowed to reply would be narrower
 * than the feature it serves. For a project space this resolves to exactly
 * `visibleMembers` above; for the company space it is every non-Guest member,
 * which is a sentence `canReadSpace` already owns and this does not restate.
 */
async function spaceReaders(
  tx: TenantDb,
  context: SpaceContext,
  memberIds?: string[],
): Promise<Map<string, { name: string; email: string }>> {
  return membersPassing(tx, {
    workspaceId: context.space.workspaceId,
    projectId: context.project?.id ?? null,
    allows: (candidate) => canReadSpace(candidate, context),
    memberIds,
  });
}

/**
 * Who the `@` picker may offer on this item.
 *
 * Filtered by the same rule that refuses a mention, so the ordinary path never
 * reaches the refusal — §7.7's `[!]` is a backstop, not a workflow.
 */
async function mentionableFor(tx: TenantDb, project: ProjectRow): Promise<MentionablePerson[]> {
  return toMentionable(await visibleMembers(tx, project));
}

/**
 * A resolved member set as the picker draws it.
 *
 * Split out in slice 21 because the two subjects resolve *different sets* by
 * different rules and then present them identically — so the presentation is
 * the half that should have one implementation.
 */
function toMentionable(people: Map<string, { name: string; email: string }>): MentionablePerson[] {
  return [...people.entries()]
    .map(([memberId, person]) => ({
      memberId,
      // The address is the fallback identity everywhere else in the product,
      // for an invited account that has not set a name yet.
      name: person.name.trim() || person.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every member id mentioned across a page of comments, resolved to a name. */
async function hydrateMentions(tx: TenantDb, rows: CommentRow[]): Promise<Record<string, string>> {
  const ids = [...new Set(rows.flatMap((row) => parseMentionIds(row.body)))];
  if (ids.length === 0) return {};

  // No `deleted_at` filter on the membership: §7.12 keeps what somebody wrote
  // attributed, and a mention of a colleague who has since left should still
  // read as their name rather than as a uuid.
  const people = await tx
    .select({ memberId: workspaceMember.id, name: user.name, email: user.email })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(inArray(workspaceMember.id, ids));

  return Object.fromEntries(
    people.map((person) => [person.memberId, person.name.trim() || person.email]),
  );
}

/** One item's thread, or null when the item is not visible to this actor. */
export async function getCommentThread(
  resolved: ResolvedActor,
  input: { workItemId: string; all?: boolean },
): Promise<ItemCommentThreadView | null> {
  return withActor(resolved.context, async (tx) => {
    const loaded = await loadItemProject(tx, resolved.actor, input.workItemId);
    if (!loaded) return null;
    const { project } = loaded;

    const page = await fetchComments(tx, {
      subject: { kind: 'work_item', workItemId: input.workItemId },
      limit: input.all ? FULL_LIMIT : DEFAULT_LIMIT,
    });

    const resource = projectResource(project);
    const archived = isArchived(project);
    const allowed = can(resolved.actor, 'comment.create', resource);
    const deleteOthers = can(resolved.actor, 'comment.delete_others', resource);

    const canContribute = !archived && allowed;
    const canDeleteOthers = !archived && deleteOthers;

    // Both file reads ride this same transaction, and so go out one after the
    // other (`inSequence`). `page.rows` is already the window being rendered, so
    // the comment-file query is bounded by the page rather than by the length of
    // the conversation.
    const [commentFiles, itemFiles] = await inSequence(
      () =>
        attachmentsForComments(tx, {
          commentIds: page.rows.filter((row) => row.deletedAt === null).map((row) => row.id),
          memberId: resolved.memberId,
          canContribute,
          canDeleteOthers,
        }),
      () =>
        itemAttachmentsFor(tx, {
          workItemId: input.workItemId,
          memberId: resolved.memberId,
          canContribute,
          canDeleteOthers,
        }),
    );

    return {
      entries: page.rows.map((row) => ({
        ...row,
        canDelete:
          row.deletedAt === null &&
          !archived &&
          // Retracting your own comment needs the right to comment at all, not
          // the Lead power that removing somebody else's does.
          (row.authorMemberId === resolved.memberId ? allowed : deleteOthers),
        // A deleted comment shows a tombstone and none of its files. The row
        // filter above is what makes that true rather than the component.
        files: commentFiles[row.id] ?? [],
      })),
      itemFiles,
      truncated: page.truncated,
      mentioned: await hydrateMentions(tx, page.rows),
      canComment: canContribute,
      cannotCommentReason: archived ? 'archived' : allowed ? null : 'forbidden',
      // Skipped entirely when there is no composer to fill, which is the common
      // case for a Viewer and for every archived project.
      mentionable: canContribute ? await mentionableFor(tx, project) : [],
    };
  });
}

/**
 * Post a comment (§7.7).
 *
 * The comment and its mention rows are written in one transaction from one
 * parse of one body, so the two can never disagree about who was mentioned.
 */
export async function postComment(
  resolved: ResolvedActor,
  input: { workItemId: string; body: string; attachmentIds?: string[] },
): Promise<Ok<{ commentId: string }> | Failed> {
  const body = normalizeBody(input.body);
  const attachmentIds = input.attachmentIds ?? [];

  // A comment with no words is legitimate when it carries a file — §2.4 calls
  // paste-to-upload "the most-used collaboration action in practice", and a
  // screenshot is often the whole message. It is not legitimate when there is
  // neither, which is what the claim below turns into a refusal.
  if (!body && attachmentIds.length === 0) return { ok: false, problem: 'body_required' };
  if ([...body].length > MAX_BODY) return { ok: false, problem: 'body_too_long' };

  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await loadItemProject(tx, resolved.actor, input.workItemId);
    if (!loaded) return { ok: false, problem: 'not_found' } as const;
    const { project, assigneeIds } = loaded;

    // §4: an archived project is read-only — "no new items, no edits, no state
    // changes, no comments". Not a permission, so it is checked separately and
    // reported with its own sentence.
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'comment.create', projectResource(project));

    const mentioned = parseMentionIds(body);

    if (mentioned.length > 0) {
      const visible = await visibleMembers(tx, project, mentioned);
      const refused = mentioned.filter((id) => !visible.has(id));

      if (refused.length > 0) {
        // The names of the people who *are* resolvable, so the screen can say
        // who it means. An id that resolves to nobody at all — a hand-typed
        // token — contributes no name, and the message degrades to the count.
        const names = await tx
          .select({ name: user.name, email: user.email })
          .from(workspaceMember)
          .innerJoin(user, eq(user.id, workspaceMember.userId))
          .where(inArray(workspaceMember.id, refused));

        return {
          ok: false,
          problem: 'mention_not_visible',
          names: names.map((person) => person.name.trim() || person.email),
        } as const;
      }
    }

    /**
     * Claimed *before* the comment is written, so an empty body whose files
     * turn out to be nobody's is refused with nothing committed rather than
     * rolled back. `claimPendingAttachments` is scoped to this actor, this
     * item and rows still pending — so a crafted id naming somebody else's
     * upload simply does not come back.
     */
    const files = await claimPendingAttachments(tx, {
      attachmentIds,
      memberId: resolved.memberId,
      workItemId: input.workItemId,
    });

    if (!body && files.length === 0) return { ok: false, problem: 'body_required' } as const;

    const commentId = uuidv7();

    await tx.insert(comment).values({
      id: commentId,
      workspaceId: resolved.workspace.id,
      projectId: project.id,
      workItemId: input.workItemId,
      // Named explicitly rather than left to the column default, which is
      // §21.15's mitigation written into the one insert it protects: this table
      // has two possible subjects now and 0038's CHECK refuses a row claiming
      // both. Saying `null` here is how the next person to read this insert
      // learns that the other column exists.
      wikiPageId: null,
      authorMemberId: resolved.memberId,
      body,
    });

    if (mentioned.length > 0) {
      await tx.insert(commentMention).values(
        mentioned.map((memberId) => ({
          workspaceId: resolved.workspace.id,
          commentId,
          workspaceMemberId: memberId,
        })),
      );
    }

    // After the comment exists, because the row they are being linked to has to.
    // Emits one `attachment.added` per file, each carrying this comment id —
    // which is what tells the activity projector to stay quiet about them.
    await markAttachmentsReady(tx, uow, {
      rows: files,
      commentId,
      workspaceId: resolved.workspace.id,
      assigneeIds,
    });

    uow.emit({
      type: 'comment.created',
      workspaceId: resolved.workspace.id,
      subject: { kind: 'work_item', projectId: project.id, workItemId: input.workItemId },
      commentId,
      mentioned,
      // An item's standing interest is its assignees, which is §7.8's rule
      // unchanged — only the field's name generalised, because a page's is not.
      subscriberIds: assigneeIds,
    });

    return { ok: true, commentId } as const;
  });
}

/**
 * Delete a comment — your own, or somebody else's with §10's Lead power.
 *
 * Soft, so the thread can render a tombstone. A conversation that silently
 * closes over a removed comment reads as though the exchange never happened,
 * which is the opposite of what a moderation power should leave behind.
 */
export async function deleteComment(
  resolved: ResolvedActor,
  input: { commentId: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({
        id: comment.id,
        workItemId: comment.workItemId,
        wikiPageId: comment.wikiPageId,
        projectId: comment.projectId,
        authorMemberId: comment.authorMemberId,
      })
      .from(comment)
      .where(and(eq(comment.id, input.commentId), isNull(comment.deletedAt)))
      .limit(1);

    const found = rows[0];
    if (!found) return { ok: false, problem: 'not_found' } as const;

    const byAuthor = found.authorMemberId === resolved.memberId;

    /**
     * Which subject this comment is on, and therefore which permission question
     * to ask (§21.6).
     *
     * The narrowing is done by *testing the columns* rather than by asserting
     * them, for the reason `claimPending` gives in `attachments.ts`: a `!` would
     * keep compiling if 0038's CHECK were ever relaxed, and a row that satisfies
     * neither branch should read as "no such comment" rather than as a crash in
     * a delete. `comment_one_subject` means the third case cannot happen; this
     * is what the product does on the day it does.
     */
    const subject: CommentSubject | null =
      found.workItemId !== null && found.projectId !== null
        ? { kind: 'work_item', projectId: found.projectId, workItemId: found.workItemId }
        : found.wikiPageId !== null
          ? { kind: 'wiki_page', wikiPageId: found.wikiPageId }
          : null;

    if (subject === null) return { ok: false, problem: 'not_found' } as const;

    if (subject.kind === 'work_item') {
      const project = await loadProject(tx, subject.projectId);
      if (!project) return { ok: false, problem: 'not_found' } as const;
      if (!can(resolved.actor, 'project.view', projectResource(project))) {
        return { ok: false, problem: 'not_found' } as const;
      }
      if (isArchived(project)) return { ok: false, problem: 'archived' } as const;

      // Retracting your own needs the right to comment; removing somebody else's
      // is the separate §10 row, and the two produce different refusals.
      assertCan(
        resolved.actor,
        byAuthor ? 'comment.create' : 'comment.delete_others',
        projectResource(project),
      );
    } else {
      /**
       * The page branch, and the same two questions asked of the space (§20.5).
       *
       * `checkSpaceComment` covers the reader, the archived project behind a
       * project space and the view-as session in one call — the last of which is
       * why retracting your own comment cannot simply skip the check. Removing
       * somebody else's is `canModerateSpace`, which resolves to
       * `comment.delete_others` for a project space and to
       * `wiki.write_company_space` for the one container that has no project to
       * ask about. No new §10 row either way.
       */
      const context = await resolvePageSpace(tx, subject.wikiPageId);
      if (!context) return { ok: false, problem: 'not_found' } as const;

      const problem = checkSpaceComment(resolved.actor, context);
      if (problem === 'not_found') return { ok: false, problem: 'not_found' } as const;
      if (problem === 'archived') return { ok: false, problem: 'archived' } as const;

      const allowed = byAuthor
        ? canCommentInSpace(resolved.actor, context)
        : canModerateSpace(resolved.actor, context);
      if (!allowed) throw new ForbiddenError('comment.delete_others', 'insufficient_role');
    }

    await tx
      .update(comment)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comment.id, input.commentId));

    uow.emit({
      type: 'comment.deleted',
      workspaceId: resolved.workspace.id,
      subject,
      commentId: input.commentId,
      byAuthor,
    });

    return { ok: true } as const;
  });
}

/* ------------------------------------------------------------------------- *
 * The page thread (§21.6 — slice 21)
 * ------------------------------------------------------------------------- */

/**
 * One page's thread, inside a transaction the caller already opened.
 *
 * **The `In` suffix is slice 14's move**, taken here for the reason it was taken
 * there and in slice 17: `getPage` already has a `withActor` open and has already
 * resolved this page's space, so a service of its own would be a second pooled
 * connection and a second resolution of the same permission on every wiki page
 * view. §20.12 states the rule; five earlier slices each learned it separately.
 *
 * The `SpaceContext` is taken rather than looked up, for the same reason: the
 * caller resolved it to decide whether to render the page at all, and asking
 * again would be asking §20.5 twice about one request.
 */
export async function pageCommentThreadIn(
  tx: TenantDb,
  resolved: ResolvedActor,
  input: { pageId: string; context: SpaceContext; all?: boolean },
): Promise<CommentThreadView> {
  const page = await fetchComments(tx, {
    subject: { kind: 'wiki_page', wikiPageId: input.pageId },
    limit: input.all ? FULL_LIMIT : DEFAULT_LIMIT,
  });

  const problem = checkSpaceComment(resolved.actor, input.context);
  const canComment = problem === null;
  const canModerate = canModerateSpace(resolved.actor, input.context);

  return {
    entries: page.rows.map((row) => ({
      ...row,
      canDelete:
        row.deletedAt === null &&
        (row.authorMemberId === resolved.memberId ? canComment : canModerate),
      /**
       * Always empty, and named rather than hidden.
       *
       * §21.6 lists "attachments in a comment" among what comes free, and it does
       * not come free here: `createUploadTicket` takes a `workItemId` and has no
       * page branch, so there is no way to *create* the `pending` row a page
       * comment's file would claim. That is a **slice-18 gap** rather than this
       * slice's — §20.9 landed the schema (`attachment.wiki_page_id`, the
       * download path, the sweeper) and never landed the ticket, so a page cannot
       * hold an image either. Closing it means widening the ticket, the route and
       * 0032's `attachment_comment_with_item` CHECK, which is a slice about page
       * *files* rather than one about page *comments*.
       */
      files: [],
    })),
    truncated: page.truncated,
    mentioned: await hydrateMentions(tx, page.rows),
    canComment,
    cannotCommentReason: problem === 'archived' ? 'archived' : canComment ? null : 'forbidden',
    // Skipped when there is no composer to fill, exactly as the item thread
    // skips it: on the company space this is a query over every member of the
    // workspace, and a reader who cannot post discards the result.
    mentionable: canComment ? toMentionable(await spaceReaders(tx, input.context)) : [],
  };
}

/**
 * The people with a standing interest in a page's thread (§7.8, §21.6).
 *
 * A page has no assignees, so §7.8's "every assignee except the actor" has to be
 * answered with the two things a page does have: **its owner** (§21.3 — the
 * person answerable for whether it is still true, and the one §21.13's outcome
 * names) and **everybody who has already written in the thread**.
 *
 * The second half is what makes this a conversation rather than a suggestion
 * box. §21.13 asks for a question asked *and answered*, and without it the person
 * who asked only ever hears back if the answerer remembers to type their name —
 * which is the failure mode of every comment box that does not do this.
 *
 * Authors of *deleted* comments are included, deliberately: somebody who
 * retracted a badly-worded question is still in the conversation they started.
 * The actor is not filtered here — `UnitOfWork.flush` is the one layer that knows
 * who that is, and slice 9 put "never notify yourself" there precisely so thirty
 * registry entries would not each have to remember it.
 */
async function pageSubscribers(tx: TenantDb, pageId: string): Promise<string[]> {
  const [owner, participants] = await inSequence(
    () =>
      tx
        .select({ ownerMemberId: wikiPage.ownerMemberId })
        .from(wikiPage)
        .where(eq(wikiPage.id, pageId))
        .limit(1),
    () =>
      tx
        .selectDistinct({ authorMemberId: comment.authorMemberId })
        .from(comment)
        .where(eq(comment.wikiPageId, pageId)),
  );

  const ownerMemberId = owner[0]?.ownerMemberId ?? null;

  return [
    ...new Set([
      ...(ownerMemberId === null ? [] : [ownerMemberId]),
      ...participants.map((row) => row.authorMemberId),
    ]),
  ];
}

/**
 * Post a comment on a page (§21.6).
 *
 * `postComment`'s shape with three things different, and each is a §20.5
 * consequence rather than a choice made here: the permission question is asked of
 * the *space*, the mention rule is "can read the space" rather than "can see the
 * project", and there are no attachments to claim.
 *
 * **No `assertCan`, because there is no action to assert.** §21.6 gives
 * commenting to every reader and adds no §10 row for it, so `checkSpaceComment`
 * is the whole check — including the view-as refusal that `can()` supplies for
 * free everywhere else.
 */
export async function postPageComment(
  resolved: ResolvedActor,
  input: { pageId: string; body: string },
): Promise<Ok<{ commentId: string }> | Failed> {
  const body = normalizeBody(input.body);

  // No file can carry a wordless page comment yet, so an empty body is simply
  // empty here — unlike the item path, where §2.4's pasted screenshot makes one
  // legitimate.
  if (!body) return { ok: false, problem: 'body_required' };
  if ([...body].length > MAX_BODY) return { ok: false, problem: 'body_too_long' };

  return withActor(resolved.context, async (tx, uow) => {
    const context = await resolvePageSpace(tx, input.pageId);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const problem = checkSpaceComment(resolved.actor, context);
    if (problem === 'not_found') return { ok: false, problem: 'not_found' } as const;
    if (problem === 'archived') return { ok: false, problem: 'archived' } as const;
    if (problem === 'forbidden') {
      // Thrown rather than returned, so it reaches the same `ForbiddenError`
      // branch every other refused mutation in the wiki does. The action named
      // is the nearest true one: a reader who may not comment here is a reader
      // who may not write here either.
      throw new ForbiddenError('wiki.write_project_space', 'insufficient_role');
    }

    const mentioned = parseMentionIds(body);

    if (mentioned.length > 0) {
      const readers = await spaceReaders(tx, context, mentioned);
      const refused = mentioned.filter((id) => !readers.has(id));

      if (refused.length > 0) {
        // The names of the people who *are* resolvable, so the screen can say who
        // it means. A hand-typed token resolving to nobody contributes no name
        // and the message degrades to the count — §7.7's rule, unchanged.
        const names = await tx
          .select({ name: user.name, email: user.email })
          .from(workspaceMember)
          .innerJoin(user, eq(user.id, workspaceMember.userId))
          .where(inArray(workspaceMember.id, refused));

        return {
          ok: false,
          problem: 'mention_not_visible',
          names: names.map((person) => person.name.trim() || person.email),
        } as const;
      }
    }

    // Read *before* the insert, so the author of this comment is not put in
    // their own subscriber list by way of the thread they are joining. `flush`
    // would drop them anyway; asking first means the list says what it means.
    const subscriberIds = await pageSubscribers(tx, input.pageId);

    const commentId = uuidv7();

    await tx.insert(comment).values({
      id: commentId,
      workspaceId: resolved.workspace.id,
      // Both null, and 0038's `comment_project_with_item` is what makes that the
      // only correct pair: a page's permission question is asked of its space,
      // and a page in the company space has no project to denormalize.
      projectId: null,
      workItemId: null,
      wikiPageId: input.pageId,
      authorMemberId: resolved.memberId,
      body,
    });

    if (mentioned.length > 0) {
      await tx.insert(commentMention).values(
        mentioned.map((memberId) => ({
          workspaceId: resolved.workspace.id,
          commentId,
          workspaceMemberId: memberId,
        })),
      );
    }

    uow.emit({
      type: 'comment.created',
      workspaceId: resolved.workspace.id,
      subject: { kind: 'wiki_page', wikiPageId: input.pageId },
      commentId,
      mentioned,
      subscriberIds,
    });

    return { ok: true, commentId } as const;
  });
}
