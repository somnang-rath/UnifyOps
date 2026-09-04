import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActorContext } from '@/server/auth/context';
import { setWorkItemAssignees } from '@/server/services/work-items';

/**
 * §7.4's "drag a card between people to reassign (notifies both)".
 *
 * A route handler beside `reorder`, and for exactly the reason that one gives:
 * a drag is a mutation whose only visible result has already happened
 * optimistically in the browser, so a server action would revalidate the route
 * and rebuild the whole workload to confirm a card is where the user can already
 * see it is.
 *
 * **A fourth folder under `api/internal`, where §8's layout names three.** That
 * is a deviation and is named rather than hidden. §8's *exception list* is five
 * kinds of endpoint — "drag-and-drop reorder, list fetch, file upload,
 * webhooks, and the future public API" — and this is the first of those five,
 * not a sixth: it is a drag, refused a server action for the same reason the
 * board's drag is. What is new is only that §7.4's drag means something
 * different from §7.5's.
 *
 * **A second route rather than a second meaning for `reorder`.** `moveWorkItem`'s
 * whole contract is neighbour ids and a state change (slice 6, §9), and teaching
 * it "unless the column is a person, in which case reassign" would make one
 * gesture do two different things depending on where it landed. This is the same
 * line slice 11 drew when it declined to teach the board's drag about cycles.
 *
 * **No rank, and no neighbours.** A workload column is not ordered by anything
 * anybody chose — it is one person's open work, and dropping into the middle of
 * it does not mean "do this third". Rank is the board's concern and stays there;
 * moving a card between people changes exactly one thing, which is who owns it.
 *
 * Nothing here is trusted: the actor comes from the session cookie, and
 * `setWorkItemAssignees` asks §10 again through `guardForWrite`. "Notifies both"
 * is free — `work_item.assigned` carries `added` and `removed`, and slice 9's
 * registry entry already notifies each.
 */

const bodySchema = z
  .object({
    workspaceSlug: z.string().min(1),
    workItemId: z.uuid(),
    /**
     * Who owns it now. An **array**, because §4 is explicit that "assignment is
     * multiple", and a drag that silently dropped a second assignee would be a
     * data loss nobody saw. The client sends the whole intended set; today's
     * workload columns make that exactly one person, or none.
     */
    memberIds: z.array(z.uuid()).max(50),
  })
  .strict();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { workspaceSlug, workItemId, memberIds } = parsed.data;

  const resolved = await resolveActorContext(workspaceSlug);
  // The same 404 a page gives: "no such workspace" and "not a member" are one
  // answer, because telling them apart says which company slugs exist.
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await setWorkItemAssignees(resolved, { workItemId, memberIds });

  if (!result.ok) {
    // A problem identifier, never a sentence (§13). The toast is rendered from
    // this key on the client, in the reader's own language.
    const status = result.problem === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: result.problem }, { status });
  }

  return NextResponse.json({ ok: true });
}
