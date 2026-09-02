import { describe, expect, it } from 'vitest';
import { DUMMY_HASH_PROMISE, hashPassword, needsRehash, verifyPassword } from './password';

/**
 * The password layer, which has no database in it and so is fully testable here.
 *
 * Slow by design — each case is a real scrypt derivation at the parameters the
 * product ships with. That is worth a few seconds in the unit suite: the value
 * of the parameters is exactly that they are expensive, and a test that skipped
 * them would be testing something else.
 */

describe('hashPassword', () => {
  it('produces a self-describing hash', () => {
    // The parameters travel with the hash, which is what lets them be raised
    // later without locking everyone out.
    return hashPassword('correct horse battery staple').then((hash) => {
      const [scheme, n, r, p, salt, digest] = hash.split('$');
      expect(scheme).toBe('scrypt');
      expect(Number(n)).toBeGreaterThanOrEqual(65536);
      expect(Number(r)).toBe(8);
      expect(Number(p)).toBe(1);
      expect(salt).toBeTruthy();
      expect(digest).toBeTruthy();
    });
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    // Both still verify — the salt is in the hash, not alongside it.
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('a-good-long-password');
    expect(await verifyPassword('a-good-long-password', hash)).toBe(true);
    expect(await verifyPassword('a-good-long-passwore', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('treats Unicode compositions of the same password as equal', async () => {
    // NFC normalisation before hashing. Two keyboards can produce different
    // byte sequences for the same Khmer or accented input, and the person
    // typing has no way to know which one they used the first time.
    const composed = 'café-passphrase';
    const decomposed = 'café-passphrase';
    expect(composed).not.toBe(decomposed);

    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it('returns false rather than throwing on a corrupt hash', async () => {
    // A corrupt row is a failed sign-in, not a 500 that tells the person at
    // the keyboard something interesting about the database.
    for (const bad of ['', 'not-a-hash', 'scrypt$x$8$1$aa$bb', 'bcrypt$1$2$3$4$5']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });
});

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    expect(needsRehash(await hashPassword('current'))).toBe(false);
  });

  it('is true for weaker parameters, so sign-in can upgrade them', () => {
    expect(needsRehash('scrypt$16384$8$1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('is true for anything it cannot parse', () => {
    expect(needsRehash('garbage')).toBe(true);
  });
});

describe('the dummy hash', () => {
  it('is a real hash that no password matches', async () => {
    // It exists so an unknown address costs the same as a wrong password. If it
    // were a constant string, `verifyPassword` would fail to parse it and
    // return early — which is the timing difference it is there to remove.
    const dummy = await DUMMY_HASH_PROMISE;
    expect(dummy.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('', dummy)).toBe(false);
    expect(await verifyPassword('password', dummy)).toBe(false);
  });
});
