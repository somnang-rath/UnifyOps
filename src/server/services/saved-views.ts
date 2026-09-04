import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { ResolvedActor } from '@/server/auth/context';
import { isUniqueViolation } from '@/server/db/errors';
import { savedView } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import {
  countSavedViews,
  fetchSavedView,
  fetchSavedViews,
  type SavedViewRow,
} from '@/server/queries/saved-views';
import {
  clampWidth,
  isTableColumn,
  validateSavedView,
  type SavedViewProblem,
  type TableLayout,
} from '@/lib/saved-views';

/**
 * Saved views (§4's must-have "saved views", §14 slice 12).
 *
 * **No §10 row was invented, and this is the sixth time that decision has gone
 * the same way** — after labels (slice 5), attachments (slice 8), notifications
 * (slice 9), custom fields (slice 10) and cycles (slice 11). The argument is
 * the same one, and here it is at its simplest: a saved view is one person's
 * bookmark of their own screen. What stops somebody reaching another person's
 * is not a role, it is the `owner_member_id` in every predicate, underneath the
 * RLS that has already scoped the row to the workspace. Inventing a permission
 * row would put a rule in the code that the table a non-technical owner is
 * shown does not contain, and would imply an Admin could manage a colleague's
 * bookmarks, which nothing in §7 asks for.
 *
 * **No events, either**, and that is the same call `setNotificationPreference`
 * made in slice 9. §8's registry is about things that happened to a *company's
 * work* — an audit trail, an item's history, somebody's inbox. Naming a filter
 * is furniture. An entry reading `audit: false, activity: false, notify: false`
 * would be three decisions recorded as "no" for an event nobody would ever read.
 *
 * **A view is not validated against the query it stores.** The DSL already
 * tolerates junk by design (§9's "discarding rather than failing"), so a saved
 * view whose filter names a since-deleted label opens one filter wider rather
 * than not at all — which is the behaviour a pasted link already has, and a
 * saved view is a link somebody named.
 */

type Ok<T = Record<never, never>> = { ok: true } & T;
type Failed = { ok: false; problem: SavedViewFailure };

export type SavedViewFailure =
  | SavedViewProblem
  // The unique index on (owner, name) surfacing. A person re-using one of their
  // own view names is the ordinary case, not an exception.
  | 'name_taken'
  | 'not_found';

export type { SavedViewRow };

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * This member's saved views for one screen.
 *
 * A `projectId` of null asks for the workspace-wide surfaces slice 13 brings;
 * today every caller passes a project. Exported as its own function because a
 * page that is *already* inside a `withActor` should call
 * `fetchSavedViews` directly instead — the trap slice 8 hit with
 * `getCommentThread`, slice 9 with the unread count, slices 10 and 11 with
 * custom fields and cycles. The project page does exactly that.
 */
export async function listSavedViews(
  resolved: ResolvedActor,
  projectId: string | null,
): Promise<SavedViewRow[]> {
  return withActor(resolved.context, (tx) =>
    fetchSavedViews(tx, { ownerMemberId: resolved.memberId, projectId }),
  );
}

/* ------------------------------------------------------------------------- */
/* Writing                                                                   */
/* ------------------------------------------------------------------------- */

export async function createSavedView(
  resolved: ResolvedActor,
  input: { name: string; query: string; projectId: string | null; layout?: TableLayout | null },
): Promise<Ok<{ viewId: string }> | Failed> {
  // NFC for the reason every other user-typed name in this product is
  // normalised: two spellings of one Khmer word that look identical would
  // otherwise be two rows the unique index cannot see as one.
  const name = input.name.trim().normalize('NFC');
  const query = normalizeQuery(input.query);
  const viewId = uuidv7();

  try {
    return await withActor(resolved.context, async (tx) => {
      const existing = await countSavedViews(tx, resolved.memberId);
      const problem = validateSavedView({ name, query, existingCount: existing });
      if (problem) return { ok: false, problem } as const;

      await tx.insert(savedView).values({
        id: viewId,
        workspaceId: resolved.workspace.id,
        ownerMemberId: resolved.memberId,
        projectId: input.projectId,
        name,
        query,
        layout: input.layout ? sanitizeLayout(input.layout) : null,
      });

      return { ok: true, viewId } as const;
    });
  } catch (error) {
    // The unique index is on (owner, name). A person re-saving a name they
    // already used is the ordinary case, not an exception — it reaches them as
    // a translated message beside the field they typed in (§11's "errors land
    // where they were caused").
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * Renames a view, or points it at the query now on screen, or both.
 *
 * One function rather than three, because the row has three mutable fields and
 * the screen offers exactly one control that changes any of them — "update this
 * view to what I am looking at". Splitting it would be three round trips for
 * one click.
 */
export async function updateSavedView(
  resolved: ResolvedActor,
  input: { viewId: string; name?: string; query?: string; layout?: TableLayout },
): Promise<Ok | Failed> {
  try {
    return await withActor(resolved.context, async (tx) => {
      const existing = await fetchSavedView(tx, {
        id: input.viewId,
        ownerMemberId: resolved.memberId,
      });
      // Null covers "no such view" and "not yours" alike — one answer, because
      // telling them apart says what exists.
      if (!existing) return { ok: false, problem: 'not_found' } as const;

      const name = input.name === undefined ? existing.name : input.name.trim().normalize('NFC');
      const query = input.query === undefined ? existing.query : normalizeQuery(input.query);

      const problem = validateSavedView({ name, query });
      if (problem) return { ok: false, problem } as const;

      await tx
        .update(savedView)
        .set({
          name,
          query,
          layout: input.layout ? sanitizeLayout(input.layout) : existing.layout,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(savedView.id, input.viewId),
            eq(savedView.ownerMemberId, resolved.memberId),
            isNull(savedView.deletedAt),
          ),
        );

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, problem: 'name_taken' };
    throw error;
  }
}

/**
 * §12's "column widths persisted per saved view", as its own entry point.
 *
 * Separate from `updateSavedView` because it is called by a different gesture
 * with a different failure story: letting go of a column edge is not a form
 * submission, and it must not be able to fail with "that name is taken". It
 * writes the layout and nothing else, so a resize can never disturb the query
 * the view names.
 *
 * A width dragged on a screen with **no** saved view selected is deliberately
 * not stored anywhere. §12 says "per saved view", and the alternative — a
 * per-member default layout — is a second thing to keep in step with the first
 * for a preference nobody asked for. It lives in component state for as long as
 * the page does, which is what an unsaved change should do.
 */
export async function saveTableLayout(
  resolved: ResolvedActor,
  input: { viewId: string; layout: TableLayout },
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const existing = await fetchSavedView(tx, {
      id: input.viewId,
      ownerMemberId: resolved.memberId,
    });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    await tx
      .update(savedView)
      .set({ layout: sanitizeLayout(input.layout), updatedAt: new Date() })
      .where(
        and(
          eq(savedView.id, input.viewId),
          eq(savedView.ownerMemberId, resolved.memberId),
          isNull(savedView.deletedAt),
        ),
      );

    return { ok: true } as const;
  });
}

/**
 * Deletes a view.
 *
 * Soft, like everything else in this product — but for a duller reason than
 * comments have. A comment's tombstone is visible because a thread that closed
 * over a removed message would misrepresent a conversation (§7.7); nothing
 * renders a deleted view. The soft delete is here because `deleted_at` is on
 * every table through `timestamps` and a hard delete would be the one
 * inconsistency, and because the unique index on (owner, name) is not partial:
 * a hard delete would be the only way to reuse a name, and a soft one keeps
 * that behaviour honest by keeping the row.
 */
export async function deleteSavedView(
  resolved: ResolvedActor,
  viewId: string,
): Promise<Ok | Failed> {
  return withActor(resolved.context, async (tx) => {
    const existing = await fetchSavedView(tx, { id: viewId, ownerMemberId: resolved.memberId });
    if (!existing) return { ok: false, problem: 'not_found' } as const;

    await tx
      .update(savedView)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(savedView.id, viewId), eq(savedView.ownerMemberId, resolved.memberId)));

    return { ok: true } as const;
  });
}

/* ------------------------------------------------------------------------- */
/* Normalising                                                               */
/* ------------------------------------------------------------------------- */

/** Stored without the leading `?`, so the column holds one shape and not two. */
function normalizeQuery(query: string): string {
  return query.replace(/^\?/, '');
}

/**
 * A layout on its way into the database, with everything unrecognised removed.
 *
 * Sanitised on write as well as on read. `parseTableLayout` already drops junk
 * when a row is loaded, so this is belt and braces — but the two do different
 * jobs: the read protects the screen from a row an older build wrote, and this
 * protects the row from a client that sent something the screen could never
 * have produced. Writing what arrived and cleaning it later would leave the
 * cleaning as the only thing standing between a crafted payload and an
 * unbounded blob in a `jsonb` column.
 */
function sanitizeLayout(layout: TableLayout): TableLayout {
  const columns = [...new Set(layout.columns.filter(isTableColumn))];

  const widths: Record<string, number> = {};
  for (const [column, width] of Object.entries(layout.widths ?? {})) {
    if (!isTableColumn(column)) continue;
    if (typeof width !== 'number') continue;
    widths[column] = clampWidth(width);
  }

  return { columns, widths };
}
