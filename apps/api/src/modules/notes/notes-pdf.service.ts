import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { Note, NoteBlockType, TableData } from './schemas/note.schema';

interface NoteBlockLike {
  type: NoteBlockType;
  value?: string;
  checked?: boolean;
  lang?: string;
  color?: string;
  table?: TableData;
  fileId?: string;
}

const sanitizeColor = (c?: string) => {
  if (!c) return '';
  // accept hex (#abc, #aabbcc) or simple named colors with no quotes/parens
  return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(c) ? c : '';
};

const escapeHTML = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

@Injectable()
export class NotesPdfService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  async onModuleInit() {
    // Lazy launch on first request to keep cold start fast in dev
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launching) return this.launching;
    this.launching = puppeteer
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .then((b) => {
        this.browser = b;
        this.launching = null;
        b.on('disconnected', () => {
          this.browser = null;
        });
        return b;
      })
      .catch((err) => {
        this.launching = null;
        throw err;
      });
    return this.launching;
  }

  async render(note: Note): Promise<Buffer> {
    const html = this.buildHTML(note);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '18mm',
          bottom: '20mm',
          left: '18mm',
        },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => {});
    }
  }

  private buildHTML(note: Note): string {
    const title = escapeHTML(note.title || 'Untitled');
    const emoji = escapeHTML(note.emoji || '📄');
    const tags = (note.tags || []).map(escapeHTML);
    // ADR 0009 §4: once migrated, contentHTML (kept fresh by the collab
    // snapshot path) is authoritative — blocks[] is a frozen archival copy.
    const body =
      note.migratedToDoc && note.contentHTML
        ? note.contentHTML
        : (note.blocks || [])
            .map((b) => this.renderBlock(b as NoteBlockLike))
            .join('\n');

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1f2937;
    font-size: 12pt;
    line-height: 1.6;
  }
  .head { display: flex; align-items: center; gap: 12px; margin: 0 0 4px 0; }
  .head .emoji { font-size: 28pt; line-height: 1; }
  .head h1 { font-size: 22pt; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
  .tags { margin: 0 0 16px 0; }
  .tag {
    display: inline-block; font-size: 9pt; padding: 2px 8px; border-radius: 999px;
    background: #eef2ff; color: #4338ca; margin-right: 4px;
  }
  hr.sep { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
  h2.block-h { font-size: 16pt; font-weight: 700; margin: 14pt 0 6pt; line-height: 1.3; }
  p.block-p { margin: 4pt 0; white-space: pre-wrap; }
  .check { display: flex; gap: 8px; align-items: flex-start; margin: 3pt 0; }
  .check .box {
    flex: 0 0 12pt; width: 12pt; height: 12pt;
    border: 1.5px solid #6b7280; border-radius: 2pt; margin-top: 3pt;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 9pt; color: #1f2937;
  }
  .check.done .box { background: #6366f1; border-color: #6366f1; color: #fff; }
  .check.done .text { text-decoration: line-through; color: #9ca3af; }
  pre.code {
    background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 6px;
    padding: 10pt 12pt; font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 10pt; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    margin: 6pt 0;
  }
  hr.divider { border: none; border-top: 1px solid #d1d5db; margin: 10pt 0; }
  img.note-img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 6pt; margin: 6pt 0; }
  .video-fallback {
    display: block; font-size: 10pt; color: #4338ca; word-break: break-all; margin: 6pt 0;
  }
  table.note-table {
    width: 100%; border-collapse: collapse; margin: 8pt 0; font-size: 11pt;
  }
  table.note-table th, table.note-table td {
    border: 1px solid #e5e7eb; padding: 6pt 8pt; text-align: left; vertical-align: top;
  }
  table.note-table th { background: #f9fafb; font-weight: 600; }
</style>
</head>
<body>
  <div class="head"><span class="emoji">${emoji}</span><h1>${title}</h1></div>
  ${
    tags.length
      ? `<div class="tags">${tags.map((t) => `<span class="tag">#${t}</span>`).join('')}</div>`
      : ''
  }
  <hr class="sep" />
  ${body}
</body>
</html>`;
  }

  private renderBlock(b: NoteBlockLike): string {
    const v = b.value ?? '';
    const color = sanitizeColor(b.color);
    const styleAttr = color ? ` style="color:${color}"` : '';
    switch (b.type) {
      case 'heading':
        return `<h2 class="block-h"${styleAttr}>${escapeHTML(v)}</h2>`;
      case 'check':
        return `<div class="check ${b.checked ? 'done' : ''}"${styleAttr}><span class="box">${b.checked ? '✓' : ''}</span><span class="text">${escapeHTML(v)}</span></div>`;
      case 'code':
        return `<pre class="code"${styleAttr}>${escapeHTML(v)}</pre>`;
      case 'divider':
        return `<hr class="divider" />`;
      case 'image':
        if (!v) return '';
        return `<img class="note-img" src="${escapeHTML(v)}" alt="" />`;
      case 'video':
        if (!v) return '';
        return `<a class="video-fallback" href="${escapeHTML(v)}">▶ ${escapeHTML(v)}</a>`;
      case 'table':
        return this.renderTable(b.table, color);
      case 'file':
        return `<p class="block-p">📎 <strong>${escapeHTML(v || 'File attachment')}</strong></p>`;
      case 'text':
      default:
        if (!v) return `<p class="block-p">&nbsp;</p>`;
        return `<p class="block-p"${styleAttr}>${escapeHTML(v)}</p>`;
    }
  }

  private renderTable(table?: TableData, color = ''): string {
    if (!table || !table.rows || !table.rows.length) return '';
    const headerRow = !!table.headerRow;
    const styleAttr = color ? ` style="color:${color}"` : '';
    const rows = table.rows
      .map((row, ri) => {
        const cells = row
          .map((cell) => {
            const isHeader = headerRow && ri === 0;
            const tag = isHeader ? 'th' : 'td';
            return `<${tag}>${escapeHTML(cell)}</${tag}>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    return `<table class="note-table"${styleAttr}><tbody>${rows}</tbody></table>`;
  }
}
