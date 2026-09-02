import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The one place a bearer token is minted or hashed.
 *
 * Three things in slice 3 are bearer credentials — a session cookie, an email
 * verification link, an invitation link — and all three follow the same rule:
 * the value that travels is random, and the value that is stored is its
 * SHA-256. A database read never yields a usable credential, which is what
 * makes a backup, a support query or a leaked dump survivable.
 *
 * SHA-256 rather than scrypt here, deliberately. These tokens are 256 bits of
 * CSPRNG output with no structure to guess, so the slow hashing that protects a
 * human-chosen password buys nothing — and would put ~150ms on the resolution
 * of every single request that carries a cookie.
 */

/** 32 bytes of CSPRNG, base64url. What goes in the cookie or the link. */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What goes in the table. Never the other way round — there is no unhash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The database lookup is an indexed equality on the hash, so this is not on the
 * hot path — it is here for the places that compare two tokens in application
 * code, where `===` would leak the position of the first differing byte.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Milliseconds, for the three lifetimes slice 3 has to name. */
export const LIFETIME = {
  /** §7.10 states 14 days for an invitation, and the copy quotes the number. */
  invitation: 14 * 24 * 60 * 60 * 1000,
  /**
   * Long enough to survive "I'll do it after lunch", short enough that a link
   * sitting in an unattended inbox is not a standing key to the account.
   */
  emailVerification: 24 * 60 * 60 * 1000,
  /**
   * Rolling: extended on use, so an active person is not signed out mid-week
   * while an abandoned session still ages out. See renewSession.
   */
  session: 30 * 24 * 60 * 60 * 1000,
  /** Short by design — a reset link is the strongest credential in the set. */
  passwordReset: 60 * 60 * 1000,
} as const;

/** A token plus the row that will be checked against it. */
export type MintedToken = { token: string; tokenHash: string; expiresAt: Date };

export function mint(lifetimeMs: number, now: Date = new Date()): MintedToken {
  const token = mintToken();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + lifetimeMs),
  };
}
