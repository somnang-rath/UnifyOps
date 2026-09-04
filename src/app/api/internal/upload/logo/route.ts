import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LOGO_MAX_BYTES } from '@/lib/branding';
import { resolveActorContext } from '@/server/auth/context';
import { ForbiddenError } from '@/server/authz/policy';
import { confirmLogo, createLogoTicket } from '@/server/services/workspace-logo';

/**
 * §6-7's logo upload — **not a sixth route-handler exception.**
 *
 * §8 reserves five, and `upload` is one of them; this is that exception asked
 * about a different file. It sits beside `blob` and `[attachmentId]` under the
 * same folder for the same reason slice 14 put search under `api/internal` as
 * "the list fetch exception, not a sixth": the concern is identical — hand the
 * browser a URL to send bytes to, before anything on screen changes — and a
 * server action cannot, because its reply is a revalidation rather than a
 * value.
 *
 * **Nothing in the body is trusted.** The actor comes from the session cookie;
 * the type and the size are a request. `createLogoTicket` asks §10 and signs a
 * URL scoped to one key with that exact length and type, so the worst a crafted
 * payload buys is an upload the caller's own session already permitted — and
 * the store rejects a PUT that disagrees with what was signed.
 *
 * The confirm step is a `PUT` on the same path rather than a second folder: it
 * is the other half of one act, and splitting it across two routes would put
 * two §10 checks in two files for one screen.
 */

const ticketSchema = z
  .object({
    workspaceSlug: z.string().min(1),
    contentType: z.string().min(1).max(200),
    // Bounded here as well as in the service, because this is the number that
    // gets signed into the URL: an absurd value should not reach the signer.
    sizeBytes: z.number().int().positive().max(LOGO_MAX_BYTES),
  })
  .strict();

const confirmSchema = z
  .object({
    workspaceSlug: z.string().min(1),
    key: z.string().min(1).max(400),
  })
  .strict();

async function actorFor(workspaceSlug: string) {
  const resolved = await resolveActorContext(workspaceSlug);
  // The same 404 a page gives, covering "no such workspace" and "not a member"
  // alike — distinguishing them says which company slugs exist.
  return resolved;
}

export async function POST(request: Request) {
  const parsed = ticketSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { workspaceSlug, ...input } = parsed.data;
  const resolved = await actorFor(workspaceSlug);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const result = await createLogoTicket(resolved, input);
    if (!result.ok) {
      // A problem identifier, never a sentence: an English string returned from
      // the server is the one place Khmer silently degrades (§13).
      return NextResponse.json({ error: result.problem }, { status: 422 });
    }

    return NextResponse.json({ key: result.key, upload: result.upload });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    throw error;
  }
}

export async function PUT(request: Request) {
  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const resolved = await actorFor(parsed.data.workspaceSlug);
  if (!resolved) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    const result = await confirmLogo(resolved, parsed.data.key);
    if (!result.ok) return NextResponse.json({ error: result.problem }, { status: 422 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    throw error;
  }
}
