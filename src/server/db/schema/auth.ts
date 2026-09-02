import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authTablePolicies, primaryId } from './_shared';
import { user } from './user';

/**
 * Authentication state. Not tenant data, and deliberately not modelled as if
 * it were: a session is resolved from a cookie before anything is known about
 * which workspace the request is for, so none of these tables can carry a
 * `workspace_id` or be protected by the tenant predicate.
 *
 * What protects them instead is the grant. Only `unifyops_identity` reaches
 * them; migration 0004 revokes them from the app role and from the operator,
 * because a support role reading live session tokens would be a way to become
 * any user, and reading password hashes would be a way to become them
 * elsewhere too.
 *
 * §8 names Auth.js v5 for this layer. Slice 3 does not use it: its Credentials
 * provider — which §7.1's email-and-password signup requires — only supports
 * JWT sessions, and §8 also asks for database sessions. Given the two cannot
 * both be had, the session table wins, because a database session is what makes
 * revocation, offboarding (§7.12) and view-as (§7.13) real rows rather than a
 * token we have to wait out. See PLAN.en.md §17.
 */

/**
 * One password per account, in its own table rather than a column on
 * `app_user`.
 *
 * Separate because the blast radii differ: `app_user` is read to render a name
 * and an avatar on every screen, and a hash that travels with it is a hash one
 * careless `select *` away from a log file. Nothing reads this table except
 * the two functions that verify and set a password.
 */
export const authCredential = pgTable(
  'auth_credential',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /**
     * `scrypt$N$r$p$salt$hash`, all base64url. The parameters travel with the
     * hash so raising them later re-hashes on next sign-in instead of locking
     * everyone out — see src/server/auth/password.ts.
     */
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('auth_credential_user_key').on(t.userId), ...authTablePolicies()],
);

/**
 * A database session (§8).
 *
 * The cookie carries a random token; only its SHA-256 hash is stored, so a
 * database read — a backup, a support query, a leaked dump — does not yield a
 * usable session. Hashing rather than encrypting because the lookup is by
 * equality on the hash and nothing ever needs the original back.
 */
export const authSession = pgTable(
  'auth_session',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /**
     * Rolling expiry is computed from this, not from `created_at`, so an active
     * user is not signed out mid-week while an abandoned session still ages
     * out.
     */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_session_token_key').on(t.tokenHash),
    index('auth_session_user_idx').on(t.userId),
    index('auth_session_expires_idx').on(t.expiresAt),
    ...authTablePolicies(),
  ],
);

/**
 * What a one-time link is for. A closed enum, mapped to copy in the message
 * catalogues — no translation key reaches the database (§13).
 */
export const verificationPurpose = pgEnum('verification_purpose', [
  'email_verification',
  'password_reset',
]);

/**
 * One-time links. Same hashing rule as sessions: the token in the email is
 * never the token in the table.
 *
 * `consumed_at` rather than a delete, because "this link was already used" and
 * "this link never existed" are different messages and the second one is the
 * one that makes a user think the product is broken.
 */
export const authVerificationToken = pgTable(
  'auth_verification_token',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    purpose: verificationPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_verification_token_key').on(t.tokenHash),
    index('auth_verification_user_purpose_idx').on(t.userId, t.purpose),
    ...authTablePolicies(),
  ],
);
