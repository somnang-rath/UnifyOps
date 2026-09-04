import 'server-only';

import { cookies } from 'next/headers';

/**
 * §7.13's view-as, at the cookie layer.
 *
 * The whole of the mechanism is one cookie naming a workspace and a member, and
 * `resolveActorContext` re-deciding on every request whether it is allowed to
 * mean anything. **The cookie is not a credential and is deliberately not
 * signed**: it is re-validated from scratch each time against the session's own
 * membership — the viewer must still hold `workspace.view_as_member` in *that*
 * workspace, and the target must still be a live member of it. A forged value
 * can therefore only ask for a session the viewer could have started by
 * clicking, which is the property that makes signing it pointless rather than
 * merely omitted.
 *
 * It carries the workspace id as well as the member id for the case that would
 * otherwise be silent: somebody views as a colleague in Acme, switches to their
 * other workspace, and the cookie names a member id that means nothing there.
 * Requiring the match makes that a no-op instead of a lookup that fails in some
 * way nobody predicted.
 *
 * **`httpOnly`, like the session cookie.** Not because reading it would leak
 * anything — the bar names the person on screen — but because a value client
 * script can write is a value that will eventually be written by something
 * other than this product, and every request would then be validating a claim
 * that arrived from somewhere unaccountable.
 *
 * A cookie rather than a row, unlike the session it rides beside, because a
 * view-as session is not a credential with a lifetime to revoke: it holds no
 * power the viewer does not already hold, and ending it is one write in one
 * browser rather than something an administrator elsewhere needs to be able to
 * do. It also expires with the browser session, which is the right default for
 * a mode §7.13 describes as answering a question rather than doing work.
 */

const COOKIE = 'unifyops_view_as';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;

export type ViewAsCookie = {
  workspaceId: string;
  memberId: string;
};

/**
 * What the cookie says, or null.
 *
 * Parsed defensively and never trusted: this returns a *claim*, and
 * `resolveActorContext` is the only thing that decides whether the claim is
 * allowed to change who is acting.
 */
export async function readViewAs(): Promise<ViewAsCookie | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;

  const [workspaceId, memberId, ...rest] = raw.split(':');
  if (!workspaceId || !memberId || rest.length > 0) return null;

  return { workspaceId, memberId };
}

/** Only callable from a Server Action or Route Handler — a Next.js constraint. */
export async function setViewAs(claim: ViewAsCookie): Promise<void> {
  const store = await cookies();
  // No `expires`, so it is a session cookie: closing the browser ends a mode
  // that exists to answer a question. §7.13's Exit is the deliberate way out and
  // the bar is always on screen offering it; this is the accident-proof one.
  store.set(COOKIE, `${claim.workspaceId}:${claim.memberId}`, COOKIE_OPTIONS);
}

export async function clearViewAs(): Promise<void> {
  const store = await cookies();
  store.delete({ name: COOKIE, path: COOKIE_OPTIONS.path });
}
