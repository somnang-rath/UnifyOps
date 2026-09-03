import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can, type Actor } from '@/server/authz/policy';
import type { ProjectRole } from '@/server/authz/roles';
import type { TenantDb } from '@/server/db/client';
import {
  comment,
  commentMention,
  projectMember,
  user,
  workItem,
  workspaceMember,
} from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { fetchComments, type CommentRow } from '@/server/queries/comments';
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
   * Who the `@` picker may offer, already filtered to people who can see this
   * project — so the ordinary path never reaches §7.7's refusal.
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
  /**
   * The files hanging on the *item* rather than on any comment.
   *
   * Carried here for the reason `mentionable` is: it is the same question about
   * the same project, asked inside a transaction that is already open and has
   * already applied §10 to this project. A second service call would be a third
   * `withActor` on every item page render — which is precisely the latency that
   * exposed the e2e race this slice had to fix.
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
): Promise<ProjectRow | null> {
  const rows = await tx
    .select({ projectId: workItem.projectId })
    .from(workItem)
    .where(and(eq(workItem.id, workItemId), isNull(workItem.deletedAt)))
    .limit(1);

  const projectId = rows[0]?.projectId;
  if (!projectId) return null;

  const project = await loadProject(tx, projectId);
  if (!project) return null;

  // Asked here rather than trusted from the caller. RLS has scoped the rows to
  // the workspace; §10 decides whether *this member* may see this project, and
  // a thread is exactly the surface where forgetting that leaks a private
  // project one comment at a time.
  if (!can(actor, 'project.view', projectResource(project))) return null;

  return project;
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
async function visibleMembers(
  tx: TenantDb,
  project: ProjectRow,
  memberIds?: string[],
): Promise<Map<string, { name: string; email: string }>> {
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
      and(
        eq(projectMember.workspaceMemberId, workspaceMember.id),
        eq(projectMember.projectId, project.id),
        isNull(projectMember.deletedAt),
      ),
    )
    .where(
      memberIds
        ? and(inArray(workspaceMember.id, memberIds), isNull(workspaceMember.deletedAt))
        : isNull(workspaceMember.deletedAt),
    );

  const resource = projectResource(project);
  const visible = new Map<string, { name: string; email: string }>();

  for (const row of rows) {
    // A one-project Actor. Everything §10 composes — Owner and Admin as
    // implicit Leads, a workspace-visible project granting Members a Viewer,
    // Guests getting nothing — is derived by the module from exactly this.
    const candidate: Actor = {
      workspaceId: project.workspaceId,
      userId: row.userId,
      workspaceRole: row.role,
      projectRoles: row.projectRole
        ? new Map<string, ProjectRole>([[project.id, row.projectRole]])
        : new Map<string, ProjectRole>(),
      readOnly: false,
    };

    if (can(candidate, 'project.view', resource)) {
      visible.set(row.memberId, { name: row.name, email: row.email });
    }
  }

  return visible;
}

/**
 * Who the `@` picker may offer on this item.
 *
 * Filtered by the same rule that refuses a mention, so the ordinary path never
 * reaches the refusal — §7.7's `[!]` is a backstop, not a workflow.
 */
async function mentionableFor(tx: TenantDb, project: ProjectRow): Promise<MentionablePerson[]> {
  const visible = await visibleMembers(tx, project);

  return [...visible.entries()]
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
): Promise<CommentThreadView | null> {
  return withActor(resolved.context, async (tx) => {
    const project = await loadItemProject(tx, resolved.actor, input.workItemId);
    if (!project) return null;

    const page = await fetchComments(tx, {
      workItemId: input.workItemId,
      limit: input.all ? FULL_LIMIT : DEFAULT_LIMIT,
    });

    const resource = projectResource(project);
    const archived = isArchived(project);
    const allowed = can(resolved.actor, 'comment.create', resource);
    const deleteOthers = can(resolved.actor, 'comment.delete_others', resource);

    const canContribute = !archived && allowed;
    const canDeleteOthers = !archived && deleteOthers;

    // Both file reads ride this same transaction. `page.rows` is already the
    // window being rendered, so the comment-file query is bounded by the page
    // rather than by the length of the conversation.
    const [commentFiles, itemFiles] = await Promise.all([
      attachmentsForComments(tx, {
        commentIds: page.rows.filter((row) => row.deletedAt === null).map((row) => row.id),
        memberId: resolved.memberId,
        canContribute,
        canDeleteOthers,
      }),
      itemAttachmentsFor(tx, {
        workItemId: input.workItemId,
        memberId: resolved.memberId,
        canContribute,
        canDeleteOthers,
      }),
    ]);

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
    const project = await loadItemProject(tx, resolved.actor, input.workItemId);
    if (!project) return { ok: false, problem: 'not_found' } as const;

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
    });

    uow.emit({
      type: 'comment.created',
      workspaceId: resolved.workspace.id,
      projectId: project.id,
      workItemId: input.workItemId,
      commentId,
      mentioned,
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
        projectId: comment.projectId,
        authorMemberId: comment.authorMemberId,
      })
      .from(comment)
      .where(and(eq(comment.id, input.commentId), isNull(comment.deletedAt)))
      .limit(1);

    const found = rows[0];
    if (!found) return { ok: false, problem: 'not_found' } as const;

    const project = await loadProject(tx, found.projectId);
    if (!project) return { ok: false, problem: 'not_found' } as const;
    if (!can(resolved.actor, 'project.view', projectResource(project))) {
      return { ok: false, problem: 'not_found' } as const;
    }
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;

    const byAuthor = found.authorMemberId === resolved.memberId;

    // Retracting your own needs the right to comment; removing somebody else's
    // is the separate §10 row, and the two produce different refusals.
    assertCan(
      resolved.actor,
      byAuthor ? 'comment.create' : 'comment.delete_others',
      projectResource(project),
    );

    await tx
      .update(comment)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comment.id, input.commentId));

    uow.emit({
      type: 'comment.deleted',
      workspaceId: resolved.workspace.id,
      projectId: found.projectId,
      workItemId: found.workItemId,
      commentId: input.commentId,
      byAuthor,
    });

    return { ok: true } as const;
  });
}
