import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, query-string form — enough of it to presign one
 * object request against an S3-compatible store (§8: "presigned direct upload;
 * no bytes through the app server").
 *
 * **Written here rather than pulled from the AWS SDK**, for the reason
 * `mailer.ts` calls Resend over `fetch` instead of taking its client: what the
 * product needs from that dependency is one function, and this one is a
 * published algorithm with a published test vector — `sigv4.test.ts` asserts
 * the exact signature AWS documents for its own worked example, so the
 * implementation is checked against the specification rather than against
 * itself. It is also the difference between a lockfile that installs in this
 * repo and one that pulls a transitive tree for a hundred lines of HMAC.
 *
 * Deliberately narrow. There is no chunked upload, no STS session token, no
 * POST policy and no signing of a request body: an S3-compatible PUT and GET
 * of a single object is the whole surface §8 asks for, and every line that is
 * not needed for it is a line that can be wrong without a test noticing.
 */

/** What a store is, as far as signing is concerned. */
export type S3Credentials = {
  /** e.g. `https://<account>.r2.cloudflarestorage.com`. No trailing slash. */
  endpoint: string;
  /** Empty when the endpoint is virtual-hosted and already names the bucket. */
  bucket: string;
  /** R2 accepts (and documents) `auto`; the value still has to enter the scope. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

/**
 * A presigned URL signs headers rather than a body, so the payload hash is the
 * literal `UNSIGNED-PAYLOAD`. This is what lets the browser stream the bytes
 * straight to the store: nothing in the signature depends on their content, and
 * so nothing has to pass through this process to compute it.
 */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value, 'utf8').digest();

/**
 * RFC 3986 escaping, which is *not* what `encodeURIComponent` does: it leaves
 * `!'()*` alone, and S3 rejects a signature computed over a path that escaped
 * them differently from the one it escapes itself.
 */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The object key, escaped for the canonical path.
 *
 * `/` stays a separator — S3 keys are flat strings but the canonical request
 * treats the key as a path, and escaping the separators produces a signature
 * for a different object. Every other reserved character is escaped.
 */
function encodeKey(key: string): string {
  return key.split('/').map(rfc3986).join('/');
}

/** `20130524T000000Z` and `20130524`, which every part of the algorithm needs. */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * The signing key: four nested HMACs, each keyed by the last. The point of the
 * construction is that the key handed to the final signature is scoped to one
 * date, one region and one service, so a leaked signature is useless a day
 * later and against anything else.
 */
function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), SERVICE), 'aws4_request');
}

export type PresignInput = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  key: string;
  /** How long the URL stays usable. Clamped to S3's own seven-day ceiling. */
  expiresInSeconds: number;
  /**
   * Headers the caller promises to send, which become part of the signature.
   *
   * This is how an upload ticket is made safe to hand to a browser: signing
   * `content-length` and `content-type` means the store itself rejects a PUT
   * that is bigger or of a different type than the one the server approved.
   * Validation in the service is then the *first* line rather than the only
   * one — the size limit is enforced by the thing receiving the bytes.
   */
  headers?: Record<string, string>;
  /** Response overrides, e.g. `response-content-disposition` on a download. */
  query?: Record<string, string>;
  /** Injected so the test is a known-answer test rather than a re-derivation. */
  now?: Date;
};

/** S3 refuses anything longer, and so should we, before the store does. */
const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

export function presign(credentials: S3Credentials, input: PresignInput): string {
  const { amzDate, dateStamp } = stamps(input.now ?? new Date());
  const url = new URL(credentials.endpoint);
  const host = url.host;

  /**
   * Path style (`/<bucket>/<key>`) when a bucket is named, and the key alone
   * when it is not — a virtual-hosted endpoint already carries the bucket in
   * its host, and signing it twice produces a signature for `/bucket/bucket/…`.
   * R2 and MinIO both serve path style, which is why it is the default; the
   * other form is what AWS's own worked example uses, and so is what makes the
   * known-answer test in `sigv4.test.ts` possible against real published
   * output rather than against this function's own idea of the algorithm.
   *
   * The key may itself contain `/`, and there those are separators rather than
   * data — `encodeKey` leaves them alone and escapes everything else.
   */
  const canonicalPath = credentials.bucket
    ? `/${rfc3986(credentials.bucket)}/${encodeKey(input.key)}`
    : `/${encodeKey(input.key)}`;

  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`;

  // `host` is always signed: without it a signature is valid against any
  // endpoint that shares the credentials.
  const signedHeaderEntries = Object.entries({ host, ...(input.headers ?? {}) })
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const signedHeaders = signedHeaderEntries.map(([name]) => name).join(';');

  const queryParams: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(Math.max(1, Math.floor(input.expiresInSeconds)), MAX_EXPIRY_SECONDS)),
    'X-Amz-SignedHeaders': signedHeaders,
  };

  // Sorted by the *encoded* name, which is what the canonical form specifies.
  const canonicalQuery = Object.entries(queryParams)
    .map(([name, value]) => [rfc3986(name), rfc3986(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  const canonicalHeaders = signedHeaderEntries
    .map(([name, value]) => `${name}:${value}\n`)
    .join('');

  const canonicalRequest = [
    input.method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const stringToSign = [ALGORITHM, amzDate, scope, sha256(canonicalRequest)].join('\n');

  const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, dateStamp, credentials.region))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `${credentials.endpoint}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
