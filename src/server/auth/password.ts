import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * `promisify` picks the three-argument overload, which drops the options
 * object — and the options object is where the cost parameters live, so the
 * inferred signature is the one shape of this call we can never use.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing, on `node:crypto` and nothing else.
 *
 * scrypt rather than bcrypt or argon2 because both of those are native modules:
 * a compiler on the build host, a prebuilt binary per platform, and a rebuild
 * every Node major. scrypt is in the standard library, is memory-hard, and is
 * the recommendation of RFC 9106's own "if you cannot have argon2" paragraph.
 * The cost of the choice is that it has one knob fewer, which the parameters
 * below spend deliberately.
 *
 * §8 names Auth.js v5 for the auth layer. Slice 3 does not use it — see
 * src/server/db/schema/auth.ts for why, and PLAN.en.md §17 for the record.
 */

/**
 * OWASP's 2024 floor for scrypt is N=2^17, r=8, p=1. This is 2^16, which halves
 * both the memory and the time.
 *
 * Deliberate, and the reason is the deployment shape (§8): one Node container
 * serving every request, where password verification is *synchronous work on
 * the same event loop as every render*. 2^17 costs ~256MB and ~350ms per
 * verification; a handful of concurrent sign-ins would stall the whole process.
 * 2^16 is ~128MB and ~150ms, which is still far above the point where offline
 * cracking is economic against a per-password salt.
 *
 * These travel with each hash, so raising them later re-hashes on next sign-in
 * rather than locking everyone out.
 */
type ScryptParams = { N: number; r: number; p: number };

const PARAMS: ScryptParams = { N: 65536, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Node's default 32MB scrypt budget is below what these parameters need
 * (128 * N * r ≈ 67MB), and the failure is an opaque throw at hash time rather
 * than anything that names the cause.
 */
const MAX_MEMORY = 192 * 1024 * 1024;

const b64 = (buffer: Buffer) => buffer.toString('base64url');

async function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // Unicode normalisation before hashing: "សុភា" typed with a different
  // composition sequence is the same password to the person typing it, and
  // NFC is what makes the bytes agree. This matters more here than in an
  // ASCII-only product (§13).
  const normalized = password.normalize('NFC');
  return scrypt(normalized, salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAX_MEMORY,
  });
}

/** `scrypt$N$r$p$salt$hash`, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${b64(salt)}$${b64(hash)}`;
}

type Parsed = { params: ScryptParams; salt: Buffer; hash: Buffer };

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  const [scheme, n, r, p, salt, hash] = parts;
  if (parts.length !== 6 || scheme !== 'scrypt') return null;
  if (n === undefined || r === undefined || p === undefined) return null;
  if (salt === undefined || hash === undefined) return null;

  const params: ScryptParams = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return null;
  }

  return {
    params,
    salt: Buffer.from(salt, 'base64url'),
    hash: Buffer.from(hash, 'base64url'),
  };
}

/**
 * Whether `password` produced `stored`.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row is a
 * failed sign-in, not a 500 that tells the person at the keyboard something
 * interesting about the database.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  try {
    const candidate = await derive(password, parsed.salt, parsed.params);
    if (candidate.length !== parsed.hash.length) return false;
    return timingSafeEqual(candidate, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was made with weaker parameters than the current ones.
 *
 * Checked on successful sign-in, which is the only moment the plaintext exists
 * to re-hash with. Without this the parameters above can only ever be raised
 * for accounts created afterwards.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return (
    parsed.params.N < PARAMS.N || parsed.params.r < PARAMS.r || parsed.params.p < PARAMS.p
  );
}

/**
 * The dummy hash a sign-in attempt for an unknown address is checked against.
 *
 * Without it, "no such account" returns in a millisecond and "wrong password"
 * takes 150ms, and the difference enumerates every address in the product.
 * Built once at module load, so the cost is paid at boot rather than on the
 * first attack.
 */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(32).toString('base64url'));
