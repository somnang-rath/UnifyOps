import { randomBytes } from 'crypto';
import { z } from 'zod';

/**
 * Public-anchor helpers (ADR 0002 §2, ADR 0012 §2).
 *
 * An anchor is the stable public slug that resolves published content in the
 * Space app (`GET /public/anchor/:anchor`). Minted once on first publish and
 * kept across unpublish, so a re-publish yields the same URL forever.
 */

/**
 * Body accepted by every `POST /:id/publish` — wiki, views and projects share
 * it, because "publish" means the same thing for all three and a per-module
 * copy is how three endpoints drift into three shapes.
 *
 * `indexing` omitted leaves the stored value alone: publishing is idempotent
 * (it re-uses the existing anchor), so re-publishing must not silently reset a
 * page the owner had already marked noindex. Only an explicit boolean changes
 * it. A brand-new page defaults to `true` from the schema (docs/plan/01 §3.4).
 */
export const PublishOptionsSchema = z
  .object({
    /** Allow crawlers to index this page. Not an access control. */
    indexing: z.boolean().optional(),
  })
  // The endpoints took no body before this existed, and clients still send
  // none — an absent body must stay a valid publish.
  .default({});
export type PublishOptionsDto = z.infer<typeof PublishOptionsSchema>;

/** Public-slug helper (ADR 0002 §2): `slug(title).slice(0,50)-<8hex>`. */
export const anchorFor = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${slug}-${randomBytes(4).toString('hex')}`;
};

/**
 * The minimal model surface the mint check needs. A Mongoose `Model` satisfies
 * this structurally (`exists` returns a thenable query).
 */
export interface AnchorCollection {
  exists(filter: { anchor: string }): PromiseLike<unknown>;
}

/**
 * Mint an anchor that collides with none of the given collections (ADR 0012
 * §2: wiki + views + projects, so the anchor namespace is effectively global
 * and the public resolver's wiki→view→project order never has to disambiguate
 * in practice). With 8 random hex chars a hit is vanishingly rare, so a few
 * retries suffice; the per-collection partial unique index is the hard
 * backstop — on an `E11000` at save time, callers re-mint once and retry
 * (see {@link isDuplicateAnchorError}).
 */
export async function mintUniqueAnchor(
  title: string,
  collections: AnchorCollection[],
  attempts = 3,
): Promise<string> {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = anchorFor(title);
    const hits = await Promise.all(
      collections.map((c) => c.exists({ anchor: candidate })),
    );
    if (!hits.some(Boolean)) return candidate;
  }
  // Astronomically unlikely; let the unique index be the final arbiter.
  return anchorFor(title);
}

/** True for a Mongo `E11000` duplicate-key error (the anchor index backstop). */
export const isDuplicateAnchorError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === 11000;
