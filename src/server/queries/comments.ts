import 'server-only';

import { desc, eq } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { comment, user, workspaceMember } from '@/server/db/schema';

/**
 * Reading one thread — a work item's, or since slice 21 a wiki page's
 * (§7.7, §21.6).
 *
 * Its own module beside `queries/activity.ts`, and not folded into the §9 list
 * query, for the reason written there: that builder exists because the board,
 * the list, My Work and Needs Attention are the same question with different
 * filters. A thread is not that question — one item, in time order, no
 * grouping, no facets — and adding a branch to the hottest builder in the
 * product to serve it would pay for flexibility nothing here wants.
 */

export type CommentRow = {
  id: string;
  createdAt: Date;
  /** Later than `createdAt` only if a future slice adds editing. */
  updatedAt: Date;
  /**
   * Set when the comment was deleted. The row survives and the thread renders
   * a tombstone: §10 lets a Lead delete somebody else's comment, and a thread
   * that silently closes over the gap reads as though the exchange never
   * happened.
   */
  deletedAt: Date | null;
  authorMemberId: string;
  authorUserId: string | null;
  /**
   * Null only when the account itself is gone. Not when the person merely left
   * the company — `app_user`'s select policy reaches anyone who has ever been a
   * member of this workspace, which is what makes §7.12's "preserved and
   * attributed" true of a conversation as well as of a feed.
   */
  authorName: string | null;
  authorImageUrl: string | null;
  /**
   * The stored body, with `@[<member id>]` tokens still in it. Names are
   * resolved by the caller at render time and never live in this string.
   *
   * Empty for a deleted comment: the query does not return text nobody may
   * read. Withholding it here rather than in the component means a future
   * caller cannot forget to.
   */
  body: string;
};

export type CommentThread = {
  /** Oldest first — a conversation reads forwards, though it is fetched backwards. */
  rows: CommentRow[];
  /** True when older comments exist above the window. */
  truncated: boolean;
};

/**
 * Which thread to read (§21.6).
 *
 * A union rather than two optional ids, and §21.15 is why: the risk it names for
 * this slice is "`comment`'s nullable columns are forgotten in a predicate", and
 * its mitigation is that "every query names its subject explicitly". Two
 * optional fields would let a caller pass neither and read every comment in the
 * workspace — the exact shape of that risk. This makes it a compile error.
 */
export type CommentSubjectRef =
  | { kind: 'work_item'; workItemId: string }
  | { kind: 'wiki_page'; wikiPageId: string };

/** The predicate for one subject, and the only place either column is named. */
function subjectPredicate(subject: CommentSubjectRef) {
  switch (subject.kind) {
    case 'work_item':
      return eq(comment.workItemId, subject.workItemId);
    case 'wiki_page':
      return eq(comment.wikiPageId, subject.wikiPageId);
  }
}

/**
 * The most recent `limit` comments, returned oldest-first.
 *
 * Fetched newest-first — the end of a conversation is the end anybody needs and
 * the end the index serves — then reversed. Truncating from the *top* would
 * hide what was just said, which is the one thing a thread must never do.
 *
 * `created_at` is transaction start and could in principle tie, so `id` breaks
 * it; a UUIDv7 breaks it in insert order rather than at random. The same
 * reasoning as the activity feed, and the same index shape.
 */
export async function fetchComments(
  tx: TenantDb,
  input: { subject: CommentSubjectRef; limit: number },
): Promise<CommentThread> {
  const rows = await tx
    .select({
      id: comment.id,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      deletedAt: comment.deletedAt,
      body: comment.body,
      authorMemberId: comment.authorMemberId,
      authorUserId: workspaceMember.userId,
      authorName: user.name,
      authorImageUrl: user.imageUrl,
    })
    .from(comment)
    .leftJoin(workspaceMember, eq(workspaceMember.id, comment.authorMemberId))
    .leftJoin(user, eq(user.id, workspaceMember.userId))
    .where(subjectPredicate(input.subject))
    .orderBy(desc(comment.createdAt), desc(comment.id))
    // One more than asked for, so "is there anything older" is answered without
    // a second count over a table that only grows.
    .limit(input.limit + 1);

  const truncated = rows.length > input.limit;
  const page = truncated ? rows.slice(0, input.limit) : rows;

  return {
    rows: page
      .map((row) => ({
        ...row,
        // A deleted comment keeps its place and its author and loses its text.
        body: row.deletedAt === null ? row.body : '',
      }))
      .reverse(),
    truncated,
  };
}
