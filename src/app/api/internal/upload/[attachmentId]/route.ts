import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/server/auth/context';
import { signAttachmentDownload } from '@/server/services/attachments';

/**
 * Reading one attachment back.
 *
 * A redirect, not a proxy. §8's rule that no bytes pass through the app server
 * is as true of a download as of an upload: this handler answers the *question*
 * — may this member read this file, and under what name — and then sends the
 * browser to a URL that is good for a few minutes and for that one object.
 *
 * That is also why it is the `src` of an image preview and the `href` of a
 * download link alike. The alternative, putting a signed store URL into the
 * page, would bake a bearer credential into HTML that is cached, copied and
 * shared, and would expire while the page was still open.
 *
 * `?disp=inline` for a preview, anything else for a download — the difference
 * decides whether a PDF opens or saves, and the store is told which through the
 * signed disposition rather than through markup.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;
  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get('w');

  if (!workspaceSlug) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const signed = await signAttachmentDownload(resolved, {
    attachmentId,
    disposition: url.searchParams.get('disp') === 'inline' ? 'inline' : 'attachment',
  });

  // One 404 for "no such file", "deleted", "still pending" and "in a project
  // you cannot see" — as everywhere else, because telling them apart says what
  // exists.
  if (!signed) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /**
   * `Location` verbatim, rather than `NextResponse.redirect`.
   *
   * R2 signs an absolute URL and the development driver signs a path on this
   * same app, and a `Location` header takes either — a relative one is resolved
   * by the browser against the URL it actually asked for. That is the whole
   * reason not to build an absolute URL here: `request.url` reports the host
   * Next was reached on, which is not reliably the origin the page is on
   * (`localhost` against `127.0.0.1` is enough), and a redirect that crosses
   * origins turns a preview into a CORS failure with no error anyone can see.
   */
  return new NextResponse(null, {
    status: 302,
    headers: {
      location: signed,
      // The signed URL expires in minutes and is minted per request. Caching
      // the redirect would hand a later viewer a link that has either expired
      // or, if it has not, outlives the permission check that produced it.
      'cache-control': 'private, no-store',
    },
  });
}
