import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize published HTML before it leaves the API.
 *
 * apps/space sanitizes again before rendering. That duplication is deliberate:
 * the API must not serve script-bearing HTML to *any* consumer (a future
 * embed, an RSS reader, someone curling the anchor), and space must not trust
 * its upstream. Either layer alone is one mistake away from stored XSS.
 * docs/plan/01-security-model.md §3.4.
 *
 * Keep this allowlist in sync with apps/space/src/lib/public-api.ts.
 */
export function sanitizePublicHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'br', 'hr', 'blockquote', 'pre', 'code',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'input',
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
      // Heading anchors (docs TOC), callout + task-list markup.
      h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
      blockquote: ['class'],
      ul: ['class'],
      li: ['class'],
      input: ['type', 'checked', 'disabled'],
    },
    // Class values are constrained to our own callout/task-list names so
    // published content can't pull in arbitrary utility classes.
    allowedClasses: {
      blockquote: [
        'callout', 'callout-note', 'callout-tip', 'callout-info',
        'callout-warning', 'callout-important', 'callout-caution',
        'callout-danger',
      ],
      ul: ['contains-task-list'],
      li: ['task-list-item'],
      input: ['task-list-item-checkbox'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    },
  });
}
