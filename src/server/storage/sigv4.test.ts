import { describe, expect, it } from 'vitest';
import { presign, type S3Credentials } from './sigv4';

/**
 * The known-answer test, and the reason it is worth hand-writing SigV4 at all.
 *
 * AWS publishes a fully worked presigned-URL example — credentials, clock,
 * bucket, key and the exact signature it must produce. Asserting that value
 * checks this implementation against the *specification*; a test that only
 * re-derived the signature with the same code would pass just as happily with
 * the header canonicalisation reversed.
 *
 * The example is virtual-hosted (the bucket is in the host, not the path),
 * which is why `presign` accepts an empty bucket. R2 and MinIO are path style
 * and are covered separately below.
 */
const AWS_EXAMPLE: S3Credentials = {
  endpoint: 'https://examplebucket.s3.amazonaws.com',
  bucket: '',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

const AT = new Date('2013-05-24T00:00:00Z');

describe('presign', () => {
  it("reproduces AWS's published presigned-GET signature", () => {
    const url = presign(AWS_EXAMPLE, {
      method: 'GET',
      key: 'test.txt',
      expiresInSeconds: 86_400,
      now: AT,
    });

    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url).toContain('X-Amz-Date=20130524T000000Z');
    expect(url).toContain('X-Amz-SignedHeaders=host');
    expect(new URL(url).searchParams.get('X-Amz-Signature')).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  /**
   * The R2 shape: path style, and a PUT whose `content-length` and
   * `content-type` are part of the signature.
   *
   * That last part is the whole safety argument for handing an upload URL to a
   * browser. The service decides what size and type it will accept, signs those
   * two headers, and the store then refuses a PUT that disagrees — so the size
   * limit is enforced by the thing receiving the bytes rather than by an
   * `if` the bytes never pass through.
   */
  const R2: S3Credentials = {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'unifyops',
    region: 'auto',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  };

  it('signs the headers a PUT ticket promises, and puts the bucket in the path', () => {
    const url = presign(R2, {
      method: 'PUT',
      key: 'w/abc/att/file.png',
      expiresInSeconds: 300,
      headers: { 'content-type': 'image/png', 'content-length': '1024' },
      now: AT,
    });

    expect(url.startsWith('https://acct.r2.cloudflarestorage.com/unifyops/w/abc/att/file.png?')).toBe(true);
    // Sorted, lowercased, and `host` always present — a signature without it
    // would be valid against any endpoint sharing the credentials.
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host',
    );
    expect(new URL(url).searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
  });

  it('changes the signature when a signed header changes', () => {
    const base = { method: 'PUT', key: 'k', expiresInSeconds: 300, now: AT } as const;
    const small = presign(R2, { ...base, headers: { 'content-length': '10' } });
    const large = presign(R2, { ...base, headers: { 'content-length': '11' } });

    expect(new URL(small).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(large).searchParams.get('X-Amz-Signature'),
    );
  });

  it('escapes a key without escaping its separators', () => {
    const url = presign(R2, {
      method: 'GET',
      key: 'w/a b/ម៉ាន.png',
      expiresInSeconds: 60,
      now: AT,
    });

    // Spaces and Khmer codepoints escaped; the `/` between segments is not,
    // because the store would otherwise be asked for a differently named object.
    expect(url).toContain('/unifyops/w/a%20b/');
    expect(url).not.toContain('%2Fa%20b');
  });

  it('clamps an expiry to the seven days S3 allows', () => {
    const url = presign(R2, {
      method: 'GET',
      key: 'k',
      expiresInSeconds: 60 * 60 * 24 * 30,
      now: AT,
    });

    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('604800');
  });
});
