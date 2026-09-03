import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActorContext } from '@/server/auth/context';
import { UnanchoredQueryError } from '@/server/queries/work-items';
import { listWorkItems } from '@/server/services/work-items';
import { parseWorkItemQuery } from '@/lib/work-item-query';
import { toItemRowData } from '@/lib/work-item-row';

/**
 * The §8 layout reserves `api/internal/list` for exactly this: one group's next
 * keyset page, so a list can extend a column without re-rendering the page.
 *
 * A route handler and not a server action, because it is a **read**. A server
 * action would go through revalidation and rebuild the whole route to append
 * ten rows to one group.
 *
 * "Internal" names who calls it, not what protects it. Nothing here trusts the
 * body: the actor comes from the session cookie, the filter is re-parsed
 * through the same Zod DSL a page uses, and `listWorkItems` re-checks §10 on
 * every row it is about to return. A crafted payload buys the caller exactly
 * what their own session already permits.
 *
 * Route handlers under `src/app/api/` are excluded from the locale proxy by its
 * matcher, which is right — they are not locale-prefixed.
 */

const bodySchema = z
  .object({
    workspaceSlug: z.string().min(1),
    /** The page's query string, verbatim. Re-parsed rather than trusted. */
    query: z.string().max(4096),
    groupKey: z.string().min(1).max(200),
    cursor: z.string().max(512).nullable(),
  })
  .strict();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { workspaceSlug, query, groupKey, cursor } = parsed.data;

  const resolved = await resolveActorContext(workspaceSlug);
  // Null covers "no such workspace" and "not a member of it" alike — the same
  // 404 a page gives, for the same reason: distinguishing them says what exists.
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsedQuery = parseWorkItemQuery(
    Object.fromEntries(new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)),
  );

  try {
    const listing = await listWorkItems(resolved, parsedQuery, {
      groupKeys: [groupKey],
      cursors: { [groupKey]: cursor },
    });

    const group = listing.groups[0];

    return NextResponse.json({
      rows: (group?.rows ?? []).map(toItemRowData),
      nextCursor: group?.nextCursor ?? null,
    });
  } catch (error) {
    // §16's invariant, surfacing. A caller who edited the query string until it
    // had no anchor gets a refusal rather than a workspace-wide scan.
    if (error instanceof UnanchoredQueryError) {
      return NextResponse.json({ error: 'unanchored' }, { status: 400 });
    }
    throw error;
  }
}
