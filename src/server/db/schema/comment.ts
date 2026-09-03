import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { project } from './project';
import { workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * Comments on a work item (§4, §7.7 — slice 8).
 *
 * Ordinary tenant data, unlike the two tables slice 7 added: a comment is
 * something a person wrote and may delete, not a projection of an event that
 * already happened. So it takes `...tenantPolicies()` — all five — where
 * `activity` and `audit_record` hand-write their own to stay append-only.
 *
 * **The body is text with mention tokens in it, and that is this slice's answer
 * to a question `work_item.description` deferred.** §12's component inventory
 * names Textarea and no editor; a rich-text editor is a dependency, a schema
 * decision (HTML? a document tree?) and a sanitiser, none of which §12
 * specifies. What §7.7 actually requires is mentions, and `src/lib/mentions.ts`
 * provides those without any of it. The column stays `text`, so the richer
 * editor §4 gestures at is a renderer change rather than a migration.
 */
export const comment = pgTable(
  'comment',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /**
     * Denormalized from the item, for the reason `activity.project_id` is:
     * every read of a comment asks §10 a question about its *project*, and a
     * join to find out which project a comment belongs to would be on the path
     * of the permission check itself.
     */
    projectId: uuid('project_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),

    /**
     * The member, not the user. Everything else that records who did something
     * inside a workspace keys on membership, and a comment is not an exception
     * — it also means a composite foreign key can hold the workspace honest,
     * which `user_id` could not.
     */
    authorMemberId: uuid('author_member_id').notNull(),

    body: text('body').notNull(),

    /**
     * Soft delete, and it is doing real work here rather than following a
     * convention. §10 lets a Lead delete somebody else's comment, so a deleted
     * comment is sometimes a moderation act — and a thread that silently closes
     * over the gap reads as though the exchange never happened. The thread
     * renders a tombstone in its place instead, which is why the row survives.
     */
    ...timestamps,
  },
  (t) => [
    /**
     * The thread query, and the only access path this slice has. Ascending:
     * a conversation is read forwards, unlike the feed beside it, and the id
     * breaks ties in insert order because a UUIDv7 does.
     */
    index('comment_item_idx').on(t.workItemId, t.createdAt, t.id),

    /**
     * The target a mention's composite foreign key needs — the same trick
     * `workspace_member` uses, and for the same reason: a mention naming
     * `(comment_id, workspace_id)` can then only match a comment in its own
     * workspace.
     */
    unique('comment_id_workspace_key').on(t.id, t.workspaceId),

    foreignKey({
      name: 'comment_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'comment_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    /**
     * `restrict`, not `cascade`. Offboarding soft-deletes a membership and
     * §7.12 keeps what somebody wrote "preserved and attributed" — a cascade
     * here would delete a departed colleague's half of every conversation they
     * were ever part of.
     */
    foreignKey({
      name: 'comment_author_fk',
      columns: [t.authorMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    ...tenantPolicies(),
  ],
);

/**
 * Who a comment mentions (§7.7).
 *
 * A table rather than a column parsed at read time, because slice 9 asks the
 * opposite question — "what mentions has this person not read" — and answering
 * that by scanning every comment body in the workspace is the shape of query
 * §16 warns about. Written from `parseMentionIds` inside the same transaction
 * as the comment, so the two cannot disagree.
 *
 * Deliberately **not** mirrored into an array column on `comment`, unlike
 * slice 5's `assignee_ids` and `label_ids`. Those exist because the §9 list
 * query filters and groups work items by them; nothing filters a *comment* by
 * its mentions, and a mirror with no reader is a trigger to maintain and a way
 * for two representations to drift.
 */
export const commentMention = pgTable(
  'comment_mention',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').notNull(),
    /** The member who was mentioned. */
    workspaceMemberId: uuid('workspace_member_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Mentioning somebody twice in one comment is one mention (§7.8). */
    unique('comment_mention_key').on(t.commentId, t.workspaceMemberId),

    /** Slice 9's inbox reads this way round: everything that mentions me. */
    index('comment_mention_member_idx').on(t.workspaceMemberId),

    foreignKey({
      name: 'comment_mention_comment_fk',
      columns: [t.commentId, t.workspaceId],
      foreignColumns: [comment.id, comment.workspaceId],
    }).onDelete('cascade'),

    /**
     * `restrict` for the same reason the author link is: a mention is part of
     * what somebody wrote, and it should still read as their name after they
     * leave.
     */
    foreignKey({
      name: 'comment_mention_member_fk',
      columns: [t.workspaceMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    ...tenantPolicies(),
  ],
);
