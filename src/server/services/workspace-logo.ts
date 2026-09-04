import 'server-only';

import { uuidv7 } from 'uuidv7';
import { isLogoType, LOGO_MAX_BYTES } from '@/lib/branding';
import type { ResolvedActor } from '@/server/auth/context';
import { assertCan } from '@/server/authz/policy';
import { objectStore, type UploadTicket } from '@/server/storage/store';
import { updateBranding } from './workspace-settings';

/**
 * §6-7's logo, and why it is not an attachment.
 *
 * It reuses slice 8's storage port — the same two drivers, the same signed PUT,
 * the same rule that **no byte passes through the app server** (§8) — and none
 * of its schema. An `attachment` row belongs to a work item, carries §10's
 * comment permissions, and is soft-deleted so a thread does not close over a
 * removed file; a logo is a property of the company, governed by
 * `workspace.settings`, and has exactly one at a time. Making it an attachment
 * with a null `work_item_id` would have loosened a NOT NULL on the busiest
 * table in the schema to save one column on the quietest.
 *
 * **The two-step upload is slice 8's for slice 8's reason**, so the shape here
 * is deliberately familiar: the ticket is signed for one key with one exact
 * length and type, and the store rejects a PUT that disagrees — the size limit
 * is enforced by the thing receiving the bytes, not by an `if` the bytes never
 * reach. What is different is the second step: there is no `pending` row,
 * because the row this writes is a column on a workspace that already exists.
 * An abandoned upload leaves bytes nothing references and no row at all, which
 * is a smaller mess than the one slice 9 was asked to sweep.
 *
 * The cap is 512 KiB against the attachment's 25 MiB, and the allowlist has
 * three types against nine. A logo renders at 32px in a header on every screen
 * in the product, in a market where data costs money (§2.5); SVG is refused for
 * the reason `src/lib/attachments.ts` refuses it — a document that can carry
 * script, served in development from the app's own origin.
 */

export type LogoProblem = 'too_large' | 'unsupported_type';

export type LogoTicketResult =
  | { ok: true; key: string; upload: UploadTicket }
  | { ok: false; problem: LogoProblem };

/**
 * Where a company's logo lives in the bucket.
 *
 * Workspace-first like `storageKey`, so a prefix listing is one tenant's data.
 * A fresh uuid per upload rather than the workspace id, so replacing a logo
 * cannot be served stale from any cache that saw the old one — the previous
 * object is simply orphaned, which is the same trade slice 8 makes when it
 * lets deleted bytes outlive their row.
 */
function logoKeyFor(workspaceId: string): string {
  return `w/${workspaceId}/brand/${uuidv7()}`;
}

export async function createLogoTicket(
  resolved: ResolvedActor,
  input: { contentType: string; sizeBytes: number },
): Promise<LogoTicketResult> {
  assertCan(resolved.actor, 'workspace.settings');

  const contentType = input.contentType.trim().toLowerCase();
  if (!isLogoType(contentType)) return { ok: false, problem: 'unsupported_type' };
  if (input.sizeBytes > LOGO_MAX_BYTES) return { ok: false, problem: 'too_large' };

  const key = logoKeyFor(resolved.workspace.id);

  return {
    ok: true,
    key,
    upload: objectStore().signUpload({
      key,
      contentType,
      contentLength: input.sizeBytes,
    }),
  };
}

/**
 * Point the workspace at bytes that are now in the store.
 *
 * A thin wrapper over `updateBranding`, and it exists so the route handler has
 * one thing to call and one permission to fail on. The key is re-checked
 * against the workspace's own prefix: the ticket endpoint minted it, but this
 * is a separate request, and a key naming another company's prefix would be a
 * workspace serving a logo it does not own.
 */
export async function confirmLogo(
  resolved: ResolvedActor,
  key: string,
): Promise<{ ok: true } | { ok: false; problem: 'bad_key' }> {
  assertCan(resolved.actor, 'workspace.settings');

  if (!key.startsWith(`w/${resolved.workspace.id}/brand/`)) {
    return { ok: false, problem: 'bad_key' };
  }

  await updateBranding(resolved, { logoKey: key });
  return { ok: true };
}

/**
 * A URL the header can render the logo from.
 *
 * Signed and short-lived like every other download in the product, which means
 * the header re-signs it on each render — cheap (it is a hash, not a round
 * trip) and the reason there is no public bucket to leak. The filename is a
 * constant rather than anything a person typed: nobody downloads a logo, it is
 * only ever an `<img>` source, and `inline` is what makes the browser draw it
 * rather than offer to save it.
 */
export function logoUrl(key: string, contentType = 'image/png'): string {
  return objectStore().signDownload({
    key,
    filename: 'logo',
    contentType,
    disposition: 'inline',
  });
}
