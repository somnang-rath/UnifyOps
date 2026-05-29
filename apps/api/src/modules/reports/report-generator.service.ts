import { Injectable, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { ReportTemplate, ReportElement, ReportPage, ReportHeader, ReportFooter, HFSection } from './schemas/report-template.schema';
import { WidgetData } from './report-data.service';

// ── Text datasource live-fetch helpers ────────────────────────────────────────

function extractAtPath(data: unknown, path: string): Record<string, unknown>[] {
  if (!path) return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const parts = path.split('.');
  let cur: unknown = data;
  for (let i = 0; i < parts.length; i++) {
    if (Array.isArray(cur)) {
      const rest = parts.slice(i).join('.');
      return (cur as Record<string, unknown>[]).flatMap((item) => {
        const children = extractAtPath(item, rest);
        const parent: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          if (k !== parts[i] && !Array.isArray(v)) parent[k] = v;
        }
        return children.map((c) => ({ ...parent, ...c }));
      });
    }
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[parts[i]];
    else return [];
  }
  return Array.isArray(cur) ? (cur as Record<string, unknown>[]) : [];
}

function getVal(row: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.')) return row[key];
  const parts = key.split('.');
  let cur: unknown = row;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function renderRowTpl(tpl: string, row: Record<string, unknown>): string {
  return tpl.replace(/\{([^|}]+)(\|round)?\}/g, (match, key, mod) => {
    const val = getVal(row, key.trim());
    if (val == null) return match;
    if (mod === '|round') {
      const n = typeof val === 'number' ? val : parseFloat(String(val));
      if (!isNaN(n)) return String(Math.round(n));
    }
    return String(val);
  });
}

function applyMainTpl(tpl: string, value: string, firstRow?: Record<string, unknown>): string {
  let result = tpl.replace(/\{value\d*\}/g, value).replace(/\{value\}/g, value);
  if (firstRow) {
    result = result.replace(/\{([^|}]+)(\|round)?\}/g, (match, key, mod) => {
      if (key === 'value' || /^value\d+$/.test(key)) return match;
      const val = getVal(firstRow, key.trim());
      if (val == null) return match;
      if (mod === '|round') {
        const n = typeof val === 'number' ? val : parseFloat(String(val));
        if (!isNaN(n)) return String(Math.round(n));
      }
      return String(val);
    });
  }
  return result;
}

async function resolveTextDatasources(elements: ReportElement[]): Promise<ReportElement[]> {
  return Promise.all(
    elements.map(async (el) => {
      if (el.type !== 'text') return el;
      const p = el.props as Record<string, unknown>;
      const ds = p.textDataSource as Record<string, unknown> | undefined;
      if (!ds?.url) return el;

      let resolved = p.content as string ?? '';
      try {
        const res = await fetch(String(ds.url), {
          method: String(ds.method ?? 'GET'),
          headers: { 'Content-Type': 'application/json', ...(ds.headers as Record<string, string> ?? {}) },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return el;
        const data = await res.json();
        const rows = extractAtPath(data, String(ds.dataPath ?? ''));
        if (!rows.length) return el;

        const joinMode = !!ds.joinMode;
        const mainTpl  = String(ds.template ?? '{value}');

        if (joinMode) {
          const rowTpl   = String(ds.joinRowTemplate ?? '');
          const sep      = String(ds.joinSeparator ?? ', ');
          if (rowTpl.trim()) {
            const joined = rows.map((r) => renderRowTpl(rowTpl, r)).join(sep);
            resolved = applyMainTpl(mainTpl, joined, rows[0]);
          }
        } else {
          const aggDefs = (ds.aggDefs as { fieldKey: string; aggregation: string }[] | undefined) ?? [];
          const active  = aggDefs.filter((d) => d.fieldKey);
          if (!active.length) return el;
          const values = active.map(({ fieldKey, aggregation }) => {
            const nums = rows.map((r) => parseFloat(String(getVal(r, fieldKey) ?? 0))).filter((n) => !isNaN(n));
            if (!nums.length) return 0;
            switch (aggregation) {
              case 'sum':   return nums.reduce((a, b) => a + b, 0);
              case 'avg':   return nums.reduce((a, b) => a + b, 0) / nums.length;
              case 'min':   return Math.min(...nums);
              case 'max':   return Math.max(...nums);
              case 'count': return nums.length;
              default:      return getVal(rows[0], fieldKey) ?? 0;
            }
          });
          let tpl = mainTpl;
          values.forEach((v, i) => { tpl = tpl.replace(new RegExp(`\\{value${i}\\}`, 'g'), String(v)); });
          tpl = tpl.replace(/\{value\}/g, String(values[0] ?? ''));
          resolved = applyMainTpl(tpl, String(values[0] ?? ''), rows[0]);
        }
      } catch { /* use stored content on error */ }

      return { ...el, props: { ...p, content: resolved } };
    }),
  );
}

const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  A3: { w: 1123, h: 1587 },
};

const escapeHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// CSS variable names set by next/font → actual Google Fonts family name
const CSS_VAR_FONT_MAP: Record<string, string> = {
  '--font-koh-santepheap': 'Koh Santepheap',
  '--font-khmer':          'Kantumruy Pro',
};

// Strip "var(--xxx), " prefixes that Next.js next/font injects — Puppeteer has no CSS vars
function normalizeFont(ff: string): string {
  return ff.replace(/var\([^)]+\),?\s*/g, '').trim();
}

// Scan all elements and return <link> tags for any web fonts that need to be loaded.
// Noto Sans Khmer is always included so Khmer text in titles/labels renders correctly.
function collectFontLinks(template: ReportTemplate): string {
  const families = new Set<string>(['Noto Sans Khmer:wght@400;600;700']);
  for (const el of template.elements ?? []) {
    const ff = ((el.props as Record<string, unknown>)?.fontFamily as string | undefined);
    if (!ff) continue;
    const match = ff.match(/var\((--[\w-]+)\)/);
    if (match) {
      const family = CSS_VAR_FONT_MAP[match[1]];
      if (family) families.add(family);
    }
  }
  const query = [...families].map((f) => `family=${f.replace(/ /g, '+')}`).join('&');
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?${query}&display=swap" rel="stylesheet">`;
}

@Injectable()
export class ReportGeneratorService implements OnModuleDestroy {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

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
      .launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
      .then((b) => {
        this.browser = b;
        this.launching = null;
        return b;
      });
    return this.launching;
  }

  async generatePdf(
    template: ReportTemplate,
    allData: Record<string, WidgetData>,
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      const ps = PAGE_SIZES[template.pageSize] ?? PAGE_SIZES.A4;
      const { w, h } =
        template.orientation === 'landscape' ? { w: ps.h, h: ps.w } : ps;

      // Set the viewport to exactly the page width so there is no horizontal
      // scrollbar / layout reflow. Height is set to one page; Puppeteer handles
      // multi-page documents via CSS break-after:page.
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });

      const resolvedElements = await resolveTextDatasources(template.elements ?? []);
      const liveTemplate = { ...template, elements: resolvedElements } as ReportTemplate;
      const html = buildHtml(liveTemplate, allData, w, h, collectFontLinks(template));
      await page.setContent(html, { waitUntil: 'load' });
      // Wait for all fonts (including Google Fonts / Noto Sans Khmer) to finish loading
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => document.fonts.check('12px "Noto Sans Khmer"'),
        { timeout: 8000 },
      ).catch(() => { /* timeout is fine — render with fallback font */ });

      const pdf = await page.pdf({
        printBackground: true,
        // Margins in the canvas editor are purely visual guides (dashed border overlay).
        // Elements are positioned absolutely from (0,0) within the full page dimensions.
        // Passing template margins here would shift every element and clip edge content.
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: true,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

// ── Header / footer HTML builders ─────────────────────────────────────────────

function fmtDate(fmt: string | undefined): string {
  const now = new Date();
  if (fmt === 'short')      return now.toLocaleDateString();
  if (fmt === 'month-year') return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  if (fmt === 'year')       return String(now.getFullYear());
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function resolvePageNumberText(section: HFSection, pageIndex: number, totalPages: number): string {
  if (section.pageNumberTemplate) {
    return section.pageNumberTemplate
      .replace(/\{n\}/g, String(pageIndex + 1))
      .replace(/\{total\}/g, String(totalPages));
  }
  const fmt = section.pageNumberFormat ?? 'x-of-y';
  return fmt === 'page-x' ? `Page ${pageIndex + 1}`
    : fmt === 'x-of-y'   ? `${pageIndex + 1} of ${totalPages}`
    : String(pageIndex + 1);
}

function buildHFSectionHtml(
  section: HFSection | undefined,
  pageIndex: number,
  totalPages: number,
  justify: 'flex-start' | 'center' | 'flex-end',
): string {
  const wrap = `flex:1;display:flex;justify-content:${justify};align-items:center;overflow:hidden;min-width:0;`;
  if (!section || section.type === 'empty') return `<div style="${wrap}"></div>`;

  const fs  = section.fontSize ?? 12;
  const fw  = section.bold      ? 700 : 400;
  const fi  = section.italic    ? 'italic' : 'normal';
  const td  = section.underline ? 'underline' : 'none';
  const col = escapeHtml(section.color ?? '#111111');
  const spanStyle = `font-size:${fs}px;font-weight:${fw};font-style:${fi};text-decoration:${td};color:${col};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;

  if (section.type === 'text') {
    return `<div style="${wrap}"><span style="${spanStyle}">${escapeHtml(section.text ?? '')}</span></div>`;
  }
  if (section.type === 'image' && section.imageUrl) {
    const h   = section.imageHeight ?? 32;
    const fit = section.imageFit ?? 'contain';
    return `<div style="${wrap}"><img src="${escapeHtml(section.imageUrl)}" alt="" style="height:${h}px;max-width:100%;object-fit:${fit};" /></div>`;
  }
  if (section.type === 'page-number') {
    return `<div style="${wrap}"><span style="${spanStyle}">${resolvePageNumberText(section, pageIndex, totalPages)}</span></div>`;
  }
  if (section.type === 'date') {
    return `<div style="${wrap}"><span style="${spanStyle}">${fmtDate(section.dateFormat)}</span></div>`;
  }
  return `<div style="${wrap}"></div>`;
}

function hasSections(hf: { left?: HFSection; center?: HFSection; right?: HFSection }): boolean {
  return !!(hf.left || hf.center || hf.right);
}

function shouldShowHF(hf: { showOn?: string; skipPages?: number[] }, pgIdx: number): boolean {
  if (hf.showOn === 'except-first') return pgIdx > 0;
  if (hf.showOn === 'custom')       return !(hf.skipPages ?? []).includes(pgIdx);
  return true;
}

function buildHeaderHtml(header: ReportHeader, w: number, pageIndex: number, totalPages: number): string {
  const pad    = header.padding ?? 12;
  const border = header.borderBottom
    ? `border-bottom:${header.borderWidth ?? 1}px solid ${escapeHtml(header.borderColor ?? '#e5e7eb')};`
    : '';
  const base = `position:absolute;top:0;left:0;width:${w}px;height:${header.height}px;background:${escapeHtml(header.background)};${border}display:flex;align-items:center;padding:0 ${pad}px;overflow:hidden;z-index:9000;gap:8px;`;

  if (hasSections(header)) {
    const left   = buildHFSectionHtml(header.left,   pageIndex, totalPages, 'flex-start');
    const center = buildHFSectionHtml(header.center, pageIndex, totalPages, 'center');
    const right  = buildHFSectionHtml(header.right,  pageIndex, totalPages, 'flex-end');
    return `<div style="${base}">${left}${center}${right}</div>`;
  }

  // Legacy flat rendering
  const fw = header.bold ? '700' : '400';
  const content = escapeHtml(header.content ?? '');
  return `<div style="${base}"><span style="width:100%;font-size:${header.fontSize ?? 12}px;font-weight:${fw};color:${escapeHtml(header.color ?? '#111111')};text-align:${header.align ?? 'left'};white-space:pre-wrap;overflow:hidden;">${content}</span></div>`;
}

function buildFooterHtml(footer: ReportFooter, w: number, pageIndex: number, totalPages: number): string {
  const pad    = footer.padding ?? 12;
  const border = footer.borderTop
    ? `border-top:${footer.borderWidth ?? 1}px solid ${escapeHtml(footer.borderColor ?? '#e5e7eb')};`
    : '';
  const base = `position:absolute;bottom:0;left:0;width:${w}px;height:${footer.height}px;background:${escapeHtml(footer.background)};${border}display:flex;align-items:center;padding:0 ${pad}px;overflow:hidden;z-index:9000;gap:8px;`;

  if (hasSections(footer)) {
    const left   = buildHFSectionHtml(footer.left,   pageIndex, totalPages, 'flex-start');
    const center = buildHFSectionHtml(footer.center, pageIndex, totalPages, 'center');
    const right  = buildHFSectionHtml(footer.right,  pageIndex, totalPages, 'flex-end');
    return `<div style="${base}">${left}${center}${right}</div>`;
  }

  // Legacy flat rendering
  const fw = footer.bold ? '700' : '400';
  const content = escapeHtml(footer.content ?? '');
  let pageNumText = '';
  if (footer.showPageNumber) {
    if (footer.pageNumberFormat === 'page-x') pageNumText = `Page ${pageIndex + 1}`;
    else if (footer.pageNumberFormat === 'x-of-y') pageNumText = `${pageIndex + 1} of ${totalPages}`;
    else pageNumText = String(pageIndex + 1);
  }
  const sameAlign = footer.align === footer.pageNumberAlign;
  if (sameAlign || !footer.showPageNumber) {
    const text = [content, pageNumText].filter(Boolean).join('  ');
    return `<div style="${base}"><span style="width:100%;font-size:${footer.fontSize ?? 11}px;font-weight:${fw};color:${escapeHtml(footer.color ?? '#6b7280')};text-align:${footer.align ?? 'left'};white-space:nowrap;overflow:hidden;">${text}</span></div>`;
  }
  const cs = `flex:1;font-size:${footer.fontSize ?? 11}px;font-weight:${fw};color:${escapeHtml(footer.color ?? '#6b7280')};text-align:${footer.align ?? 'left'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  const ps = `flex:none;font-size:${footer.fontSize ?? 11}px;font-weight:${fw};color:${escapeHtml(footer.color ?? '#6b7280')};white-space:nowrap;`;
  const children = footer.pageNumberAlign === 'right'
    ? `<span style="${cs}">${content}</span><span style="${ps}">${pageNumText}</span>`
    : `<span style="${ps}">${pageNumText}</span><span style="${cs}">${content}</span>`;
  return `<div style="${base}">${children}</div>`;
}

// ── Main HTML builder ─────────────────────────────────────────────────────────

function buildHtml(
  template: ReportTemplate,
  allData: Record<string, WidgetData>,
  w: number,
  h: number,
  fontLinks = '',
): string {
  const tpl = template as ReportTemplate & {
    pages?: ReportPage[];
    header?: ReportHeader;
    footer?: ReportFooter;
  };
  const pages: ReportPage[] = tpl.pages?.length ? tpl.pages : [{ id: 'page-0' }];
  const totalPages = pages.length;

  const headerEnabled = tpl.header?.enabled;
  const footerEnabled = tpl.footer?.enabled;

  const pagesHtml = pages
    .map((pg, idx) => {
      const bg = pg.background || template.background || '#ffffff';
      const elements = (template.elements ?? [])
        .filter((el) => (el.page ?? 0) === idx)
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((el) => renderElement(el, allData, idx, totalPages))
        .join('\n');
      const headerHtml = headerEnabled && shouldShowHF(tpl.header!, idx) ? buildHeaderHtml(tpl.header!, w, idx, totalPages) : '';
      const footerHtml = footerEnabled && shouldShowHF(tpl.footer!, idx) ? buildFooterHtml(tpl.footer!, w, idx, totalPages) : '';
      return `<div class="page" style="background:${escapeHtml(bg)};">${elements}${headerHtml}${footerHtml}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
${fontLinks}
<style>
  @page { size: ${w}px ${h}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${w}px; background: transparent; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'Noto Sans Khmer', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
  .page { width: ${w}px; height: ${h}px; position: relative; overflow: hidden; break-after: page; }
  .el { position: absolute; overflow: hidden; }
  .el-text { font-size: 14px; color: #111; white-space: pre-wrap; }
  .el-heading { font-size: 28px; font-weight: 700; color: #111; }
  .widget-card { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .widget-value { font-size: 42px; font-weight: 700; color: #4f46e5; }
  .widget-label { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .data-table th { padding: 6px 8px; text-align: left; border: 1px solid #e5e7eb; font-weight: 600; }
  .data-table td { padding: 6px 8px; border: 1px solid #e5e7eb; }
  .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: #4f46e5; border-radius: 4px; }
  .page-number-el { font-size: 12px; color: #9ca3af; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Build inline border/background/shadow CSS for chart and data-widget elements.
// Mirrors the makeWidgetStyle / makeChartStyle functions in the designer components.
function borderWrapStyle(p: Record<string, unknown>): string {
  const sides  = (p.borderSides as string[] | undefined) ?? ['top', 'right', 'bottom', 'left'];
  const bColor = escapeHtml((p.borderColor as string)  ?? '#e5e7eb');
  const bWidth = (p.borderWidth as number)  ?? 1;
  const bStyle = escapeHtml((p.borderStyle as string)  ?? 'solid');
  const bStr   = `${bWidth}px ${bStyle} ${bColor}`;
  const bt = sides.includes('top')    ? `border-top:${bStr};`    : '';
  const br = sides.includes('right')  ? `border-right:${bStr};`  : '';
  const bb = sides.includes('bottom') ? `border-bottom:${bStr};` : '';
  const bl = sides.includes('left')   ? `border-left:${bStr};`   : '';
  const radius  = `border-radius:${(p.borderRadius as number) ?? 8}px;`;
  const bg      = `background:${escapeHtml((p.background as string) || '#ffffff')};`;
  const shadow  = p.shadow ? 'box-shadow:0 4px 6px -1px rgba(0,0,0,.12),0 2px 4px -2px rgba(0,0,0,.08);' : '';
  // opacity stored as 0-1 float
  const opacity = p.opacity !== undefined ? `opacity:${p.opacity as number};` : '';
  const px = (p.paddingX as number) ?? 0;
  const py = (p.paddingY as number) ?? 0;
  const pad = `padding:${py}px ${px}px;`;
  return `${bt}${br}${bb}${bl}${radius}${bg}${shadow}${opacity}${pad}`;
}

// ---------------------------------------------------------------------------
// Element renderers
// ---------------------------------------------------------------------------

function renderElement(
  el: ReportElement,
  allData: Record<string, WidgetData>,
  pageIndex: number,
  totalPages: number,
): string {
  const p = el.props as Record<string, unknown>;
  const base = `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;transform:rotate(${el.rotation ?? 0}deg);z-index:${el.zIndex ?? 0};`;

  switch (el.type) {
    case 'text': {
      const fs = (p.fontSize as number) ?? 14;
      const fw = p.bold ? '700' : '400';
      const fi = p.italic ? 'italic' : 'normal';
      const td = p.underline ? 'underline' : 'none';
      const color = (p.color as string) ?? '#111111';
      const align = (p.textAlign as string) ?? 'left';
      const lh = `line-height:${p.lineHeight ?? 1.5};`;
      const ls = p.letterSpacing ? `letter-spacing:${p.letterSpacing}px;` : '';
      const ff = p.fontFamily ? `font-family:${escapeHtml(normalizeFont(p.fontFamily as string))};` : '';
      const bg = p.background ? `background:${escapeHtml(p.background as string)};` : '';
      const px = p.paddingX ? `padding-left:${p.paddingX}px;padding-right:${p.paddingX}px;` : '';
      const py = p.paddingY ? `padding-top:${p.paddingY}px;padding-bottom:${p.paddingY}px;` : '';
      // word-break:break-word matches canvas ElementText overflow:hidden + wordBreak:'break-word'
      return `<div class="el el-text" style="${base}${lh}${ls}${ff}${bg}${px}${py}font-size:${fs}px;font-weight:${fw};font-style:${fi};text-decoration:${td};color:${escapeHtml(color)};text-align:${align};word-break:break-word;">${escapeHtml(p.content ?? '')}</div>`;
    }

    case 'heading': {
      const fs = (p.fontSize as number) ?? 28;
      const fw = p.bold === false ? '400' : '700';
      const fi = p.italic ? 'italic' : 'normal';
      const td = p.underline ? 'underline' : 'none';
      const color = (p.color as string) ?? '#111111';
      const align = (p.textAlign as string) ?? 'left';
      const lh = `line-height:${p.lineHeight ?? 1.2};`;
      const ls = p.letterSpacing ? `letter-spacing:${p.letterSpacing}px;` : '';
      const ff = p.fontFamily ? `font-family:${escapeHtml(normalizeFont(p.fontFamily as string))};` : '';
      const bg = p.background ? `background:${escapeHtml(p.background as string)};` : '';
      const px = p.paddingX ? `padding-left:${p.paddingX}px;padding-right:${p.paddingX}px;` : '';
      const py = p.paddingY ? `padding-top:${p.paddingY}px;padding-bottom:${p.paddingY}px;` : '';
      return `<div class="el el-heading" style="${base}${lh}${ls}${ff}${bg}${px}${py}font-size:${fs}px;font-weight:${fw};font-style:${fi};text-decoration:${td};color:${escapeHtml(color)};text-align:${align};white-space:pre-wrap;word-break:break-word;">${escapeHtml(p.content ?? '')}</div>`;
    }

    case 'image': {
      const src = escapeHtml(p.src ?? '');
      const fit = (p.objectFit as string) ?? 'cover';
      const radius = p.borderRadius ? `border-radius:${p.borderRadius}px;` : '';
      // opacity is stored as 0..1 float — do NOT divide by 100
      const opacity = p.opacity !== undefined ? `opacity:${p.opacity as number};` : '';
      const border = p.border
        ? `border:${(p.borderWidth as number) ?? 2}px solid ${escapeHtml((p.borderColor as string) ?? '#e5e7eb')};`
        : '';
      const caption = p.caption
        ? `<div style="font-size:11px;color:#6b7280;background:#f9fafb;padding:4px 6px;border-top:1px solid #e5e7eb;text-align:center;flex-shrink:0;">${escapeHtml(p.caption as string)}</div>`
        : '';
      const imgStyle = `width:100%;${caption ? 'flex:1;min-height:0;' : 'height:100%;'}object-fit:${fit};display:block;`;
      return `<div class="el" style="${base}${radius}${border}${opacity}display:flex;flex-direction:column;overflow:hidden;"><img src="${src}" style="${imgStyle}" />${caption}</div>`;
    }

    case 'divider': {
      const color = escapeHtml((p.color as string) ?? '#e5e7eb');
      const thickness = (p.thickness as number) ?? 1;
      const divStyle = (p.style as string) ?? 'solid';
      const label = p.label ? escapeHtml(p.label as string) : '';
      // Solid lines: height+background (matches canvas). Dashed/dotted: border-top.
      const lineHtml = divStyle === 'solid'
        ? `<div style="flex:1;height:${thickness}px;background:${color};"></div>`
        : `<div style="flex:1;height:0;border-top:${thickness}px ${divStyle} ${color};"></div>`;
      if (label) {
        return `<div class="el" style="${base}display:flex;align-items:center;gap:12px;">
          ${lineHtml}
          <span style="font-size:11px;font-weight:500;color:${color};white-space:nowrap;flex-shrink:0;">${label}</span>
          ${lineHtml}
        </div>`;
      }
      return `<div class="el" style="${base}display:flex;align-items:center;">${lineHtml}</div>`;
    }

    case 'shape': {
      const fill = escapeHtml((p.fill as string) ?? '#6366f1');
      // opacity stored as 0-1 float (NOT 0-100) — do NOT divide by 100
      const opacity     = p.opacity !== undefined ? `opacity:${p.opacity as number};` : '';
      // prop stored as p.stroke (not p.strokeColor) — matches element-shape.tsx
      const strokeColor = escapeHtml((p.stroke as string) ?? 'transparent');
      const strokeWidth = (p.strokeWidth as number) ?? 0;

      // Line shape — horizontal bar
      if (p.shape === 'line') {
        const lineH = strokeWidth > 0 ? strokeWidth : 2;
        const lineBg = p.gradient
          ? `linear-gradient(to right,${fill},${escapeHtml((p.gradientEnd as string) ?? '#a855f7')})`
          : fill;
        return `<div class="el" style="${base}${opacity}display:flex;align-items:center;">
          <div style="width:100%;height:${lineH}px;background:${lineBg};border-radius:${lineH}px;"></div>
        </div>`;
      }

      // Triangle — SVG, no gradient support (matches designer)
      if (p.shape === 'triangle') {
        const strokeAttr = strokeWidth > 0
          ? `stroke="${strokeColor}" stroke-width="${strokeWidth}"`
          : 'stroke="none"';
        return `<div class="el" style="${base}${opacity}">
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points="50,2 98,98 2,98" fill="${fill}" ${strokeAttr} />
          </svg>
        </div>`;
      }

      // Rect / Circle
      // use !== undefined so borderRadius:0 (sharp corners) is respected
      const radius = p.shape === 'circle' ? '50%'
        : p.borderRadius !== undefined ? `${p.borderRadius}px`
        : '4px';

      let background: string;
      if (p.gradient) {
        // prop stored as p.gradientDir (not p.gradientDirection) — matches element-shape.tsx
        const dir = escapeHtml((p.gradientDir as string) ?? 'to right');
        const end = escapeHtml((p.gradientEnd as string) ?? '#a855f7');
        background = `linear-gradient(${dir},${fill},${end})`;
      } else {
        background = fill;
      }

      const strokeStyle = strokeWidth > 0 ? `border:${strokeWidth}px solid ${strokeColor};` : '';
      // Canvas uses a fill-tinted shadow: color-mix(in srgb, fill 45%, transparent)
      // Approximate with a semi-transparent version of the fill color via box-shadow
      const shadow = p.shadow ? `box-shadow:0 6px 24px ${fill}73;` : '';

      return `<div class="el" style="${base}${opacity}">
        <div style="width:100%;height:100%;background:${background};border-radius:${radius};${strokeStyle}${shadow}"></div>
      </div>`;
    }

    case 'progress-bar': {
      const value      = (p.value as number) ?? 0;
      const maxValue   = (p.maxValue as number) ?? 100;
      const pct        = Math.min(100, Math.max(0, maxValue > 0 ? (value / maxValue) * 100 : 0));
      const color      = escapeHtml((p.color as string) ?? '#6366f1');
      // Default track color matches canvas: light gray close to bg-subtle
      const trackColor = escapeHtml((p.trackColor as string) ?? '#e8eaed');
      const barH       = (p.barHeight as number) ?? 12;
      const rounded    = p.rounded !== false;
      const radius     = rounded ? barH / 2 : 2;
      const fs         = (p.fontSize as number) ?? 11;
      const ff         = p.fontFamily ? `font-family:${escapeHtml(normalizeFont(p.fontFamily as string))};` : '';
      const bg         = p.background ? `background:${escapeHtml(p.background as string)};` : '';
      // Default label color matches canvas var(--text-sub) ≈ #374151 in light mode
      const labelColor = escapeHtml((p.labelColor as string) ?? '#374151');
      const label      = p.label !== undefined ? escapeHtml(String(p.label || 'Progress')) : null;
      const showValue  = !!p.showValue;

      // gap:6px between label row and track matches canvas `gap: 6`
      const labelRow = (label !== null || showValue)
        ? `<div style="display:flex;justify-content:space-between;align-items:center;font-size:${fs}px;line-height:1;${ff}">
            ${label !== null ? `<span style="color:${labelColor};font-weight:500;">${label}</span>` : '<span></span>'}
            ${showValue ? `<span style="color:${color};font-weight:700;margin-left:auto;">${Math.round(pct)}%</span>` : ''}
           </div>`
        : '';

      return `<div class="el" style="${base}${bg}${ff}display:flex;flex-direction:column;justify-content:center;gap:6px;padding:6px 10px;">
        ${labelRow}
        <div style="width:100%;height:${barH}px;background:${trackColor};border-radius:${radius}px;overflow:hidden;flex-shrink:0;">
          <div style="width:${pct}%;height:100%;background:${color};border-radius:${radius}px;"></div>
        </div>
      </div>`;
    }

    case 'page-number': {
      const color = escapeHtml((p.color as string) ?? '#9ca3af');
      // Match canvas: default 11px, align stored as p.align (not p.textAlign)
      const fs    = (p.fontSize as number) ?? 11;
      const align = (p.align as string) ?? (p.textAlign as string) ?? 'center';
      const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
      // Match canvas format prop: 'page' → "Page N", 'slash' → "N / N", 'number' → "N"
      const fmt   = (p.format as string) ?? 'page';
      const pn    = pageIndex + 1;
      const label = fmt === 'slash'  ? `${pn} / ${totalPages}`
                  : fmt === 'number' ? String(pn)
                  : `Page ${pn}`;
      return `<div class="el" style="${base}font-size:${fs}px;color:${color};display:flex;align-items:center;justify-content:${justify};">${label}</div>`;
    }

    case 'data-widget': {
      const widgetType = p.widgetType as string;
      const data = allData[widgetType];
      return `<div class="el" style="${base}${borderWrapStyle(p)}overflow:hidden;display:flex;flex-direction:column;">${renderWidgetHtml(data, p)}</div>`;
    }

    case 'chart': {
      const widgetType = p.widgetType as string;
      const data = allData[widgetType];
      return `<div class="el" style="${base}${borderWrapStyle(p)}overflow:hidden;display:flex;flex-direction:column;">${renderChartHtml(data, p)}</div>`;
    }

    case 'table': {
      const cols: string[] = (p.columns as string[]) ?? [];
      const allRows: Record<string, string>[] = (p.rows as Record<string, string>[]) ?? [];
      const startRow = Math.max(0, (p.startRow as number) ?? 0);
      const endRow   = p.endRow as number | undefined;
      const rows     = allRows.slice(startRow, endRow);

      // Default colors mirror the canvas element-table.tsx defaults exactly:
      //  headerBg   → var(--bg-subtle)  ≈ #f3f4f6
      //  headerColor→ var(--text-sub)   ≈ #374151  (was wrongly #111111)
      //  borderColor→ var(--border)     ≈ #e5e7eb
      const headerBg    = escapeHtml((p.headerBg as string) ?? '#f3f4f6');
      const headerColor = escapeHtml((p.headerColor as string) ?? '#374151');
      const borderColor = escapeHtml((p.borderColor as string) ?? '#e5e7eb');
      const borderStyle = escapeHtml((p.borderStyle as string) ?? 'solid');
      const fs          = (p.fontSize as number) ?? 12;
      const hFs         = (p.headerFontSize as number) ?? fs;
      const hFw         = escapeHtml((p.headerFontWeight as string) ?? '600');
      const hTT         = escapeHtml((p.headerTextTransform as string) ?? 'none');
      const hTA         = escapeHtml((p.headerTextAlign as string) ?? '');  // '' = per-column fallback
      const hPy         = (p.headerPaddingY as number) ?? 8;
      const cellPx      = (p.cellPaddingX as number) ?? 12;
      const cellPy      = (p.cellPaddingY as number) ?? 6;
      const showColB    = p.showColBorders !== false;
      const showRowB    = p.showRowBorders !== false;
      const outerB      = !!p.outerBorder;
      const isCont      = !!p.isContinuation;
      const showRowNums = !!p.showRowNumbers;
      const rowNumLabel = escapeHtml((p.rowNumberLabel as string) ?? '#');
      const colWidths   = (p.colWidths as Record<string, number> | undefined) ?? {};

      // Row-fill stretching — mirrors element-table.tsx so canvas and PDF match.
      //
      // Apply to BOTH original and continuation auto-paginated tables:
      //   • Original page  : el.h = full page; rows must fill it.
      //   • Continuation   : el.h = estimated content height (set by auto-layout);
      //                      rows should still fill it so the element has no blank gap.
      //
      // Heights subtracted from el.h before dividing:
      //   tableHeaderH  — thead row (hPy×2 + hFs + 2)
      //   urlBarH       — "datasource URL" badge (22 px, only when dataSource is set)
      //   contBadgeH    — "↩ Continued from previous page" badge (20 px, cont pages only)
      //
      // Note: the 24 px overflow-indicator bar present in the canvas editor is NOT
      //       rendered in the PDF, so we do NOT subtract it here.
      const urlBarH    = p.dataSource ? 22 : 0;
      const contBadgeH = isCont ? 20 : 0;
      const tableHeaderH = hPy * 2 + hFs + 2;
      const availTbodyH  = el.h - tableHeaderH - urlBarH - contBadgeH;
      // perRowH > 0 → each <tr> gets an explicit height. Browser treats it as min-height
      // so rows with taller content (e.g. wrapped text) still grow freely.
      const isAutoPage  = !!(p.autoPageBreak as boolean | undefined);
      // Cap row height so filtered data (few rows) never produces giant empty cells.
      const MAX_ROW_H = 72;
      const perRowH = (isAutoPage && rows.length > 0 && availTbodyH > 0)
        ? Math.min(MAX_ROW_H, Math.floor(availTbodyH / rows.length))
        : 0;

      // All auto-paginated tables (original + continuation) use the element's fixed
      // height so row-stretching fills the space correctly. Previously continuation
      // tables used height:auto which caused the PDF to differ from the canvas.
      const tableBase = base;

      const contBadge = isCont
        ? `<div style="padding:2px 8px;background:rgba(99,102,241,0.08);border-bottom:1px dashed #6366f1;font-size:9px;color:#6366f1;font-weight:600;">&#8617; Continued from previous page</div>`
        : '';

      // Header bottom border — matches element-table.tsx logic
      const headerBottomBorder = p.headerBottomBorder
        ? `2px solid ${escapeHtml((p.headerBottomBorderColor as string) ?? borderColor)}`
        : showRowB ? `1px ${borderStyle} ${borderColor}` : 'none';

      // <colgroup> for column widths (percentages, same as canvas table)
      const colgroupCols = [
        showRowNums ? `<col style="width:36px"/>` : '',
        ...cols.map((c) => colWidths[c] != null ? `<col style="width:${colWidths[c]}%"/>` : '<col/>'),
      ].join('');
      const colgroup = `<colgroup>${colgroupCols}</colgroup>`;

      // Row-number header cell
      const rowNumTh = showRowNums
        ? `<th style="background:${headerBg};color:${headerColor};padding:${hPy}px ${cellPx}px;font-size:${hFs}px;font-weight:${hFw};text-transform:${hTT};text-align:center;${showColB ? `border-right:1px ${borderStyle} ${borderColor};` : ''}border-bottom:${headerBottomBorder};white-space:nowrap;">${rowNumLabel}</th>`
        : '';

      const thead = rowNumTh + cols.map((c, ci) => {
        const colAlign = hTA || escapeHtml(((p.colAligns as Record<string, string>)?.[c]) ?? 'left');
        const bdrRight = showColB && ci < cols.length - 1 ? `border-right:1px ${borderStyle} ${borderColor};` : '';
        return `<th style="background:${headerBg};color:${headerColor};padding:${hPy}px ${cellPx}px;font-size:${hFs}px;font-weight:${hFw};text-transform:${hTT};text-align:${colAlign};vertical-align:top;${bdrRight}border-bottom:${headerBottomBorder};white-space:nowrap;">${escapeHtml(c)}</th>`;
      }).join('');

      const tbody = rows.map((r, i) => {
        const globalI    = startRow + i;
        const isStripe   = !!(p.stripedRows && i % 2 === 1);
        const isTotalRow = !!(p.showTotalRow && globalI === allRows.length - 1);
        let rowBg = (p.rowBg as string) ?? 'transparent';
        if (isTotalRow && p.totalRowBg) rowBg = escapeHtml(p.totalRowBg as string);
        else if (isStripe)              rowBg = (p.rowAltBg as string) ?? '#f9fafb';
        const rowFw = isTotalRow && p.totalRowBold !== false ? 'font-weight:bold;' : '';
        const rowFg = isTotalRow && p.totalRowColor ? `color:${escapeHtml(p.totalRowColor as string)};` : '';

        // Row-number cell
        const rowNumTd = showRowNums
          ? `<td style="padding:${cellPy}px ${cellPx}px;${showColB ? `border-right:1px ${borderStyle} ${borderColor};` : ''}${showRowB && i < rows.length - 1 ? `border-bottom:1px ${borderStyle} ${borderColor};` : ''}text-align:center;color:#6b7280;">${globalI + 1}</td>`
          : '';

        const cells = cols.map((c, ci) => {
          const val      = r[c] ?? '';
          const align    = escapeHtml(((p.colAligns as Record<string, string>)?.[c]) ?? 'left');
          const colBg    = (p.colBgs as Record<string, string>)?.[c];
          const isStatus = (p.statusColumns as string[] | undefined)?.includes(c);
          const cellBdr  = showColB && ci < cols.length - 1 ? `border-right:1px ${borderStyle} ${borderColor};` : '';
          const rowBdrB  = showRowB && i < rows.length - 1 ? `border-bottom:1px ${borderStyle} ${borderColor};` : '';
          let cellContent = escapeHtml(val);
          if (isStatus && val) {
            const statusColors = p.statusColors as Record<string, string> | undefined;
            const explicit = statusColors?.[val];
            const lower = val.toLowerCase();
            let bg = '#6b7280';
            if (explicit) bg = explicit;
            else if (lower.includes('active') || lower.includes('done') || lower.includes('complete') || lower.includes('success')) bg = '#84cc16';
            else if (lower.includes('dormant') || lower.includes('error') || lower.includes('fail') || lower.includes('inactive') || lower.includes('closed')) bg = '#ef4444';
            else if (lower.includes('pending') || lower.includes('waiting') || lower.includes('connected') || lower.includes('partial')) bg = '#94a3b8';
            else if (lower.includes('progress') || lower.includes('draft') || lower.includes('review')) bg = '#f59e0b';
            cellContent = `<span style="display:inline-block;background:${bg};color:#fff;padding:2px 10px;border-radius:4px;font-weight:600;white-space:nowrap;font-size:0.9em;">${escapeHtml(val)}</span>`;
          }
          return `<td style="padding:${cellPy}px ${cellPx}px;text-align:${align};vertical-align:top;${colBg ? `background:${escapeHtml(colBg)};` : ''}${cellBdr}${rowBdrB}">${cellContent}</td>`;
        }).join('');

        const trH = perRowH > 0 ? `height:${perRowH}px;` : '';
        return `<tr style="background:${escapeHtml(rowBg)};${rowFw}${rowFg}${trH}">${rowNumTd}${cells}</tr>`;
      }).join('');

      const outerStyle = outerB ? `border:1px ${borderStyle} ${borderColor};border-radius:4px;` : '';
      const ff = p.fontFamily ? `font-family:${escapeHtml(normalizeFont(p.fontFamily as string))};` : '';
      // When row-stretching is active, set height:100% on the table so it fills
      // the flex container and Puppeteer distributes the explicit tr heights correctly.
      const tableHeightStyle = perRowH > 0 ? 'height:100%;' : '';
      return `<div class="el" style="${tableBase}${outerStyle}${ff}overflow:hidden;display:flex;flex-direction:column;">${contBadge}<table style="width:100%;${tableHeightStyle}border-collapse:collapse;font-size:${fs}px;${ff}">${colgroup}<thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
    }

    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Widget / chart HTML
// ---------------------------------------------------------------------------

// Shared helper: series progress-bar rows — matches canvas ElementDataWidget series layout
function renderSeriesBars(series: { name: string; value: number; color?: string }[], accent: string, title: string, padH = 10): string {
  const total = series.reduce((s, d) => s + d.value, 0);
  const rows = series.map((s) => {
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">
        <span style="color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name)}</span>
        <span style="color:#6b7280;font-variant-numeric:tabular-nums;flex-shrink:0;margin-left:8px;">${escapeHtml(String(s.value))} <span style="opacity:0.6;">(${pct}%)</span></span>
      </div>
      <div style="height:8px;background:#e8eaed;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${escapeHtml(s.color ?? accent)};border-radius:4px;"></div>
      </div>
    </div>`;
  }).join('');
  return `<div style="width:100%;padding:${padH}px 10px;display:flex;flex-direction:column;gap:8px;">
    ${title ? `<div style="font-size:12px;font-weight:600;color:#111;margin-bottom:2px;">${title}</div>` : ''}
    ${rows}
  </div>`;
}

// Shared helper: KPI big-number card — matches canvas ElementDataWidget KPI layout
// label is placed ABOVE the value, same as canvas
function renderKpiCard(
  value: string | number | undefined,
  label: string | undefined,
  accent: string,
  trend?: number,
  trendLabel?: string,
): string {
  const val   = value !== undefined ? escapeHtml(String(value)) : undefined;
  const lbl   = label ? escapeHtml(label) : undefined;
  if (!val && !lbl) return '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;">No data</div>';
  const isPos = (trend ?? 0) >= 0;
  const arrow = isPos ? '↑' : '↓';
  const trendColor = isPos ? '#22c55e' : '#ef4444';
  const trendHtml = trend !== undefined
    ? `<div style="display:flex;align-items:center;gap:3px;font-size:10px;font-weight:600;color:${trendColor};margin-top:2px;">
        <span>${arrow}${isPos ? '+' : ''}${trend}</span>
        ${trendLabel ? `<span style="font-weight:400;color:#9ca3af;">${escapeHtml(trendLabel)}</span>` : ''}
      </div>`
    : '';
  return `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:12px;text-align:center;">
    ${lbl ? `<div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">${lbl}</div>` : ''}
    ${val !== undefined ? `<div style="font-size:40px;font-weight:700;color:${accent};line-height:1;">${val}</div>` : ''}
    ${trendHtml}
  </div>`;
}

function renderWidgetHtml(data: WidgetData | undefined, p: Record<string, unknown>): string {
  const accent = (p.colorScheme as string) ?? '#6366f1';
  const padX   = (p.paddingX as number) ?? 10;
  const padY   = (p.paddingY as number) ?? 10;

  // ── User-defined standalone KPI (no widgetType, no dataSource) ──────────────
  // This matches the canvas branch: !widgetType && !dataSource
  if (!p.widgetType && !p.dataSource) {
    return renderKpiCard(
      p.kpiValue as string | number | undefined,
      p.kpiLabel as string | undefined,
      accent,
      p.kpiTrend as number | undefined,
      p.kpiTrendLabel as string | undefined,
    );
  }

  // ── Live KPI from API datasource ─────────────────────────────────────────────
  // label ABOVE value (matches canvas layout)
  if (p.dataSource && p.kpiValue !== undefined) {
    return renderKpiCard(
      p.kpiValue as string | number,
      (p.kpiLabel ?? p.title ?? '') as string,
      accent,
    );
  }

  // ── Live series bars from API datasource ─────────────────────────────────────
  if (p.dataSource && Array.isArray(p.seriesData) && (p.seriesData as unknown[]).length > 0) {
    const series = p.seriesData as { name: string; value: number; color?: string }[];
    return renderSeriesBars(series, accent, escapeHtml((p.title as string) ?? ''), padY);
  }

  // ── widgetType-driven data ────────────────────────────────────────────────────
  if (!data) return '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px;">No data</div>';
  const title = escapeHtml((p.title as string) || data.label || '');

  // Projects progress bars (widgetType=projects_list) — matches canvas projects_list branch
  if ((p.widgetType as string) === 'projects_list' && data.rows && data.columns) {
    const rows = (data.rows as Record<string, string | number>[]).map((row) => {
      const pct = Number(row['Progress'] ?? 0);
      return `<div style="display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;">
          <span style="color:#374151;font-weight:500;">${escapeHtml(String(row['Name'] ?? ''))}</span>
          <span style="color:#6b7280;">${pct}%</span>
        </div>
        <div style="height:8px;background:#e8eaed;border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${accent};border-radius:4px;"></div>
        </div>
      </div>`;
    }).join('');
    return `<div style="width:100%;padding:${padY}px ${padX}px;display:flex;flex-direction:column;gap:10px;">
      ${title ? `<div style="font-size:12px;font-weight:600;color:#111;margin-bottom:2px;">${title}</div>` : ''}
      ${rows}
    </div>`;
  }

  // Table (widgetType=issues_table) — matches canvas table branch
  if (data.rows && data.columns) {
    const cols = data.columns;
    const thead = cols.map((c) =>
      `<th style="background:#f3f4f6;padding:6px 8px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:#6b7280;border-bottom:1px solid #e5e7eb;">${escapeHtml(c)}</th>`
    ).join('');
    const tbody = data.rows.slice(0, 20).map((r, i) => {
      const bg = i % 2 === 1 ? '#f9fafb' : '#ffffff';
      const cells = cols.map((c) => `<td style="padding:6px 8px;font-size:11px;color:#374151;border-bottom:1px solid #f3f4f6;">${escapeHtml(r[c] ?? '')}</td>`).join('');
      return `<tr style="background:${bg};">${cells}</tr>`;
    }).join('');
    return `<div style="width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column;">
      ${title ? `<div style="font-size:12px;font-weight:600;color:#111;padding:${padY}px ${padX}px 4px;border-bottom:1px solid #e5e7eb;">${title}</div>` : ''}
      <div style="overflow:hidden;flex:1;">
        <table style="width:100%;border-collapse:collapse;"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
      </div>
    </div>`;
  }

  // Series bars (widgetType=issues_by_status, users_by_department) — matches canvas series branch
  if (data.series) {
    return renderSeriesBars(data.series, accent, title, padY);
  }

  // Big number KPI (issues_total, issues_open, etc.) — matches canvas KPI card with trend
  return renderKpiCard(
    data.value,
    title || data.label || '',
    accent,
    data.trend,
    data.trendLabel,
  );
}

// ── SVG chart helpers ─────────────────────────────────────────────────────────

type ChartSI = { name: string; value: number; value2?: number; color?: string };

function renderBarLineChartHtml(series: ChartSI[], p: Record<string, unknown>, barColor: string, title: string): string {
  const lineColor      = (p.lineColor as string)      ?? '#f59e0b';
  const barLabel       = escapeHtml((p.barLabel  as string) ?? 'Count');
  const lineLabel      = escapeHtml((p.lineLabel  as string) ?? 'Value');
  const xAxisLabel     = (p.xAxisLabel     as string) ?? '';
  const leftAxisLabel  = (p.leftAxisLabel  as string) ?? '';
  const rightAxisLabel = (p.rightAxisLabel as string) ?? '';

  const maxBar  = Math.max(...series.map((s) => s.value), 1);
  const maxLine = Math.max(...series.map((s) => s.value2 ?? 0), 1);
  const hasLine = series.some((s) => s.value2 !== undefined);

  const svgW = 500, svgH = 160;
  const mL = leftAxisLabel  ? 50 : 32;
  const mR = rightAxisLabel ? 50 : 32;
  const mT = 28;
  const mB = xAxisLabel ? 28 : 18;
  const cW = svgW - mL - mR;
  const cH = svgH - mT - mB;
  const n  = series.length;
  const barW = Math.min(18, (cW / n) * 0.45);
  const step = cW / n;

  const grid = [0.25, 0.5, 0.75, 1.0].map((f) => {
    const y = mT + cH * (1 - f);
    return `<line x1="${mL}" y1="${y.toFixed(1)}" x2="${(mL + cW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="0.8" stroke-dasharray="3,3"/>`;
  }).join('');

  const bars = series.map((s, i) => {
    const h = Math.max(1, Math.round((s.value / maxBar) * cH));
    const x = mL + i * step + (step - barW) / 2;
    const y = mT + cH - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h}" fill="${barColor}" rx="1"/>`;
  }).join('');

  const xLabels = series.map((s, i) => {
    const x = mL + i * step + step / 2;
    return `<text x="${x.toFixed(1)}" y="${(mT + cH + 12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#6b7280">${escapeHtml(s.name)}</text>`;
  }).join('');

  const leftTicks = [0, 0.5, 1.0].map((f) => {
    const y = mT + cH * (1 - f);
    return `<text x="${(mL - 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#9ca3af">${Math.round(maxBar * f)}</text>`;
  }).join('');

  let rightTicks = '';
  let lineEl = '';
  if (hasLine) {
    rightTicks = [0, 0.5, 1.0].map((f) => {
      const y = mT + cH * (1 - f);
      return `<text x="${(mL + cW + 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="start" font-size="8" fill="#9ca3af">${Math.round(maxLine * f)}</text>`;
    }).join('');

    const pts = series.map((s, i) => {
      const x = mL + i * step + step / 2;
      const y = mT + cH - ((s.value2 ?? 0) / maxLine) * cH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const dots = series.map((s, i) => {
      const x = mL + i * step + step / 2;
      const y = mT + cH - ((s.value2 ?? 0) / maxLine) * cH;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${lineColor}"/>`;
    }).join('');
    lineEl = `<polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="1.8"/>${dots}`;
  }

  const legX = svgW / 2;
  const legend = `
    <rect x="${(legX - 70).toFixed(0)}" y="6" width="10" height="9" fill="${barColor}"/>
    <text x="${(legX - 56).toFixed(0)}" y="14" font-size="9" fill="#374151">${barLabel}</text>
    ${hasLine ? `
    <line x1="${(legX + 14).toFixed(0)}" y1="10" x2="${(legX + 26).toFixed(0)}" y2="10" stroke="${lineColor}" stroke-width="1.8"/>
    <circle cx="${(legX + 20).toFixed(0)}" cy="10" r="2.5" fill="${lineColor}"/>
    <text x="${(legX + 30).toFixed(0)}" y="14" font-size="9" fill="#374151">${lineLabel}</text>` : ''}`;

  const leftLabelEl  = leftAxisLabel  ? `<text transform="rotate(-90)" x="${-(mT + cH / 2).toFixed(0)}" y="12" text-anchor="middle" font-size="9" fill="#9ca3af">${escapeHtml(leftAxisLabel)}</text>`  : '';
  const rightLabelEl = rightAxisLabel ? `<text transform="rotate(90)" x="${(mT + cH / 2).toFixed(0)}" y="${-(svgW - 12)}" text-anchor="middle" font-size="9" fill="#9ca3af">${escapeHtml(rightAxisLabel)}</text>` : '';
  const xLabelEl     = xAxisLabel     ? `<text x="${(mL + cW / 2).toFixed(1)}" y="${svgH - 2}" text-anchor="middle" font-size="9" fill="#9ca3af">${escapeHtml(xAxisLabel)}</text>` : '';

  return `<div style="width:100%;padding:6px;">
    ${title ? `<div style="font-size:12px;font-weight:600;margin-bottom:2px;color:#111;">${title}</div>` : ''}
    <svg width="100%" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" overflow="visible">
      ${grid}${bars}${lineEl}${xLabels}${leftTicks}${rightTicks}${legend}${leftLabelEl}${rightLabelEl}${xLabelEl}
    </svg>
  </div>`;
}

function renderBarHChartHtml(series: ChartSI[], p: Record<string, unknown>, accent: string, title: string): string {
  const sortDesc    = !!(p.sortDesc);
  const showValues  = !!(p.showBarValues);
  const singleColor = !!(p.singleColor);
  const sorted      = sortDesc ? [...series].sort((a, b) => b.value - a.value) : series;
  const dataMax     = Math.max(...sorted.map((s) => s.value), 1);

  // Round up to a "nice" axis max the same way Recharts does
  const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
  const step      = magnitude >= 1 ? magnitude : 1;
  const axisMax   = Math.ceil(dataMax / step) * step || 1;

  const ticks  = [0, 0.25, 0.5, 0.75, 1.0].map((f) => Math.round(axisMax * f));
  const labelW = 90;
  const valueW = showValues ? 36 : 0;

  // Each row uses flex:1 so bars fill the container height naturally — no fixed px height
  const rows = sorted.map((s) => {
    const pct   = Math.min(100, Math.round((s.value / axisMax) * 100));
    const color = escapeHtml(singleColor ? accent : (s.color ?? accent));
    return `<div style="flex:1;min-height:12px;display:flex;align-items:center;gap:8px;">
      <div style="width:${labelW}px;font-size:10px;color:#374151;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name)}</div>
      <div style="flex:1;height:70%;background:#f3f4f6;border-radius:0 3px 3px 0;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:0 3px 3px 0;"></div>
      </div>
      ${showValues ? `<div style="width:${valueW}px;font-size:10px;color:#6b7280;flex-shrink:0;text-align:right;">${escapeHtml(String(s.value))}</div>` : ''}
    </div>`;
  }).join('');

  // X-axis tick row
  const axisRow = `<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
    <div style="width:${labelW}px;flex-shrink:0;"></div>
    <div style="flex:1;position:relative;height:14px;">
      ${ticks.map((t) => {
        const left = Math.round((t / axisMax) * 100);
        return `<span style="position:absolute;left:${left}%;transform:translateX(-50%);font-size:9px;color:#9ca3af;">${t}</span>`;
      }).join('')}
    </div>
    ${showValues ? `<div style="width:${valueW}px;flex-shrink:0;"></div>` : ''}
  </div>`;

  return `<div style="width:100%;height:100%;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
    ${title ? `<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#111;flex-shrink:0;">${title}</div>` : ''}
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;">
      ${rows}
    </div>
    <div style="margin-top:4px;">${axisRow}</div>
  </div>`;
}

// ── SVG pie / donut chart ─────────────────────────────────────────────────────

function renderPieChartHtml(series: ChartSI[], title: string): string {
  const PALETTE = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6','#f97316','#64748b'];
  const total = series.reduce((s, item) => s + item.value, 0);
  if (!total) return `<div style="padding:10px;color:#9ca3af;font-size:11px;">No data</div>`;

  // Single-location fallback — a pie with 1 slice is meaningless; show a stat card instead
  if (series.length === 1) {
    const s = series[0];
    const color = s.color ?? PALETTE[0];
    const val   = s.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<div style="width:100%;padding:12px;">
      ${title ? `<div style="font-size:12px;font-weight:600;margin-bottom:10px;">${title}</div>` : ''}
      <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:12px;border:1.5px solid ${escapeHtml(color)}20;background:${escapeHtml(color)}08;">
        <div style="width:44px;height:44px;border-radius:50%;background:${escapeHtml(color)};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-size:16px;font-weight:700;color:white;">100%</span>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#111;">${escapeHtml(s.name)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">Income: <strong style="color:${escapeHtml(color)};">$${val}</strong></div>
          <div style="font-size:10px;color:#9ca3af;margin-top:1px;">Single location — 100% of revenue</div>
        </div>
      </div>
    </div>`;
  }

  const cx = 80, cy = 80, r = 70, ir = 30;
  const paths: string[] = [];
  let cur = -Math.PI / 2;

  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const slice = (s.value / total) * 2 * Math.PI;
    const end   = cur + slice;
    const color = s.color ?? PALETTE[i % PALETTE.length];
    const large = slice > Math.PI ? 1 : 0;

    const x1 = cx + r  * Math.cos(cur), y1 = cy + r  * Math.sin(cur);
    const x2 = cx + r  * Math.cos(end), y2 = cy + r  * Math.sin(end);
    const i1 = cx + ir * Math.cos(cur), j1 = cy + ir * Math.sin(cur);
    const i2 = cx + ir * Math.cos(end), j2 = cy + ir * Math.sin(end);

    const d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r},0,${large},1,${x2.toFixed(1)},${y2.toFixed(1)}`
            + ` L${i2.toFixed(1)},${j2.toFixed(1)} A${ir},${ir},0,${large},0,${i1.toFixed(1)},${j1.toFixed(1)} Z`;
    paths.push(`<path d="${escapeHtml(d)}" fill="${escapeHtml(color)}" stroke="white" stroke-width="1.5"/>`);

    // Percentage label for slices ≥ 5%
    const pct = (s.value / total) * 100;
    if (pct >= 5) {
      const mid = cur + slice / 2;
      const lr  = (r + ir) / 2;
      paths.push(`<text x="${(cx + lr * Math.cos(mid)).toFixed(1)}" y="${(cy + lr * Math.sin(mid)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8" font-weight="600" fill="white">${Math.round(pct)}%</text>`);
    }
    cur = end;
  }

  const legend = series.map((s, i) => {
    const color = s.color ?? PALETTE[i % PALETTE.length];
    const pct   = Math.round((s.value / total) * 100);
    const val   = s.value.toLocaleString('en-US');
    return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">
      <div style="width:9px;height:9px;border-radius:50%;background:${escapeHtml(color)};flex-shrink:0;"></div>
      <span style="font-size:9px;color:#374151;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${escapeHtml(s.name)}</span>
      <span style="font-size:9px;color:#6b7280;flex-shrink:0;">${val} (${pct}%)</span>
    </div>`;
  }).join('');

  return `<div style="width:100%;padding:10px;">
    ${title ? `<div style="font-size:12px;font-weight:600;margin-bottom:8px;">${title}</div>` : ''}
    <div style="display:flex;align-items:flex-start;gap:14px;">
      <svg width="160" height="160" viewBox="0 0 160 160" style="flex-shrink:0;">${paths.join('')}</svg>
      <div style="flex:1;padding-top:6px;">${legend}</div>
    </div>
  </div>`;
}

// ── Main chart dispatcher ─────────────────────────────────────────────────────

function renderChartHtml(data: WidgetData | undefined, p: Record<string, unknown>): string {
  const chartType = (p.chartType as string) ?? 'bar';
  const accent    = (p.colorScheme as string) ?? (chartType === 'bar-line' ? '#5b9bd5' : '#6366f1');
  const title     = escapeHtml((p.title as string) ?? '');

  // Render seriesData whether it came from a live datasource or manual entry
  if (Array.isArray(p.seriesData) && (p.seriesData as unknown[]).length > 0) {
    const series = p.seriesData as ChartSI[];

    if (chartType === 'bar-line') return renderBarLineChartHtml(series, p, accent, title);
    if (chartType === 'bar-h')    return renderBarHChartHtml(series, p, accent, title);
    if (chartType === 'pie')      return renderPieChartHtml(series, title);

    // bar / line / pie → vertical bar representation in PDF
    const hasValue2  = series.some((s) => s.value2 != null);
    const allVals    = series.flatMap((s) => hasValue2 ? [s.value, s.value2 ?? 0] : [s.value]);
    const dataMax2   = Math.max(...allVals, 1);
    const mag2       = Math.pow(10, Math.floor(Math.log10(dataMax2)));
    const axisMax2   = Math.ceil(dataMax2 / (mag2 >= 1 ? mag2 : 1)) * (mag2 >= 1 ? mag2 : 1) || 1;
    const chartH = 80;
    const color2 = (p.color2 as string) ?? '#f59e0b';
    const label1 = escapeHtml((p.barLabel  as string) ?? 'Income');
    const label2 = escapeHtml((p.bar2Label as string) ?? 'Expense');
    const bars = series.map((s) => {
      const barH  = Math.min(chartH, Math.round((s.value / axisMax2) * chartH));
      if (hasValue2) {
        const bar2H = Math.min(chartH, Math.round(((s.value2 ?? 0) / axisMax2) * chartH));
        return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:2px;">
          <div style="width:100%;height:${chartH}px;display:flex;align-items:flex-end;gap:1px;">
            <div style="flex:1;height:${barH}px;background:${escapeHtml(s.color ?? accent)};border-radius:2px 2px 0 0;" title="${escapeHtml(String(s.value))}"></div>
            <div style="flex:1;height:${bar2H}px;background:${escapeHtml(color2)};border-radius:2px 2px 0 0;" title="${escapeHtml(String(s.value2 ?? 0))}"></div>
          </div>
          <span style="font-size:8px;color:#374151;text-align:center;word-break:break-word;">${escapeHtml(s.name)}</span>
        </div>`;
      }
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:2px;">
        <span style="font-size:9px;color:#6b7280;">${escapeHtml(String(s.value))}</span>
        <div style="width:100%;height:${chartH}px;display:flex;align-items:flex-end;">
          <div style="width:100%;height:${barH}px;background:${escapeHtml(s.color ?? accent)};border-radius:3px 3px 0 0;"></div>
        </div>
        <span style="font-size:9px;color:#374151;text-align:center;word-break:break-word;">${escapeHtml(s.name)}</span>
      </div>`;
    }).join('');
    const legend = hasValue2
      ? `<div style="display:flex;gap:12px;margin-bottom:6px;font-size:9px;color:#374151;">
          <span><span style="display:inline-block;width:10px;height:10px;background:${escapeHtml(accent)};border-radius:2px;margin-right:3px;vertical-align:middle;"></span>${label1}</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:${escapeHtml(color2)};border-radius:2px;margin-right:3px;vertical-align:middle;"></span>${label2}</span>
        </div>`
      : '';
    return `<div style="width:100%;padding:10px;">
      ${title ? `<div style="font-size:13px;font-weight:600;margin-bottom:8px;">${title}</div>` : ''}
      ${legend}
      <div style="display:flex;align-items:flex-end;gap:4px;">${bars}</div>
    </div>`;
  }

  // Fall back to widget-level data (for widgetType-driven charts)
  if (!data?.series) return renderWidgetHtml(data, p);

  const total  = data.series.reduce((s, d) => s + d.value, 0);
  const maxVal = Math.max(...data.series.map((s) => s.value), 1);
  const wTitle = (p.title as string) || data.label || '';
  const chartH = 80;

  const bars = data.series
    .map((s) => {
      const barH = Math.round((s.value / maxVal) * chartH);
      const pct  = total ? Math.round((s.value / total) * 100) : 0;
      return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:3px;">
        <span style="font-size:9px;color:#6b7280;font-weight:500;">${s.value}</span>
        <div style="width:100%;height:${chartH}px;display:flex;align-items:flex-end;">
          <div style="width:100%;height:${barH}px;background:${escapeHtml(s.color ?? accent)};border-radius:3px 3px 0 0;"></div>
        </div>
        <span style="font-size:9px;color:#374151;text-align:center;word-break:break-word;">${escapeHtml(s.name)}</span>
        <span style="font-size:9px;color:#9ca3af;">${pct}%</span>
      </div>`;
    })
    .join('');

  return `<div style="width:100%;padding:10px;font-family:inherit;">
    ${wTitle ? `<div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#111;">${escapeHtml(wTitle)}</div>` : ''}
    <div style="display:flex;align-items:flex-end;gap:6px;">${bars}</div>
  </div>`;
}
