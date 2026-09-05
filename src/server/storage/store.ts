import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { attachmentStoreConfig } from '@/env';
import { deleteLocalObject } from './local-fs';
import { presign, type S3Credentials } from './sigv4';

/**
 * Object storage, behind one port — the same shape `mailer.ts` gives email, and
 * for the same reason.
 *
 * §8 chooses **S3-compatible storage with presigned direct upload, so no bytes
 * pass through the app server**, and §18-5 settled which one: **Cloudflare R2**
 * (answered 2026-09-03, alongside §18-6 — there is no data-residency
 * requirement, revisited with the pilot customer). That is the production
 * driver. The other is not a stub:
 *
 *   * **`r2`** — presigned `PUT` and `GET` against an S3 API. The browser talks
 *     to the store directly and this process never sees a byte of the file.
 *   * **`local`** — the development and test driver, chosen when R2 is not
 *     configured. Bytes *do* go through the app server here, written under a
 *     gitignored directory, and that is the one deliberate difference: the
 *     no-bytes rule is about production cost and latency, and a laptop with no
 *     cloud credentials still has to be able to run the whole of §7.7 and have
 *     `pnpm test:e2e` drive a real upload through the real route.
 *
 * Both drivers return the *same* ticket shape, so the browser's upload code is
 * one `fetch(url, { method, headers, body: file })` either way. A driver
 * difference that reached the client would mean the path exercised by the e2e
 * suite was not the path production runs.
 */

/** What the browser is told to do with the bytes. Identical across drivers. */
export type UploadTicket = {
  url: string;
  method: 'PUT';
  /**
   * Sent verbatim. Under R2 these are *signed*, so the store itself rejects a
   * PUT whose length or type differs from the one the service approved — which
   * is what makes an upload URL safe to hand to a browser at all.
   */
  headers: Record<string, string>;
};

export type ObjectStore = {
  /** Which driver answered, so a health check and the tests can say so. */
  kind: 'r2' | 'local';
  signUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): UploadTicket;
  /**
   * A short-lived URL that serves the bytes back under the original filename.
   *
   * `inline` for the images the item page previews, `attachment` for everything
   * else — a PDF opens in the browser, a zip downloads, and neither decision
   * belongs in the markup.
   */
  signDownload(input: {
    key: string;
    filename: string;
    contentType: string;
    disposition: 'inline' | 'attachment';
  }): string;
  /**
   * Remove one object (§20.9's sweeper — slice 18).
   *
   * **The one method on this port that is not a signature**, and the exception
   * is deliberate. §8's rule is that no byte passes through the app server, and
   * every other method here hands the browser a URL so that stays true. A delete
   * moves no bytes: it is a control-plane call with nothing to stream, and the
   * caller is the *worker* rather than a request, so there is no browser to hand
   * anything to. Signing a delete URL for a background job to fetch would be an
   * extra round trip and a short-lived destructive credential in a log.
   *
   * Idempotent by contract: deleting an object that is not there succeeds. The
   * sweeper is at-least-once, so the second pass is the ordinary case.
   */
  deleteObject(key: string): Promise<void>;
};

/**
 * How long an upload URL is good for.
 *
 * Long enough for a 25 MiB file on a slow mobile connection (§2.5-3), short
 * enough that a URL captured from a log is not a standing write grant.
 */
const UPLOAD_TTL_SECONDS = 15 * 60;

/**
 * How long a download URL is good for.
 *
 * Short, and deliberately shorter than the page that embeds it is likely to
 * stay open: a preview URL that leaked would otherwise be a permanent public
 * link to a private file. Ten minutes is long enough to open a PDF and read it,
 * and a reload mints a new one.
 */
const DOWNLOAD_TTL_SECONDS = 10 * 60;

/**
 * RFC 6266 — the ASCII fallback plus the UTF-8 form, because a Khmer filename
 * is not representable in the plain `filename=` parameter and a browser given
 * only that saves the file as a row of question marks (§13).
 */
function contentDisposition(filename: string, disposition: 'inline' | 'attachment'): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function r2Store(credentials: S3Credentials): ObjectStore {
  return {
    kind: 'r2',
    signUpload: (input) => {
      const headers = {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
      };

      return {
        url: presign(credentials, {
          method: 'PUT',
          key: input.key,
          expiresInSeconds: UPLOAD_TTL_SECONDS,
          headers,
        }),
        method: 'PUT',
        headers,
      };
    },

    signDownload: (input) =>
      presign(credentials, {
        method: 'GET',
        key: input.key,
        expiresInSeconds: DOWNLOAD_TTL_SECONDS,
        // Served under the name the person uploaded, not the opaque key.
        query: {
          'response-content-disposition': contentDisposition(input.filename, input.disposition),
          'response-content-type': input.contentType,
        },
      }),

    /**
     * A presigned DELETE, fetched by us rather than handed to anybody.
     *
     * The same `presign` the other two use — the SigV4 implementation
     * `sigv4.test.ts` pins against AWS's own published worked example, which is
     * what makes the absence of `@aws-sdk/*` a decision rather than a shortcut.
     * A very short expiry, because the URL is used within milliseconds of being
     * minted and never leaves this process.
     *
     * **404 is success.** R2 answers a delete of a missing key with 204, and a
     * 404 from a proxy in front of it means the same thing to a sweeper: the
     * bytes are not there, which is the state being aimed at.
     */
    deleteObject: async (key) => {
      const url = presign(credentials, {
        method: 'DELETE',
        key,
        expiresInSeconds: 60,
      });

      const response = await fetch(url, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) {
        throw new Error(`object delete failed: ${response.status}`);
      }
    },
  };
}

/**
 * The development secret, derived rather than configured.
 *
 * The local driver still has to sign its URLs — an unsigned one would let
 * anybody who guessed a key write into another workspace's prefix on a
 * developer's machine, and a development environment that is wrong about
 * tenancy teaches the wrong thing. Deriving it from a credential every process
 * already holds keeps it stable across `next dev`'s render workers and across
 * restarts without adding a required environment variable to a driver that
 * never runs in production.
 */
function localSecret(): string {
  return createHash('sha256')
    .update(`unifyops:attachments:${process.env.DATABASE_URL ?? 'unset'}`)
    .digest('hex');
}

/**
 * Everything the URL says, signed together.
 *
 * The *whole* query is covered, not only the key — which is what lets the local
 * driver enforce the same two things R2 enforces through signed headers. An
 * upload URL carries the exact length and type that were approved; a download
 * URL carries the filename and disposition it must serve under; and neither can
 * be edited in the address bar without invalidating the signature.
 */
function localSignature(method: 'PUT' | 'GET', params: URLSearchParams): string {
  const canonical = [...params.entries()]
    .filter(([name]) => name !== 'sig')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');

  return createHmac('sha256', localSecret())
    .update(`${method}` + String.fromCharCode(10) + canonical)
    .digest('hex');
}

/**
 * **Relative, deliberately.** The local driver is this same app, so the browser
 * reaches it same-origin and an absolute URL would only be a way to get the
 * origin wrong — which is exactly what happened the first time this was built
 * against `NEXT_PUBLIC_APP_URL`: the e2e server listens on 3100, `.env` says
 * 3000, and every upload failed against a port with nothing on it. A relative
 * URL cannot be wrong about where this app is.
 *
 * R2's URLs are absolute because R2 is somewhere else. The one caller that
 * needs an absolute form — the download redirect — resolves it against the
 * incoming request, which is the only source that is always right.
 */
export function signLocalUrl(
  method: 'PUT' | 'GET',
  key: string,
  ttlSeconds: number,
  extra: Record<string, string> = {},
): string {
  // A base is required to parse, and is dropped again below; nothing about it
  // reaches the returned value.
  const url = new URL('/api/internal/upload/blob', 'http://localhost');
  url.searchParams.set('key', key);
  url.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + ttlSeconds));
  for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
  url.searchParams.set('sig', localSignature(method, url.searchParams));

  return `${url.pathname}${url.search}`;
}

/** Constant-time, and expiry-checked. Used only by the local driver's route. */
export function verifyLocalUrl(method: 'PUT' | 'GET', params: URLSearchParams): boolean {
  const expires = Number(params.get('exp'));
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;

  const expected = Buffer.from(localSignature(method, params), 'hex');
  const given = Buffer.from(params.get('sig') ?? '', 'hex');

  return expected.length === given.length && timingSafeEqual(expected, given);
}

function localStore(): ObjectStore {
  return {
    kind: 'local',
    signUpload: (input) => ({
      url: signLocalUrl('PUT', input.key, UPLOAD_TTL_SECONDS, {
        // Signed, exactly as R2 signs the matching headers. The receiving route
        // refuses a body that is not this long or not this type, so the local
        // path enforces what production enforces rather than trusting a browser
        // to send what it said it would.
        len: String(input.contentLength),
        type: input.contentType,
      }),
      method: 'PUT',
      headers: { 'content-type': input.contentType },
    }),

    signDownload: (input) =>
      signLocalUrl('GET', input.key, DOWNLOAD_TTL_SECONDS, {
        // Served back as headers by the route. Signed for the reason R2's
        // `response-content-disposition` is part of its signature: a filename a
        // viewer can rewrite is a filename the product does not control.
        name: input.filename,
        type: input.contentType,
        disp: input.disposition,
      }),

    // No URL and no route: the development driver's bytes are a file on this
    // machine, so the sweeper unlinks it directly. The asymmetry with the upload
    // and download paths is the same one slice 8 already accepted — bytes *do*
    // pass through the app server here, and that is the one deliberate
    // difference between the drivers.
    deleteObject: (key) => deleteLocalObject(key),
  };
}

/**
 * The store this deployment uses.
 *
 * Not memoized: `attachmentStoreConfig` is four `process.env` reads and a Zod
 * parse, and a module-level cache is how a test that sets the environment ends
 * up asserting against the driver a previous test picked.
 */
export function objectStore(): ObjectStore {
  const configured = attachmentStoreConfig();
  return configured ? r2Store(configured) : localStore();
}
