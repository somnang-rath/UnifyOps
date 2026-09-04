import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { TenantDb } from '@/server/db/client';
import { savedView } from '@/server/db/schema';
import { parseTableLayout, type TableLayout } from '@/lib/saved-views';

/**
 * Reading saved views (§4, §14 slice 12).
 *
 * **Every predicate here carries the acting member's own id**, and that is the
 * whole of the access control on this table — the same construction the
 * notification inbox uses, and the reason neither needed a §10 row. RLS has
 * already scoped the rows to the workspace; the owner column is what makes one
 * person's saved views theirs. A read written without it would not leak another
 * *company's* data, but it would put a colleague's view on somebody's screen,
 * which is its own kind of wrong.
 *
 * The layout is parsed here rather than handed on raw, because `jsonb` arrives
 * as `unknown` and `parseTableLayout` is the one place that decides what a
 * stored layout means. A column naming a deleted custom field survives this
 * step and is dropped by `resolveColumns` at render, where the project's fields
 * are known.
 */

export type SavedViewRow = {
  id: string;
  name: string;
  /** The URL's search part, without the leading `?`. Re-parsed, never trusted. */
  query: string;
  projectId: string | null;
  layout: TableLayout;
};

/**
 * One person's saved views for one project, in name order.
 *
 * Ordered by name rather than by creation, because this renders as a bar of
 * chips somebody scans — and a list that reorders itself when you add to it is
 * one where you lose the chip you were about to click. `collate "C"` is
 * deliberately *not* used: unlike a fractional rank this is human-facing text,
 * and Postgres's locale ordering is the right one for it.
 */
export async function fetchSavedViews(
  tx: TenantDb,
  input: { ownerMemberId: string; projectId: string | null },
): Promise<SavedViewRow[]> {
  const rows = await tx
    .select({
      id: savedView.id,
      name: savedView.name,
      query: savedView.query,
      projectId: savedView.projectId,
      layout: savedView.layout,
    })
    .from(savedView)
    .where(
      and(
        eq(savedView.ownerMemberId, input.ownerMemberId),
        input.projectId === null
          ? isNull(savedView.projectId)
          : eq(savedView.projectId, input.projectId),
        isNull(savedView.deletedAt),
      ),
    )
    .orderBy(asc(savedView.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    query: row.query,
    projectId: row.projectId,
    layout: parseTableLayout(row.layout),
  }));
}

/** One view of this member's, or null. The owner check is in the predicate, not after it. */
export async function fetchSavedView(
  tx: TenantDb,
  input: { id: string; ownerMemberId: string },
): Promise<SavedViewRow | null> {
  const rows = await tx
    .select({
      id: savedView.id,
      name: savedView.name,
      query: savedView.query,
      projectId: savedView.projectId,
      layout: savedView.layout,
    })
    .from(savedView)
    .where(
      and(
        eq(savedView.id, input.id),
        eq(savedView.ownerMemberId, input.ownerMemberId),
        isNull(savedView.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    query: row.query,
    projectId: row.projectId,
    layout: parseTableLayout(row.layout),
  };
}

/**
 * How many views this member already has, anywhere in the workspace.
 *
 * Counted across projects rather than per project, because
 * `MAX_VIEWS_PER_MEMBER` is a bound on one person's furniture and not a
 * per-screen quota — fifty views spread over ten projects is the same amount of
 * picker to scroll through as fifty on one.
 */
export async function countSavedViews(tx: TenantDb, ownerMemberId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(savedView)
    .where(and(eq(savedView.ownerMemberId, ownerMemberId), isNull(savedView.deletedAt)));

  return rows[0]?.count ?? 0;
}
