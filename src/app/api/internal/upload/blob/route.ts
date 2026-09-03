import { NextResponse } from 'next/server';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';
import { readLocalObject, writeLocalObject } from '@/server/storage/local-fs';
import { objectStore, verifyLocalUrl } from '@/server/storage/store';

/**
 * The development driver's store, standing in for R2.
 *
 * Reached only when R2 is not configured. It exists so that a laptop with no
 * cloud credentials runs the *whole* of §7.7 — and so that `pnpm test:e2e`
 * drives a real file through the real composer, the real ticket endpoint and
 * the real confirm step, rather than through a mock that would pass while the
 * production path was broken.
 *
 * **It enforces what R2 enforces, by the same means.** A presigned R2 PUT
 * covers `content-length` and `content-type`, so the store itself refuses a
 * body that is bigger or of a different type than the one the service approved.
 * The local URL signs the same two values into its query, and this handler
 * checks them. Getting that wrong would make the development path *more*
 * permissive than production, which is the direction that hides bugs.
 *
 * The `blob` segment is static and sits beside `[attachmentId]`; Next resolves
 * a static segment first, so the two do not collide. It is not an attachment
 * id and never reaches the download handler.
 */

/** Never reachable when a real store is configured — this is not one of two
 * equal paths, it is the fallback, and it should say so with a 404. */
function unavailable() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function PUT(request: Request) {
  if (objectStore().kind !== 'local') return unavailable();

  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';

  // The signature is the whole authorization. It was minted only after
  // `createUploadTicket` asked §10, applied §4 and wrote a row — exactly as an
  // R2 presigned URL is minted, and with exactly the same consequence: the URL
  // is the capability, and no session is consulted here.
  if (!key || !verifyLocalUrl('PUT', url.searchParams)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const declaredLength = Number(url.searchParams.get('len'));
  const declaredType = url.searchParams.get('type');

  const bytes = new Uint8Array(await request.arrayBuffer());

  // Both are signed, so a mismatch means the browser sent something other than
  // what was approved. R2 answers this case with a 403 and so does this.
  if (bytes.byteLength !== declaredLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: 'file_too_large' }, { status: 403 });
  }
  if (declaredType && request.headers.get('content-type') !== declaredType) {
    return NextResponse.json({ error: 'file_type' }, { status: 403 });
  }

  await writeLocalObject(key, bytes);

  return new NextResponse(null, { status: 200 });
}

export async function GET(request: Request) {
  if (objectStore().kind !== 'local') return unavailable();

  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';

  if (!key || !verifyLocalUrl('GET', url.searchParams)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const bytes = await readLocalObject(key);
  if (!bytes) return unavailable();

  const filename = url.searchParams.get('name') ?? 'file';
  const disposition = url.searchParams.get('disp') === 'inline' ? 'inline' : 'attachment';
  // RFC 6266, as `store.ts` builds it for R2: the ASCII fallback plus the UTF-8
  // form, because a Khmer filename has no representation in the plain parameter
  // and a browser given only that saves a row of question marks (§13).
  const ascii = filename.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_');

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': url.searchParams.get('type') ?? 'application/octet-stream',
      'content-disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'content-length': String(bytes.byteLength),
      // A private file behind a URL that expires. Neither a shared cache nor
      // the browser's should keep it after the link stops working.
      'cache-control': 'private, no-store',
      // The bytes are user-supplied. Even with the type allowlist, telling the
      // browser not to re-interpret them is the cheap half of the defence.
      'x-content-type-options': 'nosniff',
    },
  });
}
