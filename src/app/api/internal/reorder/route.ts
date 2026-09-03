import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActorContext } from '@/server/auth/context';
import { moveWorkItem } from '@/server/services/work-items';

/**
 * Drag-and-drop reorder — the first of §8's five deliberate Route Handler
 * exceptions to "Server Actions for everything".
 *
 * A route handler because a drag is a mutation whose *only* visible result has
 * already happened optimistically in the browser. A server action would
 * revalidate the route and rebuild the whole board to confirm a card is where
 * the user can already see it is, and the board would flicker on every drag.
 *
 * Nothing here is trusted. The actor comes from the session cookie, the item
 * and both neighbours are re-read inside the transaction under `FOR UPDATE`,
 * and §10 is asked again by `moveWorkItem` through `guardForWrite`. **There is
 * no rank in the request body and there never will be** (§9) — a rank computed
 * in a browser is computed against a board that may be stale, and two people
 * dropping onto the same gap would compute the same key.
 *
 * The response carries the rank the server actually chose, so a client that
 * cares can reconcile; the board mostly does not, because it re-reads through
 * the change token instead.
 */

const bodySchema = z
  .object({
    workspaceSlug: z.string().min(1),
    workItemId: z.uuid(),
    /** The column dropped into — the item's current one, for a same-column reorder. */
    stateId: z.uuid(),
    /** Null means the top of the column, and is an intent rather than a missing value. */
    previousId: z.uuid().nullable(),
    /** Null means the bottom of the column, likewise. */
    nextId: z.uuid().nullable(),
  })
  .strict();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { workspaceSlug, ...input } = parsed.data;

  const resolved = await resolveActorContext(workspaceSlug);
  // The same 404 a page gives, covering "no such workspace" and "not a member"
  // alike — distinguishing them says which company slugs exist.
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await moveWorkItem(resolved, input);

  if (!result.ok) {
    // A problem identifier, never a sentence: §13 is explicit that an English
    // string returned from the server is the one place Khmer silently degrades.
    // The toast §7.5 asks for is rendered from this key on the client.
    const status = result.problem === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: result.problem }, { status });
  }

  return NextResponse.json({ rank: result.rank });
}
