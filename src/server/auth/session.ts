import 'server-only';

import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { withIdentity } from '@/server/db/identity';
import { authSession, user as userTable } from '@/server/db/schema';
import { hashToken, LIFETIME, mint } from './tokens';

/**
 * Database sessions (§8), and the request-scoped resolution of one.
 *
 * The cookie holds a random token; the table holds its SHA-256. That asymmetry
 * is the whole security property: a database read — a backup, a support query,
 * a leaked dump — yields no usable session.
 *
 * A row rather than a signed JWT because three later slices need a session to
 * be a thing that can be *revoked*: offboarding a member (§7.12) has to end
 * their sessions now, not in fifteen minutes; view-as (§7.13) is a real actor
 * context that has to be exitable; and an owner changing someone's role expects
 * it to take effect on the next click. A stateless token can only ever be
 * waited out.
 */

const COOKIE = 'unifyops_session';

/**
 * Lax, not Strict. Strict would drop the cookie on the first request after
 * following an invitation link from an email client, so an invitee who is
 * already signed in would be asked to sign in again — at exactly the moment
 * §7.10 promises "already a member → straight to the workspace, no error".
 * Lax still refuses cross-site POSTs, which is what the flag is for.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const;

/** Re-issue once the session is past its half-life, not on every request. */
const RENEW_AFTER_MS = LIFETIME.session / 2;

export type ResolvedSession = {
  sessionId: string;
  userId: string;
};

/**
 * Signs a user in: one row, one cookie.
 *
 * Only callable where cookies can be written — a Server Action or a Route
 * Handler. That is a Next.js constraint rather than ours, and it happens to
 * match where sign-in belongs anyway.
 */
export async function startSession(userId: string): Promise<void> {
  const { token, tokenHash, expiresAt } = mint(LIFETIME.session);

  await withIdentity(async (tx) => {
    // Sweep this user's dead rows on the way past. Cheap, bounded to one user,
    // and it keeps the table from needing a job it does not otherwise need.
    await tx
      .delete(authSession)
      .where(and(eq(authSession.userId, userId), lt(authSession.expiresAt, new Date())));

    await tx.insert(authSession).values({ userId, tokenHash, expiresAt });
  });

  const store = await cookies();
  store.set(COOKIE, token, { ...COOKIE_OPTIONS, expires: expiresAt });
}

/**
 * The current session, or null.
 *
 * `cache` memoizes this for one render pass, so a layout, a page and three
 * server components asking "who is this?" cost one query rather than five. It
 * is per-request by construction — React's cache does not outlive the pass —
 * which is the property that matters when the answer is an identity.
 */
export const readSession = cache(async (): Promise<ResolvedSession | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);

  return withIdentity(async (tx) => {
    const rows = await tx
      .select({
        id: authSession.id,
        userId: authSession.userId,
        expiresAt: authSession.expiresAt,
        lastUsedAt: authSession.lastUsedAt,
      })
      .from(authSession)
      .where(and(eq(authSession.tokenHash, tokenHash), gt(authSession.expiresAt, new Date())))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // Rolling expiry, written at most once per half-lifetime per session rather
    // than on every request. This is a write during what may be a render, which
    // is why it is guarded: a failure here must cost the session nothing, since
    // the row is already valid and the only thing lost is the extension.
    const remaining = row.expiresAt.getTime() - Date.now();
    if (remaining < RENEW_AFTER_MS) {
      try {
        await tx
          .update(authSession)
          .set({
            expiresAt: new Date(Date.now() + LIFETIME.session),
            lastUsedAt: new Date(),
          })
          .where(eq(authSession.id, row.id));
      } catch {
        // Deliberately silent. See above.
      }
    }

    return { sessionId: row.id, userId: row.userId };
  });
});

/** The signed-in account, or null. Memoized for the render pass alongside the session. */
export const readCurrentUser = cache(async () => {
  const session = await readSession();
  if (!session) return null;

  return withIdentity(
    async (tx) => {
      // Named columns, never `select *`: this object reaches client components,
      // and the table will grow fields that should not.
      const rows = await tx
        .select({
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          locale: userTable.locale,
          imageUrl: userTable.imageUrl,
          emailVerifiedAt: userTable.emailVerifiedAt,
        })
        .from(userTable)
        .where(eq(userTable.id, session.userId))
        .limit(1);

      return rows[0] ?? null;
    },
    { userId: session.userId },
  );
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof readCurrentUser>>>;

/** Ends this session and clears the cookie. Server Actions and Route Handlers only. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;

  if (token) {
    const tokenHash = hashToken(token);
    await withIdentity((tx) => tx.delete(authSession).where(eq(authSession.tokenHash, tokenHash)));
  }

  store.delete(COOKIE);
}

/**
 * Ends every session a user has.
 *
 * Called on password change and on offboarding (§7.12). The point of a database
 * session is that this sentence can be written at all.
 */
export async function endAllSessions(userId: string): Promise<number> {
  return withIdentity(async (tx) => {
    const result = await tx.delete(authSession).where(eq(authSession.userId, userId));
    return result.rowCount ?? 0;
  });
}

/** Sessions past their expiry, across all users. For a future sweep job (slice 9). */
export async function purgeExpiredSessions(): Promise<number> {
  return withIdentity(async (tx) => {
    const result = await tx.delete(authSession).where(sql`${authSession.expiresAt} < now()`);
    return result.rowCount ?? 0;
  });
}
