import sanitizeHtml from 'sanitize-html';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/v1';

export interface PublicWikiPage {
  type: 'wiki';
  anchor: string;
  title: string;
  contentHTML: string;
  /** Hotlinked cover URL — the only non-content public field (ADR 0010 §3). */
  coverImage: string | null;
  updatedAt: string;
}

/**
 * Resolve a published page by its public anchor (ADR 0002 §4). Server-side only.
 * Returns null on 404 (unpublished or non-existent — indistinguishable) so the
 * route can render notFound(); throws on other/network errors.
 */
export async function getPublicPage(
  anchor: string,
): Promise<PublicWikiPage | null> {
  const res = await fetch(
    `${API_URL}/public/anchor/${encodeURIComponent(anchor)}`,
    { cache: 'no-store' },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Public API responded ${res.status}`);
  }
  return (await res.json()) as PublicWikiPage;
}

/**
 * Sanitize editor-produced HTML before it is rendered to the public. This is
 * the single security boundary between wiki content and anonymous visitors
 * (ADR 0002 §5) — never render `contentHTML` without passing it through here.
 */
export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li',
      'strong', 'b', 'em', 'i', 's', 'u', 'del', 'mark', 'sub', 'sup',
      'a', 'span', 'img',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      span: ['class', 'data-type', 'data-id', 'data-label'],
      code: ['class'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    // Only safe URL schemes; blocks javascript:/data: on links.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    // Force external links to open safely.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    },
  });
}
