import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActorContext } from '@/server/auth/context';
import { UnanchoredQueryError } from '@/server/queries/work-items';
import { boardChangeToken, listWorkItems } from '@/server/services/work-items';
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

/**
 * The board's change-token poll (§8, §17-24).
 *
 * A `GET` on the same route rather than a sixth §8 exception, because it is the
 * same concern — reading a list — asked in its cheapest possible form. It runs
 * every 20 seconds per visible board and stops entirely when the tab is hidden,
 * which is a §2.5-5 decision about mobile data rather than a tuning detail.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get('w');
  const query = url.searchParams.get('q') ?? '';

  if (!workspaceSlug) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const parsedQuery = parseWorkItemQuery(
    // `URLSearchParams` strips a leading `?` itself, so the query string is
    // handed over whole rather than trimmed here.
    Object.fromEntries(new URLSearchParams(query)),
  );

  try {
    return NextResponse.json({ token: await boardChangeToken(resolved, parsedQuery) });
  } catch (error) {
    if (error instanceof UnanchoredQueryError) {
      return NextResponse.json({ error: 'unanchored' }, { status: 400 });
    }
    throw error;
  }
}

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
    // `URLSearchParams` strips a leading `?` itself, so the query string is
    // handed over whole rather than trimmed here.
    Object.fromEntries(new URLSearchParams(query)),
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
