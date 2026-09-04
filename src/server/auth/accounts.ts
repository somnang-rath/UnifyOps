import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { isUniqueViolation } from '@/server/db/errors';
import { withIdentity } from '@/server/db/identity';
import { authCredential, authVerificationToken, user as userTable } from '@/server/db/schema';
import { hashPassword } from './password';
import { hashToken, LIFETIME, mint } from './tokens';

/**
 * Accounts, on the identity connection.
 *
 * Every function here runs before a workspace is known — that is the definition
 * of the set. Anything that happens *inside* a workspace, including reading the
 * same `app_user` rows to render a member list, goes through `withActor` and the
 * membership-scoped policy instead.
 */

/**
 * One normalisation, used by every read and every write.
 *
 * Addresses are stored lower-cased and the unique index is on `lower(email)`,
 * so this is not a nicety: skip it on a write and the same address gets two
 * accounts, skip it on a read and the second one can never sign in.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class EmailTakenError extends Error {
  constructor(readonly email: string) {
    super(`An account already exists for ${email}`);
    this.name = 'EmailTakenError';
  }
}

export type Account = {
  id: string;
  email: string;
  name: string;
  locale: string;
  emailVerifiedAt: Date | null;
  /** Null when the account exists but has no password — an OAuth-only account. */
  passwordHash: string | null;
};

/** The sign-in lookup. Null when there is no such account. */
export async function findAccountByEmail(email: string): Promise<Account | null> {
  const normalized = normalizeEmail(email);

  return withIdentity(async (tx) => {
    const rows = await tx
      .select({
        id: userTable.id,
        email: userTable.email,
        name: userTable.name,
        locale: userTable.locale,
        emailVerifiedAt: userTable.emailVerifiedAt,
        passwordHash: authCredential.passwordHash,
      })
      .from(userTable)
      .leftJoin(authCredential, eq(authCredential.userId, userTable.id))
      .where(and(sql`lower(${userTable.email}) = ${normalized}`, isNull(userTable.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  });
}

export async function findAccountById(userId: string): Promise<Account | null> {
  return withIdentity(
    async (tx) => {
      const rows = await tx
        .select({
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          locale: userTable.locale,
          emailVerifiedAt: userTable.emailVerifiedAt,
          passwordHash: authCredential.passwordHash,
        })
        .from(userTable)
        .leftJoin(authCredential, eq(authCredential.userId, userTable.id))
        .where(eq(userTable.id, userId))
        .limit(1);

      return rows[0] ?? null;
    },
    { userId },
  );
}

/**
 * Creates an account and its password, in one transaction.
 *
 * One transaction because a user row with no credential is an account nobody
 * can sign into and nobody can re-create — the email is taken, and the only fix
 * is a support ticket.
 */
export async function createAccount(input: {
  email: string;
  name: string;
  password: string;
  locale: string;
}): Promise<Account> {
  const email = normalizeEmail(input.email);
  // Hashed outside the transaction: at these parameters it is ~150ms of CPU,
  // and holding a database transaction open across it wastes a connection from
  // a pool of four for the duration.
  const passwordHash = await hashPassword(input.password);

  try {
    return await withIdentity(async (tx) => {
      const inserted = await tx
        .insert(userTable)
        .values({ email, name: input.name.trim(), locale: input.locale })
        .returning({
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          locale: userTable.locale,
          emailVerifiedAt: userTable.emailVerifiedAt,
        });

      const created = inserted[0];
      if (!created) throw new Error('Account insert returned no row');

      await tx.insert(authCredential).values({ userId: created.id, passwordHash });

      return { ...created, passwordHash };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError(email);
    throw error;
  }
}

/** Sets or replaces the password. Callers end the user's other sessions afterwards. */
export async function setPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);

  await withIdentity(
    async (tx) => {
      await tx
        .insert(authCredential)
        .values({ userId, passwordHash })
        .onConflictDoUpdate({
          target: authCredential.userId,
          set: { passwordHash, updatedAt: new Date() },
        });
    },
    { userId },
  );
}

export async function markEmailVerified(userId: string): Promise<void> {
  await withIdentity(
    async (tx) => {
      await tx
        .update(userTable)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(userTable.id, userId), isNull(userTable.emailVerifiedAt)));
    },
    { userId },
  );
}

export type VerificationPurpose = 'email_verification' | 'password_reset';

/**
 * Issues a one-time link, invalidating any earlier unused one for the same
 * purpose.
 *
 * Invalidating matters: without it, "resend the email" leaves two live links,
 * and the one that arrives second is the one the user clicks while the first
 * still opens the account for anyone who has the older message.
 */
export async function issueVerificationToken(
  userId: string,
  purpose: VerificationPurpose,
): Promise<string> {
  const lifetime =
    purpose === 'email_verification' ? LIFETIME.emailVerification : LIFETIME.passwordReset;
  const { token, tokenHash, expiresAt } = mint(lifetime);

  await withIdentity(
    async (tx) => {
      await tx
        .update(authVerificationToken)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(authVerificationToken.userId, userId),
            eq(authVerificationToken.purpose, purpose),
            isNull(authVerificationToken.consumedAt),
          ),
        );

      await tx
        .insert(authVerificationToken)
        .values({ userId, purpose, tokenHash, expiresAt });
    },
    { userId },
  );

  return token;
}

export type TokenOutcome =
  | { ok: true; userId: string }
  /** The three failures are different sentences to a user, so they are different values. */
  | { ok: false; reason: 'unknown' | 'expired' | 'already_used' };

/**
 * Consumes a one-time link.
 *
 * The consuming update is conditional on the token still being unconsumed, and
 * the row count is what decides the outcome — so two tabs racing the same link
 * cannot both succeed. Doing the check as a separate `select` first would leave
 * exactly that window open.
 */
export async function consumeVerificationToken(
  token: string,
  purpose: VerificationPurpose,
): Promise<TokenOutcome> {
  const tokenHash = hashToken(token);

  return withIdentity(async (tx) => {
    const rows = await tx
      .select({
        id: authVerificationToken.id,
        userId: authVerificationToken.userId,
        expiresAt: authVerificationToken.expiresAt,
        consumedAt: authVerificationToken.consumedAt,
      })
      .from(authVerificationToken)
      .where(
        and(
          eq(authVerificationToken.tokenHash, tokenHash),
          eq(authVerificationToken.purpose, purpose),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return { ok: false, reason: 'unknown' } as const;
    if (row.consumedAt) return { ok: false, reason: 'already_used' } as const;
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' } as const;

    const claimed = await tx
      .update(authVerificationToken)
      .set({ consumedAt: new Date() })
      .where(and(eq(authVerificationToken.id, row.id), isNull(authVerificationToken.consumedAt)))
      .returning({ id: authVerificationToken.id });

    if (claimed.length === 0) return { ok: false, reason: 'already_used' } as const;

    return { ok: true, userId: row.userId } as const;
  });
}

/**
 * Checks a one-time link **without** spending it.
 *
 * This exists because a password reset link is followed twice — once by the
 * GET that renders the form, and once by the POST that sets the password — and
 * only the second may consume it. Consuming on the GET would break the flow
 * for anyone whose mail is scanned before they read it: Outlook Safe Links,
 * corporate gateways and most mobile mail clients fetch every URL in a message
 * to preview or vet it, so the person would open a link that had already been
 * spent by their own employer's proxy and be told to request another one, for
 * ever.
 *
 * Email verification consumes on the GET and is right to: there the prefetch
 * *performs* the intended action, and the user arriving second sees a confirmed
 * address. A reset has a second step, so the two cannot share the rule.
 *
 * Nothing is committed here, so this is not a check-then-act race: the POST
 * still consumes conditionally, and remains the only thing that decides.
 */
export async function inspectVerificationToken(
  token: string,
  purpose: VerificationPurpose,
): Promise<TokenOutcome> {
  const tokenHash = hashToken(token);

  return withIdentity(async (tx) => {
    const rows = await tx
      .select({
        userId: authVerificationToken.userId,
        expiresAt: authVerificationToken.expiresAt,
        consumedAt: authVerificationToken.consumedAt,
      })
      .from(authVerificationToken)
      .where(
        and(
          eq(authVerificationToken.tokenHash, tokenHash),
          eq(authVerificationToken.purpose, purpose),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return { ok: false, reason: 'unknown' } as const;
    if (row.consumedAt) return { ok: false, reason: 'already_used' } as const;
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' } as const;

    return { ok: true, userId: row.userId } as const;
  });
}
