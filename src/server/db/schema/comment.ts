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
import { wikiPage } from './wiki';
import { workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * Comments on a work item, or — since slice 21 — on a wiki page (§4, §7.7,
 * §21.6).
 *
 * **One table, two possible subjects**, which is the move §20.9 already made
 * for `attachment` and §20.6 for `notification`. §21.6 answers §20.16's first
 * open question by pointing at that shape: "`NotifySubject` is a union
 * precisely so that a notification can be about something that is not a work
 * item, and §20.16-4 asked that it stay one." Everything a page thread needs
 * already exists here — mentions, the tombstone, the author link that survives
 * offboarding, §10's two comment rows — and a second table would be a second
 * implementation of every one of them.
 *
 * **Loosening two NOT NULLs on the second-busiest table in the schema is the
 * cost, and the CHECK is what pays it back** (§21.6). `comment_one_subject` in
 * 0038 refuses more than the two NOT NULLs did, because it also refuses a row
 * belonging to both — the same argument 0032 made when `attachment` widened.
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
     *
     * **Nullable since slice 21**, and null exactly when this comment hangs on
     * a wiki page. A page's permission question is asked of its *space* (§20.5)
     * and a page in the company space has no project to denormalize, so a
     * page-owned row carrying one would be a row inviting the wrong check.
     * 0038's `comment_project_with_item` pins the correspondence rather than
     * leaving it to whoever writes the next insert — 0032's constraint for
     * `attachment.project_id`, applied to the same shape of problem.
     */
    projectId: uuid('project_id'),

    /** The item this comment hangs on, or null when it belongs to a page. */
    workItemId: uuid('work_item_id'),

    /**
     * The wiki page this comment hangs on, or null when it belongs to an item.
     *
     * **Who may write one is the one thing §21.6 says is genuinely new**, and it
     * is resolved in `space-access.ts` rather than here: "anyone who can read
     * the space may comment in it, which for a project space includes a Guest
     * who can see the project — deliberately, because the whole value of a
     * comment on documentation comes from the person who found it wrong, and
     * that is disproportionately the newest person in the room." Writing the
     * page itself stays capped at §20.5's two rows.
     */
    wikiPageId: uuid('wiki_page_id'),

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
     * The same access path for the other subject. Two indexes rather than one
     * over a coalesced expression, because the two columns are read by two
     * queries that each name their subject explicitly — which is §21.15's
     * mitigation for the risk these nullable columns create.
     */
    index('comment_page_idx').on(t.wikiPageId, t.createdAt, t.id),

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
     * `cascade`, matching the item link above rather than `wiki_page_ref`'s
     * rule: a page's *soft* delete leaves its thread intact behind §20.3.6's
     * 30-day window, and only a hard delete reaches this constraint — at which
     * point a conversation about a page that no longer exists is a thread
     * nobody can open.
     */
    foreignKey({
      name: 'comment_page_fk',
      columns: [t.wikiPageId, t.workspaceId],
      foreignColumns: [wikiPage.id, wikiPage.workspaceId],
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
