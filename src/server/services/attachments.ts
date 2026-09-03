import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan, can, type Actor } from '@/server/authz/policy';
import type { TenantDb } from '@/server/db/client';
import { attachment, workItem } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import type { UnitOfWork } from '@/server/db/tenant';
import {
  fetchCommentAttachments,
  fetchItemAttachments,
  type AttachmentRow,
} from '@/server/queries/attachments';
import { objectStore, type UploadTicket } from '@/server/storage/store';
import {
  checkAttachment,
  isPreviewable,
  normalizeContentType,
  sanitizeFilename,
  storageKey,
  type AttachmentProblem,
} from '@/lib/attachments';
import { isArchived, loadProject, projectResource, type ProjectRow } from './project-access';

/**
 * Attachments (§7.7, §2.4, §8 — the last third of slice 8).
 *
 * **§8's rule is that no byte passes through the app server**, and every
 * decision here follows from it. The browser sends the file straight to the
 * store, so the only moment this process can refuse an upload is *before* one
 * is authorised — which is why an upload is two steps and not one:
 *
 *   1. `createUploadTicket` asks §10, applies §4's archived rule, validates the
 *      name, size and type, writes a `pending` row, and signs a URL scoped to
 *      that one key with that exact length and type. The store then rejects a
 *      PUT that disagrees with what was approved, so the size limit is enforced
 *      by the thing actually receiving the bytes.
 *   2. The file becomes *visible* — and emits its event — only when something
 *      says the upload finished: `confirmAttachment` for a file on the item, or
 *      `attachToComment` when the comment it was pasted into is posted.
 *
 * A ticket that is never used leaves a `pending` row nothing renders and bytes
 * nothing references. Sweeping those is slice 9's, which is the slice that
 * introduces pg-boss; a periodic job is its right home, and a hand-rolled timer
 * here would be the wrong one.
 *
 * **§10 has no attachment row, and none is invented.** This is the same
 * decision slice 5 made for labels, for the same reason: adding a rule to the
 * code that the table a non-technical owner is shown does not contain makes
 * that table a document nobody can check the product against. An attachment is
 * a contribution to an item's conversation, so it falls under the rows that
 * already govern one — `comment.create` to add a file, and §10's Lead power
 * `comment.delete_others` to remove somebody else's. Both resolve to exactly
 * the rule the matrix states for a member of a project.
 */

/** Identifiers, never sentences (§13). */
export type AttachmentServiceProblem = AttachmentProblem | 'not_found' | 'archived';

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: AttachmentServiceProblem };

/** One file as a screen draws it. */
export type AttachmentView = AttachmentRow & {
  /** True when this actor may remove it — their own, or §10's Lead power. */
  canDelete: boolean;
  /** Whether the page should draw a thumbnail rather than a file row. */
  previewable: boolean;
};

/**
 * The project behind a work item, once the actor may see it.
 *
 * The same shape `comments.ts` uses, and deliberately a copy of three lines
 * rather than a shared export: the two services ask the same question about the
 * same table, but a helper shared between them would be the seam through which
 * one slice's permission change silently altered the other's.
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

  // Asked here rather than trusted from the caller: RLS has scoped the rows to
  // the workspace, and §10 decides whether *this member* may see this project.
  if (!can(actor, 'project.view', projectResource(project))) return null;

  // Carried for `attachment.added`, which hands them to the notify projector.
  return { project, assigneeIds: row.assigneeIds };
}

/**
 * Decorate rows with what this actor may do to them.
 *
 * Exported because the thread renders its comments' files and the item page
 * renders its own, and both owe the same answer to "may I remove this".
 */
export function decorateAttachments(
  rows: AttachmentRow[],
  input: { memberId: string; canContribute: boolean; canDeleteOthers: boolean },
): AttachmentView[] {
  return rows.map((row) => ({
    ...row,
    previewable: isPreviewable(row.contentType),
    canDelete:
      row.uploadedByMemberId === input.memberId ? input.canContribute : input.canDeleteOthers,
  }));
}

/**
 * The files hanging on the item itself.
 *
 * Takes an open transaction rather than opening one, and so does
 * `attachmentsForComments` below. Both are read by `getCommentThread`, which
 * already holds a transaction and already asked §10 about this project — and
 * the item page's transaction count is not an abstract cost: three of them per
 * render is what exposed the e2e race slice 8 had to fix. One question, one
 * project, one transaction.
 */
export async function itemAttachmentsFor(
  tx: TenantDb,
  input: {
    workItemId: string;
    memberId: string;
    canContribute: boolean;
    canDeleteOthers: boolean;
  },
): Promise<AttachmentView[]> {
  return decorateAttachments(await fetchItemAttachments(tx, input), input);
}

/** The same, for the files posted with a page of comments. Used by the thread. */
export async function attachmentsForComments(
  tx: TenantDb,
  input: {
    commentIds: string[];
    memberId: string;
    canContribute: boolean;
    canDeleteOthers: boolean;
  },
): Promise<Record<string, AttachmentView[]>> {
  const grouped = await fetchCommentAttachments(tx, { commentIds: input.commentIds });

  return Object.fromEntries(
    [...grouped.entries()].map(([commentId, rows]) => [
      commentId,
      decorateAttachments(rows, input),
    ]),
  );
}

/**
 * Step one: authorise an upload and sign a URL for it.
 *
 * Everything that can be checked is checked here, because after this the bytes
 * do not come past us. The row is written in the same transaction that signs
 * the URL, so a signed URL always has a row behind it that says who it belongs
 * to, which item, and how big the file was allowed to be.
 */
export async function createUploadTicket(
  resolved: ResolvedActor,
  input: { workItemId: string; filename: string; contentType: string; sizeBytes: number },
): Promise<Ok<{ attachmentId: string; filename: string; upload: UploadTicket }> | Failed> {
  const filename = sanitizeFilename(input.filename);
  const contentType = normalizeContentType(input.contentType);

  // The same function the composer ran in the browser. That one is a courtesy;
  // this one is the enforcement.
  const problem = checkAttachment({ filename, contentType, sizeBytes: input.sizeBytes });
  if (problem) return { ok: false, problem };

  return withActor(resolved.context, async (tx) => {
    const loaded = await loadItemProject(tx, resolved.actor, input.workItemId);
    if (!loaded) return { ok: false, problem: 'not_found' } as const;
    const { project } = loaded;

    // §4: an archived project is read-only for everybody, including its owner.
    // Not a permission, so it is checked separately and reported separately.
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'comment.create', projectResource(project));

    const attachmentId = uuidv7();

    await tx.insert(attachment).values({
      id: attachmentId,
      workspaceId: resolved.workspace.id,
      projectId: project.id,
      workItemId: input.workItemId,
      uploadedByMemberId: resolved.memberId,
      filename,
      contentType,
      sizeBytes: input.sizeBytes,
      // Invisible everywhere until something says the bytes arrived.
      status: 'pending',
    });

    return {
      ok: true,
      attachmentId,
      filename,
      upload: objectStore().signUpload({
        key: storageKey({ workspaceId: resolved.workspace.id, attachmentId }),
        contentType,
        contentLength: input.sizeBytes,
      }),
    } as const;
  });
}

/**
 * The pending row this actor uploaded, inside an open transaction.
 *
 * Scoped to the uploader on purpose. A `pending` row is a half-finished action
 * belonging to one person, and confirming or claiming somebody else's — even
 * with every §10 right over the project — is not a thing any screen asks for.
 */
type PendingRow = {
  id: string;
  projectId: string;
  workItemId: string;
  filename: string;
};

async function claimPending(
  tx: TenantDb,
  input: { attachmentIds: string[]; memberId: string; workItemId: string },
): Promise<PendingRow[]> {
  if (input.attachmentIds.length === 0) return [];

  return tx
    .select({
      id: attachment.id,
      projectId: attachment.projectId,
      workItemId: attachment.workItemId,
      filename: attachment.filename,
    })
    .from(attachment)
    .where(
      and(
        inArray(attachment.id, input.attachmentIds),
        eq(attachment.workItemId, input.workItemId),
        eq(attachment.uploadedByMemberId, input.memberId),
        eq(attachment.status, 'pending'),
        isNull(attachment.deletedAt),
      ),
    );
}

/**
 * Step two, for files dropped on the item itself: the bytes arrived, so they
 * become visible and the feed says so.
 */
export async function confirmAttachment(
  resolved: ResolvedActor,
  input: { workItemId: string; attachmentIds: string[] },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const loaded = await loadItemProject(tx, resolved.actor, input.workItemId);
    if (!loaded) return { ok: false, problem: 'not_found' } as const;
    const { project, assigneeIds } = loaded;
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;
    assertCan(resolved.actor, 'comment.create', projectResource(project));

    // Several at once, because a drop is often several files and confirming
    // them one request at a time would render the panel once per file.
    const rows = await claimPending(tx, {
      attachmentIds: input.attachmentIds,
      memberId: resolved.memberId,
      workItemId: input.workItemId,
    });
    if (rows.length === 0) return { ok: false, problem: 'not_found' } as const;

    await markAttachmentsReady(tx, uow, {
      rows,
      commentId: null,
      workspaceId: resolved.workspace.id,
      assigneeIds,
    });

    return { ok: true } as const;
  });
}

/**
 * Step two, for files pasted into a comment: claim them, then make them
 * visible once the comment they belong to exists.
 *
 * Split into two exports rather than one call, because `postComment` needs the
 * answer to "how many of these are real" *before* it writes anything: a comment
 * with no text is legitimate when it carries a file (§2.4 — a screenshot is
 * often the whole message), and is not legitimate when the ids naming those
 * files turn out to be nobody's. Claiming first means that case is refused with
 * nothing written, rather than rolled back after the fact.
 *
 * Both take the caller's open transaction, which is the point: a comment that
 * committed and then failed to attach its screenshot would be a comment reading
 * "see attached".
 */
export async function claimPendingAttachments(
  tx: TenantDb,
  input: { attachmentIds: string[]; memberId: string; workItemId: string },
): Promise<PendingRow[]> {
  return claimPending(tx, input);
}

/** The one place a pending row becomes a visible file and emits its event. */
export async function markAttachmentsReady(
  tx: TenantDb,
  uow: UnitOfWork,
  input: {
    rows: PendingRow[];
    commentId: string | null;
    workspaceId: string;
    /** The item's assignees, for the notify projector (§7.8). */
    assigneeIds: readonly string[];
  },
): Promise<void> {
  if (input.rows.length === 0) return;

  await tx
    .update(attachment)
    .set({ status: 'ready', commentId: input.commentId, updatedAt: new Date() })
    .where(
      inArray(
        attachment.id,
        input.rows.map((row) => row.id),
      ),
    );

  for (const row of input.rows) {
    uow.emit({
      type: 'attachment.added',
      workspaceId: input.workspaceId,
      projectId: row.projectId,
      workItemId: row.workItemId,
      attachmentId: row.id,
      // What the activity projector branches on: a file inside a comment is
      // already rendered by that comment, an inch above the feed.
      commentId: input.commentId,
      assigneeIds: input.assigneeIds,
      filename: row.filename,
    });
  }
}

/**
 * Remove a file — your own, or somebody else's with §10's Lead power.
 *
 * Soft, and the bytes outlive the row until slice 9's job collects them. A
 * delete that made a network call to Cloudflare inside the transaction would
 * fail whenever Cloudflare had a bad minute, and removing a file somebody
 * should not have posted is the one moment that must not depend on a third
 * party being up.
 */
export async function deleteAttachment(
  resolved: ResolvedActor,
  input: { attachmentId: string },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx, uow) => {
    const rows = await tx
      .select({
        id: attachment.id,
        projectId: attachment.projectId,
        workItemId: attachment.workItemId,
        commentId: attachment.commentId,
        filename: attachment.filename,
        uploadedByMemberId: attachment.uploadedByMemberId,
      })
      .from(attachment)
      .where(and(eq(attachment.id, input.attachmentId), isNull(attachment.deletedAt)))
      .limit(1);

    const found = rows[0];
    if (!found) return { ok: false, problem: 'not_found' } as const;

    const project = await loadProject(tx, found.projectId);
    if (!project) return { ok: false, problem: 'not_found' } as const;
    if (!can(resolved.actor, 'project.view', projectResource(project))) {
      return { ok: false, problem: 'not_found' } as const;
    }
    if (isArchived(project)) return { ok: false, problem: 'archived' } as const;

    const byUploader = found.uploadedByMemberId === resolved.memberId;
    // Retracting your own file needs the right to contribute at all; removing
    // somebody else's is §10's Lead power, and a Guest never has it.
    assertCan(
      resolved.actor,
      byUploader ? 'comment.create' : 'comment.delete_others',
      projectResource(project),
    );

    await tx
      .update(attachment)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(attachment.id, found.id));

    uow.emit({
      type: 'attachment.removed',
      workspaceId: resolved.workspace.id,
      projectId: found.projectId,
      workItemId: found.workItemId,
      attachmentId: found.id,
      commentId: found.commentId,
      filename: found.filename,
      byUploader,
    });

    return { ok: true } as const;
  });
}

/**
 * A short-lived URL that serves one file back.
 *
 * The permission check happens here, once, and the URL it returns is a bearer
 * credential for exactly one object for a few minutes — which is why the route
 * that calls this redirects rather than caching, and why the URL is never
 * stored anywhere.
 */
export async function signAttachmentDownload(
  resolved: ResolvedActor,
  input: { attachmentId: string; disposition: 'inline' | 'attachment' },
): Promise<string | null> {
  return withActor(resolved.context, async (tx) => {
    const rows = await tx
      .select({
        id: attachment.id,
        workspaceId: attachment.workspaceId,
        projectId: attachment.projectId,
        filename: attachment.filename,
        contentType: attachment.contentType,
        status: attachment.status,
      })
      .from(attachment)
      .where(and(eq(attachment.id, input.attachmentId), isNull(attachment.deletedAt)))
      .limit(1);

    const found = rows[0];
    // A pending row has no bytes behind it yet, so it is not a file to serve.
    if (!found || found.status !== 'ready') return null;

    const project = await loadProject(tx, found.projectId);
    if (!project) return null;
    // Reading a file is reading the project it is in. An archived project is
    // read-only, not invisible, so nothing is checked about archiving here.
    if (!can(resolved.actor, 'project.view', projectResource(project))) return null;

    return objectStore().signDownload({
      key: storageKey({ workspaceId: found.workspaceId, attachmentId: found.id }),
      filename: found.filename,
      contentType: found.contentType,
      disposition: input.disposition,
    });
  });
}
