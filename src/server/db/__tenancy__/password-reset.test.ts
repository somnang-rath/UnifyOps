import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { hashToken, mint, mintToken, LIFETIME } from '@/server/auth/tokens';
import { authSession, authVerificationToken } from '../schema';
import type { SeededWorkspace, TenancyHarness } from './harness';
import { SQLSTATE, failureOf, seedWorkspace, startTenancyHarness } from './harness';

/**
 * The password-reset mechanism, against real Postgres.
 *
 * It is here rather than in the unit suite because every claim below is a claim
 * about a *row*: that consuming is conditional and therefore cannot happen
 * twice, that inspecting leaves the row alone, that ending every session
 * actually empties the table. A fake would assert the design of the fake.
 *
 * Nothing here is about tenancy — a reset happens before a workspace is known,
 * on the identity connection, which is the whole reason that role exists. What
 * this file shares with its neighbours is the harness and the reason for it.
 */

let h: TenancyHarness;
let w: SeededWorkspace;

/**
 * The real modules, imported after the environment points at the harness.
 *
 * `withIdentity` builds its pool from `identityDatabaseUrl()` on first use, and
 * a top-level import would fix that to whatever `.env` holds. Slice 9's digest
 * test does the same thing for the same reason: the point is to exercise the
 * code the app runs, not a re-creation of it.
 */
let accounts: typeof import('@/server/auth/accounts');
let session: typeof import('@/server/auth/session');

beforeAll(async () => {
  h = await startTenancyHarness();
  w = await seedWorkspace(h, 'acme-reset');

  process.env.DATABASE_URL_IDENTITY = h.urls.identity;
  process.env.DATABASE_URL = h.urls.app;

  accounts = await import('@/server/auth/accounts');
  session = await import('@/server/auth/session');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

/** A session row for the seeded owner, as `startSession` would write one. */
async function giveSession(userId: string): Promise<void> {
  await h.identity.insert(authSession).values({
    id: uuidv7(),
    userId,
    tokenHash: hashToken(mintToken()),
    expiresAt: new Date(Date.now() + LIFETIME.session),
  });
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await h.identity
    .select({ id: authSession.id })
    .from(authSession)
    .where(eq(authSession.userId, userId));
  return rows.length;
}

describe('password reset', () => {
  /**
   * Pinned because writing this file found it: the first draft reached for
   * `h.owner` to check a row, the way every other file in this directory does,
   * and got an empty result rather than an error.
   *
   * That is `authTablePolicies` working. The auth tables carry one policy, for
   * the identity role, and `FORCE ROW LEVEL SECURITY` applies it to the owner
   * too — so the role that runs migrations cannot read a session token or a
   * live reset link. Worth an assertion of its own, because the failure mode if
   * it ever regressed is silent: a test that reads zero rows and a support
   * query that reads all of them look identical from here.
   */
  it('hides sessions and reset links from every role but identity', async () => {
    const token = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');
    await giveSession(w.ownerUserId);

    const asOwner = await h.owner
      .select({ id: authVerificationToken.id })
      .from(authVerificationToken)
      .where(eq(authVerificationToken.tokenHash, hashToken(token)));
    expect(asOwner).toEqual([]);

    const sessionsAsOwner = await h.owner
      .select({ id: authSession.id })
      .from(authSession)
      .where(eq(authSession.userId, w.ownerUserId));
    expect(sessionsAsOwner).toEqual([]);

    // The app and operator roles do not get as far as a policy — 0004 revokes
    // the table privileges outright, so this is a hard error rather than an
    // empty read.
    const refused = await failureOf(h.operator.select({ id: authSession.id }).from(authSession));
    expect(refused.code).toBe(SQLSTATE.insufficientPrivilege);

    // And identity, which is the one that must, sees both.
    expect(await sessionCount(w.ownerUserId)).toBeGreaterThan(0);
    await session.endAllSessions(w.ownerUserId);
  });

  it('inspects a link without spending it, however many times', async () => {
    const token = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');

    // Three times, standing in for a mail gateway, a preview pane and the
    // person. This is the assertion the whole `inspectVerificationToken`
    // function exists for, and the one that separates a reset link from a
    // verification link.
    for (let visit = 0; visit < 3; visit += 1) {
      const outcome = await accounts.inspectVerificationToken(token, 'password_reset');
      expect(outcome).toEqual({ ok: true, userId: w.ownerUserId });
    }

    // Still unconsumed in the table, which is the fact the three reads above
    // only imply.
    const rows = await h.identity
      .select({ consumedAt: authVerificationToken.consumedAt })
      .from(authVerificationToken)
      .where(eq(authVerificationToken.tokenHash, hashToken(token)));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.consumedAt).toBeNull();
  });

  it('spends the link exactly once', async () => {
    const token = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');

    const first = await accounts.consumeVerificationToken(token, 'password_reset');
    expect(first).toEqual({ ok: true, userId: w.ownerUserId });

    const second = await accounts.consumeVerificationToken(token, 'password_reset');
    expect(second).toEqual({ ok: false, reason: 'already_used' });

    // And the page that renders the form now refuses to, rather than offering
    // one whose submit would fail.
    const looked = await accounts.inspectVerificationToken(token, 'password_reset');
    expect(looked).toEqual({ ok: false, reason: 'already_used' });
  });

  it('lets only one of two racing tabs through', async () => {
    const token = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');

    // The update is conditional on the row still being unconsumed and the row
    // count is what decides, so this is a real race rather than a rehearsal of
    // one. A check-then-act implementation passes every sequential test above
    // and fails exactly here.
    const outcomes = await Promise.all([
      accounts.consumeVerificationToken(token, 'password_reset'),
      accounts.consumeVerificationToken(token, 'password_reset'),
    ]);

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.ok)).toHaveLength(1);
  });

  it('refuses an expired link, and does not confuse it with an unknown one', async () => {
    const { token, tokenHash } = mint(LIFETIME.passwordReset);

    await h.identity.insert(authVerificationToken).values({
      id: uuidv7(),
      userId: w.ownerUserId,
      purpose: 'password_reset',
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
    });

    // Two different sentences to a person — "that link has expired" is
    // recoverable in one click, "that link is not valid" is not — so they must
    // be two different values here.
    expect(await accounts.inspectVerificationToken(token, 'password_reset')).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(await accounts.inspectVerificationToken('x'.repeat(43), 'password_reset')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('will not open a reset link as a verification link, or the reverse', async () => {
    const reset = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');
    const verify = await accounts.issueVerificationToken(w.ownerUserId, 'email_verification');

    // The purpose is part of the lookup, not a field checked afterwards. Without
    // it, a verification link — 24 hours, sent to every new account — would be a
    // password reset for anyone holding it, which is the longest-lived and most
    // widely distributed credential the product mints.
    expect(await accounts.inspectVerificationToken(reset, 'email_verification')).toEqual({
      ok: false,
      reason: 'unknown',
    });
    expect(await accounts.inspectVerificationToken(verify, 'password_reset')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('issuing a second link kills the first', async () => {
    const first = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');
    const second = await accounts.issueVerificationToken(w.ownerUserId, 'password_reset');

    // Otherwise "send it again" leaves two live links, and the one that arrives
    // second is the one the person clicks while the first still opens the
    // account for anyone holding the older message.
    expect(await accounts.inspectVerificationToken(first, 'password_reset')).toEqual({
      ok: false,
      reason: 'already_used',
    });
    expect(await accounts.inspectVerificationToken(second, 'password_reset')).toEqual({
      ok: true,
      userId: w.ownerUserId,
    });
  });

  it('sets the password and ends every session that was open', async () => {
    // Its own starting point rather than the previous test's, so a failure
    // above cannot arrive here as a wrong count and be read as a defect in
    // `endAllSessions`.
    await session.endAllSessions(w.ownerUserId);
    await session.endAllSessions(w.memberUserId);

    await giveSession(w.ownerUserId);
    await giveSession(w.ownerUserId);
    await giveSession(w.memberUserId);

    expect(await sessionCount(w.ownerUserId)).toBe(2);

    await accounts.setPassword(w.ownerUserId, 'a-long-enough-new-password');
    await session.endAllSessions(w.ownerUserId);

    // A reset is the remedy for an account somebody else is already inside.
    // Leaving their cookie working makes the remedy cosmetic.
    expect(await sessionCount(w.ownerUserId)).toBe(0);

    // And it is that user's sessions, not the table.
    expect(await sessionCount(w.memberUserId)).toBe(1);

    const account = await accounts.findAccountByEmail('owner@acme-reset.test');
    expect(account?.passwordHash).toBeTruthy();
  });
});
