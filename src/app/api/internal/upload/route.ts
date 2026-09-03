import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { createUploadTicket } from '@/server/services/attachments';
import { MAX_ATTACHMENT_BYTES } from '@/lib/attachments';

/**
 * The upload ticket — the third of §8's five deliberate Route Handler
 * exceptions to "Server Actions for everything", and the one §8 names outright
 * (`app/api/internal/  reorder · list · upload`).
 *
 * A route handler rather than a server action because a server action's reply
 * is a revalidation: it rebuilds the route to report a result the page has no
 * way to use. What the browser needs here is a *value* — a URL to send bytes to
 * — before anything on screen changes at all.
 *
 * **This endpoint hands out a credential, so nothing in the body is trusted.**
 * The actor comes from the session cookie; the item, the size and the type are
 * a request. `createUploadTicket` asks §10, applies §4's archived rule and
 * re-runs the same `checkAttachment` the composer ran, then signs a URL scoped
 * to one key with that exact length and type — so the worst a crafted payload
 * buys is an upload the caller's own session already permitted.
 */

const bodySchema = z
  .object({
    workspaceSlug: z.string().min(1),
    workItemId: z.uuid(),
    filename: z.string().min(1).max(400),
    contentType: z.string().min(1).max(200),
    // Bounded here as well as in `checkAttachment`, because this is the number
    // that gets signed into the URL: an absurd value should not reach the
    // signer at all.
    sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  })
  .strict();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const { workspaceSlug, ...input } = parsed.data;

  const resolved = await resolveActorContext(workspaceSlug);
  // The same 404 a page gives, covering "no such workspace" and "not a member"
  // alike — distinguishing them says which company slugs exist.
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const result = await createUploadTicket(resolved, input);

    if (!result.ok) {
      // A problem identifier, never a sentence: an English string returned from
      // the server is the one place Khmer silently degrades (§13). The composer
      // renders it from the message catalogue.
      return NextResponse.json(
        { error: result.problem },
        { status: result.problem === 'not_found' ? 404 : 400 },
      );
    }

    return NextResponse.json({
      attachmentId: result.attachmentId,
      // Sanitized server-side, and returned so the chip shows the name that was
      // actually stored rather than the one that was typed.
      filename: result.filename,
      upload: result.upload,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json(
        { error: error.denial === 'read_only' ? 'read_only' : 'forbidden' },
        { status: 403 },
      );
    }
    throw error;
  }
}
