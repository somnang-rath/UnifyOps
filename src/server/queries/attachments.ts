import 'server-only';

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { attachment, user, workspaceMember } from '@/server/db/schema';

/**
 * Reading a work item's files (§7.7, §2.4 — slice 8).
 *
 * Beside `queries/comments.ts` and for the reason written there: the §9 builder
 * exists because the board, the list, My Work and Needs Attention are one
 * question asked with different filters, and "this item's files, oldest first"
 * is not that question.
 *
 * Two readers, one row shape. The item panel wants the files that hang on the
 * item itself; the thread wants the files posted with each comment on the page
 * it is already rendering. Both are the same select with a different predicate,
 * so a change to what an attachment *is* cannot land in one and miss the other.
 */

export type AttachmentRow = {
  id: string;
  createdAt: Date;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Null when it hangs on the item rather than on a comment. */
  commentId: string | null;
  uploadedByMemberId: string;
  uploadedByUserId: string | null;
  /**
   * Null only when the account itself is gone — not when the person left the
   * company. `app_user`'s select policy reaches anyone who has ever been a
   * member here, which is what makes §7.12's "preserved and attributed" true of
   * a file as well as of a comment.
   */
  uploadedByName: string | null;
};

const columns = {
  id: attachment.id,
  createdAt: attachment.createdAt,
  filename: attachment.filename,
  contentType: attachment.contentType,
  sizeBytes: attachment.sizeBytes,
  commentId: attachment.commentId,
  uploadedByMemberId: attachment.uploadedByMemberId,
  uploadedByUserId: workspaceMember.userId,
  uploadedByName: user.name,
};

/**
 * Only files that exist.
 *
 * `ready` excludes an upload that was authorised and then abandoned — a ticket
 * nobody used, or a comment drafted with a file and never posted. Those rows
 * are real and are swept by slice 9's job; until then they are simply not
 * files, and filtering here rather than at each call site is what stops one
 * screen from disagreeing with another about that.
 */
const visible = and(eq(attachment.status, 'ready'), isNull(attachment.deletedAt));

/** The files on the item itself — everything not posted inside a comment. */
export async function fetchItemAttachments(
  tx: TenantDb,
  input: { workItemId: string },
): Promise<AttachmentRow[]> {
  return tx
    .select(columns)
    .from(attachment)
    .leftJoin(workspaceMember, eq(workspaceMember.id, attachment.uploadedByMemberId))
    .leftJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(attachment.workItemId, input.workItemId), isNull(attachment.commentId), visible))
    // Oldest first: a list of files is read as it accumulated, the way the
    // thread beside it is. The id breaks a tie in insert order, being a UUIDv7.
    .orderBy(asc(attachment.createdAt), asc(attachment.id));
}

/**
 * The files posted with a page of comments, in one query rather than one per
 * comment.
 *
 * The thread already knows which comments it is about to render, so this takes
 * their ids: an `IN` over a rendered page is bounded by the page, where a join
 * onto every comment on the item would grow with the conversation.
 */
export async function fetchCommentAttachments(
  tx: TenantDb,
  input: { commentIds: string[] },
): Promise<Map<string, AttachmentRow[]>> {
  const grouped = new Map<string, AttachmentRow[]>();
  if (input.commentIds.length === 0) return grouped;

  const rows = await tx
    .select(columns)
    .from(attachment)
    .leftJoin(workspaceMember, eq(workspaceMember.id, attachment.uploadedByMemberId))
    .leftJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(inArray(attachment.commentId, input.commentIds), visible))
    .orderBy(asc(attachment.createdAt), asc(attachment.id));

  for (const row of rows) {
    // `commentId` is non-null by the predicate above; the narrowing is for the
    // type, not for a case that can occur.
    const key = row.commentId;
    if (!key) continue;
    const existing = grouped.get(key);
    if (existing) existing.push(row);
    else grouped.set(key, [row]);
  }

  return grouped;
}
