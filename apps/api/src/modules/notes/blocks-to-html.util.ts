import { NoteBlockType, TableData } from './schemas/note.schema';

/**
 * One-time lazy `blocks[]` → Tiptap HTML conversion (ADR 0009 §3).
 *
 * The mapping is frozen in the ADR and mirrors `notes-pdf.service.ts`
 * semantics (all values escaped):
 *
 *   text     → <p>…</p>, \n → <br>; empty → empty <p>
 *   heading  → <h2>…</h2>                    (blocks have no level)
 *   check    → consecutive run merged into one
 *              <ul data-type="taskList"><li data-type="taskItem" …>
 *   code     → <pre><code class="language-{lang}">…</code></pre>
 *   divider  → <hr>
 *   image    → <img src="{value}">
 *   video    → <p><a href="{value}">{value}</a></p>   (link fallback)
 *   table    → <table><tbody>… (headerRow → first row <th>)
 *   file     → <p>📎 <a href="{API}/files/{fileId}/download">…</a></p>
 *   color    → dropped (accepted loss in v1)
 */

export interface NoteBlockLike {
  type: NoteBlockType;
  value?: string;
  checked?: boolean;
  lang?: string;
  color?: string;
  table?: TableData;
  fileId?: string;
}

const escapeHTML = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Escaped text with literal newlines rendered as Tiptap hardBreaks. */
const escapeWithBreaks = (s: string) =>
  escapeHTML(s).replace(/\r?\n/g, '<br>');

const renderTable = (table?: TableData): string => {
  if (!table || !table.rows || !table.rows.length) return '';
  const headerRow = !!table.headerRow;
  const rows = table.rows
    .map((row, ri) => {
      const cells = row
        .map((cell) => {
          const tag = headerRow && ri === 0 ? 'th' : 'td';
          return `<${tag}><p>${escapeHTML(cell)}</p></${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
};

const renderBlock = (b: NoteBlockLike, apiBase: string): string => {
  const v = b.value ?? '';
  switch (b.type) {
    case 'heading':
      return `<h2>${escapeWithBreaks(v)}</h2>`;
    case 'code': {
      // Class attr, not content — keep it to safe token characters.
      const lang = /^[a-zA-Z0-9#+_-]+$/.test(b.lang ?? '') ? b.lang : '';
      const cls = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${cls}>${escapeHTML(v)}</code></pre>`;
    }
    case 'divider':
      return '<hr>';
    case 'image':
      if (!v) return '';
      return `<img src="${escapeHTML(v)}">`;
    case 'video':
      if (!v) return '';
      return `<p><a href="${escapeHTML(v)}">${escapeHTML(v)}</a></p>`;
    case 'table':
      return renderTable(b.table);
    case 'file': {
      const label = escapeHTML(v || 'File attachment');
      if (!b.fileId) return `<p>📎 ${label}</p>`;
      const href = `${apiBase}/files/${encodeURIComponent(b.fileId)}/download`;
      return `<p>📎 <a href="${escapeHTML(href)}">${label}</a></p>`;
    }
    case 'text':
    default:
      return `<p>${escapeWithBreaks(v)}</p>`;
  }
};

/**
 * Renders a legacy `blocks[]` array to the HTML the collaborative editor
 * seeds from. Consecutive `check` blocks merge into a single task list.
 */
export function blocksToHTML(
  blocks: NoteBlockLike[] | undefined | null,
  apiBase = `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1`,
): string {
  if (!blocks || blocks.length === 0) return '';
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === 'check') {
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === 'check') {
        const c = blocks[i];
        items.push(
          `<li data-type="taskItem" data-checked="${c.checked ? 'true' : 'false'}"><p>${escapeWithBreaks(c.value ?? '')}</p></li>`,
        );
        i += 1;
      }
      out.push(`<ul data-type="taskList">${items.join('')}</ul>`);
      continue;
    }
    const html = renderBlock(b, apiBase);
    if (html) out.push(html);
    i += 1;
  }
  return out.join('');
}
