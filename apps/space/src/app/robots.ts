import type { MetadataRoute } from 'next';

/**
 * Published pages are meant to be found — that is the point of the Space — so
 * indexing is allowed by default and can be turned off for the whole instance
 * with SPACE_INDEXING=off (docs/plan/01 §3.4).
 *
 * Per-page control belongs to PublishSettings in Phase 8; until the API exposes
 * it, one instance-wide switch is the honest scope.
 */
export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.SPACE_INDEXING !== 'off';
  const base = process.env.NEXT_PUBLIC_SPACE_URL;

  return {
    rules: indexable
      ? { userAgent: '*', allow: '/' }
      : { userAgent: '*', disallow: '/' },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
