import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

/**
 * Render wiki markdown to HTML for public consumption.
 *
 * Wiki content is stored as markdown (the Tiptap editor emits
 * `editor.storage.markdown.getMarkdown()`), so the published payload must
 * convert it before it can render — otherwise the raw `#`/`**` shows as text.
 *
 * `html: true` lets any inline HTML the editor emitted pass through; it is NOT
 * a security decision — {@link sanitizePublicHtml} is the single boundary that
 * strips script-bearing markup, and it always runs on this output.
 */
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
})
  // Read-only checkboxes (`- [ ]` / `- [x]`). Rendered disabled — a published
  // page is not interactive. The <input> and its class are allow-listed in
  // sanitize.ts / apps/space public-api.ts.
  .use(taskLists)
  .use(headingIds)
  .use(callouts);

export function markdownToHtml(src: string): string {
  return md.render(src ?? '');
}

/**
 * Slug for a heading — lowercase, spaces→dashes, punctuation dropped. Keeps
 * ASCII word chars and the Khmer block (U+1780–U+17FF) so Khmer headings still
 * get a usable anchor.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\wក-៿\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Give every heading a stable, de-duplicated `id` so a TOC can link to it. */
function headingIds(mdit: MarkdownIt): void {
  mdit.core.ruler.push('heading_ids', (state) => {
    const seen = new Map<string, number>();
    const { tokens } = state;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const inline = tokens[i + 1];
      const base = slugify(inline?.type === 'inline' ? inline.content : '');
      if (!base) continue;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      tokens[i].attrSet('id', n === 0 ? base : `${base}-${n}`);
    }
  });
}

const CALLOUT_TYPES = new Set([
  'note',
  'tip',
  'info',
  'warning',
  'important',
  'caution',
  'danger',
]);

/**
 * GitHub-style callouts: a blockquote whose first line is `[!TYPE]` becomes
 * `<blockquote class="callout callout-<type>">`, with the marker stripped.
 * This is the syntax tiptap-markdown emits for the editor's callout blocks.
 */
function callouts(mdit: MarkdownIt): void {
  mdit.core.ruler.after('inline', 'callouts', (state) => {
    const { tokens } = state;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'blockquote_open') continue;
      // Structure inside a blockquote: paragraph_open, inline, ...
      const inline = tokens[i + 2];
      if (!inline || inline.type !== 'inline') continue;
      const m = /^\[!(\w+)\]\s*/.exec(inline.content);
      if (!m) continue;
      const type = m[1].toLowerCase();
      const cls = CALLOUT_TYPES.has(type) ? type : 'note';
      tokens[i].attrJoin('class', `callout callout-${cls}`);
      // Strip the `[!TYPE]` marker from both the raw content and the parsed
      // child tokens, so it never renders as literal text.
      inline.content = inline.content.slice(m[0].length);
      const firstChild = inline.children?.[0];
      if (firstChild?.type === 'text') {
        firstChild.content = firstChild.content.replace(/^\[!\w+\]\s*/, '');
      }
    }
  });
}
