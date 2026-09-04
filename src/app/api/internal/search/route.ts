import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/server/auth/context';
import { searchWorkspace } from '@/server/services/search';
import { MAX_QUERY_LENGTH, PALETTE_SECTION_LIMIT } from '@/lib/search';

/**
 * §7.9's palette, fetching (slice 14).
 *
 * A route handler rather than a server action, and **not a sixth §8 exception**.
 * §8 reserves five: "drag-and-drop reorder, list fetch, file upload, webhooks,
 * and the future public API" — this is *list fetch*, the same exception
 * `api/internal/list` is, asked about four small lists instead of one big one. A
 * server action would go through revalidation and rebuild a route to answer a
 * keystroke; the same argument slice 13 made when a drag needed its own endpoint
 * and slice 6 made for the board's change token.
 *
 * A `GET`, so it is cacheable-shaped, back-buttonable-shaped and — the part that
 * matters — trivially cancellable by the browser when the next keystroke arrives.
 *
 * "Internal" names who calls it, not what protects it. The actor comes from the
 * session cookie; the query text is re-normalized and re-floored by the service;
 * the §9 query it builds is anchored to the projects `listProjects` says this
 * actor may see, and the identifier short-circuit re-asks §10 about the project
 * it landed in. A crafted request buys exactly what the caller's own session
 * already permits.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get('w');
  // The same parameter name the §9 DSL uses for search text, so a palette URL
  // and a list URL say the same word for the same thing.
  const text = url.searchParams.get('q') ?? '';
  const includeArchived = url.searchParams.get('arch') === '1';

  if (!workspaceSlug) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  // Cheap refusal before any work: the palette caps its own input, so anything
  // longer arrived from something that is not the palette.
  if (text.length > MAX_QUERY_LENGTH * 4) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const resolved = await resolveActorContext(workspaceSlug);
  // Null covers "no such workspace" and "not a member of it" alike — the same
  // 404 a page gives, for the same reason: distinguishing them says what exists.
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const results = await searchWorkspace(resolved, {
    text,
    includeArchived,
    limit: PALETTE_SECTION_LIMIT,
  });

  return NextResponse.json({
    text: results.text,
    searched: results.searched,
    reference: results.reference,
    items: results.items,
    itemTotal: results.itemTotal,
    // Only what a palette row draws. `ProjectSummary` carries a team name and a
    // composed §10 role, and neither belongs in a payload sent on a keystroke.
    projects: results.projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      key: project.key,
      name: project.name,
      archived: project.archivedAt !== null,
    })),
    people: results.people,
  });
}
