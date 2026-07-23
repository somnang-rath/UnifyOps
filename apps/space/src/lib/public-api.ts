import sanitizeHtml from 'sanitize-html';
import type {
  PublicAnchorPayload,
  PublicBoardColumn,
  PublicIssue,
  PublicProject,
  PublicView,
  PublicWikiPage,
} from '@prism/types';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/v1';

// Re-export the payload types so space code has a single import point
// (canonical definitions live in @prism/types — ADR 0012 §6).
export type {
  PublicAnchorPayload,
  PublicBoardColumn,
  PublicIssue,
  PublicProject,
  PublicView,
  PublicWikiPage,
};

/**
 * Resolve a published anchor to its payload (ADR 0012 §5) — a discriminated
 * union over wiki pages, views, and projects. Server-side only.
 * Returns null on 404 (unpublished or non-existent — indistinguishable) so the
 * route can render notFound(); throws on other/network errors.
 */
export async function getPublicPayload(
  anchor: string,
): Promise<PublicAnchorPayload | null> {
  const res = await fetch(
    `${API_URL}/public/anchor/${encodeURIComponent(anchor)}`,
    { cache: 'no-store' },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Public API responded ${res.status}`);
  }
  return (await res.json()) as PublicAnchorPayload;
}

/**
 * Sanitize editor-produced HTML before it is rendered to the public. This is
 * the single security boundary between wiki content and anonymous visitors
 * (ADR 0002 §5) — never render `contentHTML` without passing it through here.
 * Issue payloads (view/project) are plain scalars and never pass through this.
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
