import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, tenantPolicies, timestamps, workspaceIdColumn } from './_shared';
import { comment } from './comment';
import { project } from './project';
import { workItem } from './work-item';
import { workspace, workspaceMember } from './workspace';

/**
 * Files attached to a work item, or to a comment on one (§4, §7.7, §2.4 — the
 * last third of slice 8).
 *
 * **The row exists before the bytes do, and that ordering is the design.** §8
 * requires a presigned direct upload — the browser sends the file to the store
 * and this process never touches it — which means the only moment the server
 * can refuse an upload is *before* it is authorised. So a request for an upload
 * writes a `pending` row: §10 is asked, §4's archived rule is applied, the size
 * and type are checked, and only then is a URL signed. What the store will
 * accept is bounded by what the database already agreed to.
 *
 * `pending` is also what makes an abandoned upload harmless. A ticket that is
 * never used, or a comment that is drafted with a file and then never posted,
 * leaves a row nothing renders and bytes nothing references. Sweeping those is
 * slice 9's — it is the slice that introduces pg-boss, and a periodic job is
 * the right home for it rather than a hand-rolled timer here.
 */
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'ready']);

export const attachment = pgTable(
  'attachment',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspace.id, { onDelete: 'cascade' }),

    /** Denormalized from the item, for the reason `comment.project_id` is:
     * every read asks §10 a question about the *project*, and a join to find
     * out which project would sit on the path of the permission check. */
    projectId: uuid('project_id').notNull(),
    workItemId: uuid('work_item_id').notNull(),

    /**
     * The comment this file was posted with, or null when it hangs on the item
     * itself.
     *
     * Nullable rather than two tables, because §9 hangs Comment and Attachment
     * off the same WorkItem and every question asked of one is asked of the
     * other — who uploaded it, may this person remove it, where are the bytes.
     * The column is what separates the two lists on screen, and it is why the
     * activity projector can stay quiet about a file that arrived with a
     * comment: the comment is already rendered an inch above, with the file in
     * it.
     */
    commentId: uuid('comment_id'),

    /** The member, not the user — as with `comment.author_member_id`, so a
     * composite foreign key can hold the workspace honest. */
    uploadedByMemberId: uuid('uploaded_by_member_id').notNull(),

    /**
     * The name the person's machine gave the file, sanitized (`src/lib/
     * attachments.ts`) and stored as typed. The key in the bucket is derived
     * from the id instead, so nothing user-supplied ever becomes a path.
     */
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),

    /**
     * `integer`, not `bigint`. The cap is 25 MiB and a four-byte column holds
     * two gigabytes — a `bigint` here would be a column wide enough for a file
     * the product refuses to accept, which reads as though the limit were
     * negotiable.
     */
    sizeBytes: integer('size_bytes').notNull(),

    status: attachmentStatus('status').notNull().default('pending'),

    /**
     * Soft delete, and it does the same real work it does on `comment`: §10
     * lets a Lead remove somebody else's file, and the row is what the audit
     * record points at afterwards. The bytes outlive it until slice 9's job
     * collects them, which is deliberate — a delete that made a network call to
     * a third party inside the transaction would make removing a file fail
     * whenever Cloudflare had a bad minute.
     */
    ...timestamps,
  },
  (t) => [
    /** The item panel: this item's own files, oldest first. */
    index('attachment_item_idx').on(t.workItemId, t.createdAt, t.id),

    /** The thread: every file posted with any comment on one page of it. */
    index('attachment_comment_idx').on(t.commentId),

    foreignKey({
      name: 'attachment_item_fk',
      columns: [t.workItemId, t.workspaceId],
      foreignColumns: [workItem.id, workItem.workspaceId],
    }).onDelete('cascade'),

    foreignKey({
      name: 'attachment_project_fk',
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [project.id, project.workspaceId],
    }).onDelete('cascade'),

    /**
     * Cascade, unlike the item and project links above it are for a different
     * reason: a comment is only ever *soft*-deleted, so this fires only if a
     * row is ever removed for real, and a file whose comment no longer exists
     * has nothing to render it.
     */
    foreignKey({
      name: 'attachment_comment_fk',
      columns: [t.commentId, t.workspaceId],
      foreignColumns: [comment.id, comment.workspaceId],
    }).onDelete('cascade'),

    /**
     * `restrict`, for the reason `comment_author_fk` is: §7.12 keeps what
     * somebody contributed "preserved and attributed", and offboarding must not
     * take a departed colleague's files with them.
     */
    foreignKey({
      name: 'attachment_uploader_fk',
      columns: [t.uploadedByMemberId, t.workspaceId],
      foreignColumns: [workspaceMember.id, workspaceMember.workspaceId],
    }).onDelete('restrict'),

    ...tenantPolicies(),
  ],
);
