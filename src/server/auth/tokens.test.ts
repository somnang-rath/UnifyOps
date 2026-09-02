import { describe, expect, it } from 'vitest';
import { hashToken, LIFETIME, mint, mintToken, tokensMatch } from './tokens';

/**
 * The rule this module exists to enforce: the value that travels is never the
 * value that is stored. A session cookie, a verification link and an invitation
 * link are all bearer credentials, and a database dump must not be a pile of
 * them.
 */

describe('mintToken', () => {
  it('produces URL-safe tokens with no repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => mintToken()));
    expect(tokens.size).toBe(500);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries 32 bytes of entropy', () => {
    // base64url of 32 bytes is 43 characters with no padding. Asserted because
    // "shorten the token a bit" is a plausible future edit with no visible
    // consequence until someone enumerates one.
    expect(mintToken()).toHaveLength(43);
  });
});

describe('hashToken', () => {
  it('is deterministic, and is not the token', () => {
    const token = mintToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for tokens that differ by one character', () => {
    expect(hashToken('aaaa')).not.toBe(hashToken('aaab'));
  });
});

describe('tokensMatch', () => {
  it('compares equal digests', () => {
    const digest = hashToken('x');
    expect(tokensMatch(digest, digest)).toBe(true);
  });

  it('refuses different, malformed and empty digests', () => {
    expect(tokensMatch(hashToken('a'), hashToken('b'))).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
    expect(tokensMatch('zz', 'zz')).toBe(false);
  });
});

describe('mint', () => {
  it('returns a token, its hash and an expiry', () => {
    const now = new Date('2026-09-02T00:00:00Z');
    const { token, tokenHash, expiresAt } = mint(LIFETIME.invitation, now);

    expect(tokenHash).toBe(hashToken(token));
    // §7.10 states 14 days for an invitation, and the copy quotes the number.
    expect(expiresAt.getTime() - now.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('uses the lifetimes the copy promises', () => {
    expect(LIFETIME.invitation).toBe(14 * 24 * 60 * 60 * 1000);
    expect(LIFETIME.emailVerification).toBe(24 * 60 * 60 * 1000);
    expect(LIFETIME.session).toBe(30 * 24 * 60 * 60 * 1000);
    // The strongest credential in the set gets the shortest life.
    expect(LIFETIME.passwordReset).toBeLessThan(LIFETIME.emailVerification);
  });
});
