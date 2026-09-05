import 'server-only';

import { and, eq, isNull, lt } from 'drizzle-orm';
import { platformDb } from './client';
import { attachment, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { objectStore } from '@/server/storage/store';
import { storageKey } from '@/lib/attachments';

/**
 * The abandoned-upload sweeper (§20.9 — slice 18, and slice 9's unfinished
 * business).
 *
 * **This stopped being optional when the wiki arrived.** Slice 8 wrote the
 * `pending` row that makes an abandoned upload *harmless* — "a ticket that is
 * never used, or a comment that is drafted with a file and then never posted,
 * leaves a row nothing renders and bytes nothing references" — and named slice 9
 * as the slice that would collect them, because slice 9 is where pg-boss and the
 * second process arrive. Slice 9 did not build it. §20.9 makes it a prerequisite
 * rather than a gap slice 18 is allowed to widen: "a page is drafted for longer
 * than a comment, with more images, and abandoned more often."
 *
 * Three properties are worth stating, because each is a way the obvious version
 * goes wrong.
 *
 * **Enumeration crosses workspaces; every write is scoped to one.** "Which
 * pending rows are old" is a question no tenant scope can answer, so it runs on
 * `DATABASE_URL_OPERATOR` — which is `SELECT`-only at the role level (§18-12)
 * and therefore *cannot* delete anything even if this file asked it to. The
 * deletes go through `withActor` on the app role, in the scope of the member who
 * uploaded the file. That is slice 9's split exactly, and the reason it is right
 * here too: the row belongs to that member, RLS re-checks the workspace on the
 * way through, and a bug in this file's enumeration cannot reach another
 * company's bytes.
 *
 * **The bytes go before the row does.** The other order leaves an object nothing
 * references and no record that it exists, which is precisely the leak being
 * swept. This order can leave a row whose bytes are already gone if the process
 * dies in between — and that row is `pending`, so nothing renders it, and the
 * next sweep collects it. One failure mode is recoverable and the other is
 * permanent.
 *
 * **A file that is `ready` is never touched, whatever its age.** The sweep's
 * predicate is `status = 'pending'`, which is the state that means "authorised
 * and never confirmed". Sweeping on age alone would eventually delete somebody's
 * attachments.
 */

/**
 * How long a pending row is given before it is considered abandoned.
 *
 * Comfortably longer than the upload URL it was minted with — `UPLOAD_TTL` is
 * fifteen minutes (§8's ticket), so after an hour a `pending` row cannot become
 * `ready` by any path the product offers: the signature it was created for has
 * expired and the browser that held it is gone.
 *
 * An hour rather than fifteen minutes and one second, because the cost of
 * waiting is storage nobody is paying much for and the cost of being wrong is
 * deleting the bytes of an upload that was still in flight on a slow connection
 * (§2.5-3's phone-heavy market).
 */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** The pg-boss queue this runs on. Named here, scheduled in `worker.ts`. */
export const SWEEP_QUEUE = 'attachments.sweep';

/**
 * How many rows one pass collects.
 *
 * Bounded so a backlog is worked through over several runs rather than in one
 * transaction holding a connection for minutes. The schedule is hourly, and a
 * company that abandoned five hundred uploads in an hour has a different problem.
 */
const SWEEP_BATCH = 200;

export type SweepResult = { scanned: number; deleted: number; failed: number };

/**
 * One pass. Returns what it did, so the worker can log a number rather than a
 * silence.
 */
export async function sweepAbandonedUploads(now: Date = new Date()): Promise<SweepResult> {
  const cutoff = new Date(now.getTime() - ABANDONED_AFTER_MS);

  /**
   * The cross-workspace read, on the operator role.
   *
   * `uploaded_by_member_id` and the member's `user_id` come back with it,
   * because the write below runs as that person and `withActor` needs both. A
   * soft-deleted membership is excluded: somebody offboarded still has their
   * abandoned uploads swept, but not *as them* — `withActor` in the scope of a
   * removed member is a session that should not exist, and those rows are
   * collected by the membership's own cascade instead.
   */
  const rows = await platformDb()
    .select({
      id: attachment.id,
      workspaceId: attachment.workspaceId,
      userId: workspaceMember.userId,
    })
    .from(attachment)
    .innerJoin(workspaceMember, eq(workspaceMember.id, attachment.uploadedByMemberId))
    .where(
      and(
        eq(attachment.status, 'pending'),
        isNull(attachment.deletedAt),
        isNull(workspaceMember.deletedAt),
        lt(attachment.createdAt, cutoff),
      ),
    )
    .orderBy(attachment.createdAt)
    .limit(SWEEP_BATCH);

  let deleted = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // The bytes first — see the note above. `deleteObject` is idempotent, so a
      // retry after a crash between here and the commit is a no-op rather than
      // an error.
      await objectStore().deleteObject(
        storageKey({ workspaceId: row.workspaceId, attachmentId: row.id }),
      );

      await withActor(
        {
          workspaceId: row.workspaceId,
          // The uploader is both the scope and the principal: this is not a
          // view-as session, and `read_only` here would make every tenant
          // policy's `not tenancy.is_read_only()` clause refuse the delete.
          userId: row.userId,
          actorUserId: row.userId,
          readOnly: false,
        },
        async (tx) => {
          /**
           * A hard `DELETE`, which is the one place in this product a tenant row
           * is really removed rather than tombstoned — and it is right here for
           * the reason the row exists at all: a `pending` attachment is not
           * something a person made, it is a ticket the product issued and
           * nobody used. There is nothing to recover and nobody to show a
           * tombstone to.
           *
           * The predicate repeats `status = 'pending'` rather than trusting the
           * enumeration: the row may have been confirmed in the minutes between
           * the operator read and this transaction, and a file somebody has just
           * successfully posted must not be deleted because a sweeper saw it
           * mid-flight.
           */
          await tx
            .delete(attachment)
            .where(and(eq(attachment.id, row.id), eq(attachment.status, 'pending')));
        },
      );

      deleted += 1;
    } catch (error) {
      // One row failing must not stop the pass: a single object the store
      // refuses to delete would otherwise block every row behind it, for ever.
      failed += 1;
      console.error(
        '[jobs] sweep failed for attachment',
        row.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { scanned: rows.length, deleted, failed };
}
