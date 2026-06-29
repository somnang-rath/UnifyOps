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

function applyRowFilters(
  rows: Record<string, unknown>[],
  filters: { field: string; op: string; value: string }[],
): Record<string, unknown>[] {
  const active = filters.filter((f) => f.field && f.value !== '');
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every(({ field, op, value }) => {
      const rv = String(getVal(row, field) ?? '');
      switch (op) {
        case 'eq':         return rv === value;
        case 'neq':        return rv !== value;
        case 'contains':   return rv.toLowerCase().includes(value.toLowerCase());
        case 'startsWith': return rv.toLowerCase().startsWith(value.toLowerCase());
        case 'endsWith':   return rv.toLowerCase().endsWith(value.toLowerCase());
        case 'gt':  { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) > n; }
        case 'lt':  { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) < n; }
        case 'gte': { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) >= n; }
        case 'lte': { const n = parseFloat(value); return !isNaN(n) && parseFloat(rv) <= n; }
        default: return true;
      }
    }),
  );
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

// Compute rowspan values for a column: same consecutive values get merged.
// Returns an array of span counts: 0 = hidden (covered by span above), N = spans N rows.
function computeSpans(values: string[]): number[] {
  const spans = new Array(values.length).fill(0) as number[];
  let i = 0;
  while (i < values.length) {
    let j = i + 1;
    while (j < values.length && values[j] === values[i]) j++;
    spans[i] = j - i;
    i = j;
  }
  return spans;
}

function fmtNumber(raw: string, fmt: string | undefined): string {
  if (!fmt || fmt === 'none') return raw;
  const n = parseFloat(String(raw).replace(/[,$\s]/g, ''));
  if (isNaN(n)) return raw;
  switch (fmt) {
    case 'int':  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'dec1': return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case 'dec2': return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'dec3': return n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    case 'pct':  return n.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 1 });
    default: return raw;
  }
}

function applyTextNumberFmt(
  raw: string,
  fmt: string | undefined,
  decimals: number,
  prefix: string,
  suffix: string,
): string {
  const pfx = prefix ?? '';
  const sfx = suffix ?? '';
  if (!fmt || fmt === 'none') return pfx || sfx ? pfx + raw + sfx : raw;
  const n = parseFloat(String(raw).replace(/[,\s]/g, ''));
  if (isNaN(n)) return pfx + raw + sfx;
  let out: string;
  switch (fmt) {
    case 'comma': out = n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); break;
    case 'K':     out = (n / 1e3).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + 'K'; break;
    case 'M':     out = (n / 1e6).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + 'M'; break;
    case 'B':     out = (n / 1e9).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + 'B'; break;
    case 'pct':   out = n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%'; break;
    default:      out = raw;
  }
  return pfx + out + sfx;
}

// ── Table datasource live-fetch ───────────────────────────────────────────────
// Mirrors the DataSourcePanel "Apply" flow: fetches current data from each
// table's configured URL and replaces the stale p.rows snapshot so the PDF
// always reflects live API data.

async function resolveTableDatasources(elements: ReportElement[]): Promise<ReportElement[]> {
  type DS = { url: string; method?: string; headers?: Record<string, string>; dataPath?: string; columnDefs?: { key: string; label: string; prefix?: string; suffix?: string }[]; rowFilters?: { field: string; op: string; value: string }[] };

  // Only fetch for source (non-generated) tables; continuation tables inherit rows.
  const freshRows = new Map<string, Record<string, string>[]>(); // sourceId → rows

  await Promise.all(
    elements.map(async (el) => {
      if (el.type !== 'table') return;
      const p = el.props as Record<string, unknown>;
      if (p.autoGenerated || p.isContinuation) return;
      const ds = p.dataSource as DS | undefined;
      if (!ds?.url) return;

      try {
        const res = await fetch(ds.url, {
          method: ds.method ?? 'GET',
          headers: { 'Content-Type': 'application/json', ...(ds.headers ?? {}) },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const rawRows = extractAtPath(data, ds.dataPath ?? '');
        const filtered = applyRowFilters(rawRows, ds.rowFilters ?? []);
        const rows = filtered.slice(0, 500).map((row) => {
          const mapped: Record<string, string> = {};
          (ds.columnDefs ?? []).forEach(({ key, label, prefix, suffix }) => {
            const v = getVal(row, key);
            const raw = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
            mapped[label] = `${prefix ?? ''}${raw}${suffix ?? ''}`;
          });
          return mapped;
        });
        freshRows.set(el.id, rows);
      } catch { /* keep stored rows on error */ }
    }),
  );

  if (freshRows.size === 0) return elements;

  return elements.map((el) => {
    const p = el.props as Record<string, unknown>;
    // Source table: update directly
    if (freshRows.has(el.id)) return { ...el, props: { ...p, rows: freshRows.get(el.id) } };
    // Continuation table: sync rows from its source
    const srcId = p.sourceTableId as string | undefined;
    if (p.autoGenerated && srcId && freshRows.has(srcId)) {
      return { ...el, props: { ...p, rows: freshRows.get(srcId) } };
    }
    return el;
  });
}

async function resolveGroupedTableDatasources(elements: ReportElement[]): Promise<ReportElement[]> {
  const updates = new Map<string, Record<string, unknown>[]>();

  await Promise.all(
    elements.map(async (el) => {
      if (el.type !== 'grouped-table') return;
      const p = el.props as Record<string, unknown>;
      if (!p.dataUrl) return;

      let headers: Record<string, string> = {};
      if (p.dataHeaders) {
        try { headers = JSON.parse(String(p.dataHeaders)); } catch { /* ignore */ }
      }

      try {
        const res = await fetch(String(p.dataUrl), {
          method: String(p.dataMethod ?? 'GET'),
          headers: { 'Content-Type': 'application/json', ...headers },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const rawData = extractAtPath(data, String(p.dataPath ?? ''));
        updates.set(el.id, rawData);
      } catch { /* keep stored rawData on error */ }
    }),
  );

  if (updates.size === 0) return elements;
  return elements.map((el) => {
    if (updates.has(el.id)) {
      const p = el.props as Record<string, unknown>;
      return { ...el, props: { ...p, rawData: updates.get(el.id) } };
    }
    return el;
  });
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

type FooterCellFn = 'none' | 'sum' | 'count' | 'avg' | 'min' | 'max' | 'custom';

function computeFooterCellPdf(
  rows: Record<string, string>[],
  col: string,
  cfg: { fn: FooterCellFn; custom?: string; decimals?: number },
): string {
  if (cfg.fn === 'none') return '';
  if (cfg.fn === 'custom') return cfg.custom ?? '';
  if (cfg.fn === 'count') return String(rows.length);
  const nums = rows
    .map(r => parseFloat(String(r[col] ?? '').replace(/[$,%\s]/g, '')))
    .filter(n => !isNaN(n));
  if (!nums.length) return '';
  let v: number;
  switch (cfg.fn) {
    case 'sum': v = nums.reduce((a, b) => a + b, 0); break;
    case 'avg': v = nums.reduce((a, b) => a + b, 0) / nums.length; break;
    case 'min': v = Math.min(...nums); break;
    case 'max': v = Math.max(...nums); break;
    default: return '';
  }
  const dp = cfg.decimals ?? 2;
  return v % 1 === 0
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// CSS variable names set by next/font → actual Google Fonts family name
// Maps CSS variable names → Google Fonts family:wght spec used in the PDF <link> tag.
const CSS_VAR_FONT_MAP: Record<string, string> = {
  '--font-koh-santepheap': 'Koh Santepheap:wght@300;400;700',
  '--font-khmer':          'Kantumruy Pro:wght@300;400;500;600;700',
  '--font-noto-khmer':     'Noto Sans Khmer:wght@400;600;700',
  '--font-battambang':     'Battambang:wght@400;700',
  '--font-sans':           'Inter:wght@300;400;500;600;700;800',
};

// Strip "var(--xxx), " prefixes that Next.js next/font injects — Puppeteer has no CSS vars
function normalizeFont(ff: string): string {
  return ff.replace(/var\([^)]+\),?\s*/g, '').trim();
}

// Scan all elements and return <link> tags for any web fonts that need to be loaded.
// Noto Sans Khmer is always included so Khmer text in titles/labels renders correctly.
function collectFontLinks(template: ReportTemplate): string {
  const families = new Set<string>([
    'Inter:wght@300;400;500;600;700;800',
    'Kantumruy Pro:wght@300;400;500;600;700',
    'Noto Sans Khmer:wght@400;600;700',
  ]);

  const addFromVar = (ff: string | undefined) => {
    if (!ff) return;
    const match = ff.match(/var\((--[\w-]+)\)/);
    if (match) {
      const spec = CSS_VAR_FONT_MAP[match[1]];
      if (spec) families.add(spec);
    }
  };

  for (const el of template.elements ?? []) {
    const props = el.props as Record<string, unknown>;
    for (const key of ['fontFamily', 'labelFontFamily', 'headerFontFamily', 'footerFontFamily']) {
      addFromVar(props?.[key] as string | undefined);
    }
    const colFFs = props?.colFontFamilies as Record<string, string> | undefined;
    if (colFFs) Object.values(colFFs).forEach(addFromVar);
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
      })
      .catch((err) => {
        // Clear the rejected promise so subsequent calls can retry the launch
        // instead of permanently returning this error.
        this.launching = null;
        throw err;
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

      const resolvedElements  = await resolveTextDatasources(template.elements ?? []);
      const resolvedElements2 = await resolveTableDatasources(resolvedElements);
      const resolvedElements3 = await resolveGroupedTableDatasources(resolvedElements2);
      const liveTemplate = { ...template, elements: resolvedElements3 } as ReportTemplate;
      const html = buildHtml(liveTemplate, allData, w, h, collectFontLinks(template));
      await page.setContent(html, { waitUntil: 'load' });
      // Wait for all fonts (including Google Fonts / Noto Sans Khmer) to finish loading
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => document.fonts.check('12px "Inter"') && document.fonts.check('12px "Kantumruy Pro"'),
        { timeout: 8000 },
      ).catch(() => { /* timeout is fine — render with fallback font */ });

      // Reposition auto-moved elements (signature, labels, etc.) to sit flush below
      // their table using Puppeteer's actual rendered offsetHeight.
      // Handles both continuation pages AND source pages where the table is small
      // enough to share the page with the moved elements.
      // The formula in repositionMovedElements() can't account for multi-line cell
      // wrapping or the URL-badge being hidden in PDF, so this step is the final arbiter.
      await page.evaluate(() => {
        document.querySelectorAll('.page').forEach((pageEl) => {
          // Collect unique source IDs that have moved elements on this page
          const sourceIds = new Set<string>();
          (pageEl as HTMLElement).querySelectorAll('[data-moved-from]').forEach((el) => {
            const id = (el as HTMLElement).getAttribute('data-moved-from');
            if (id) sourceIds.add(id);
          });
          if (!sourceIds.size) return;

          sourceIds.forEach((sourceId) => {
            // Find the auto-layout table (source or continuation) on this page
            const tableEl = (pageEl as HTMLElement).querySelector(
              `[data-autolayout-table="${sourceId}"]`,
            ) as HTMLElement | null;
            if (!tableEl) return;

            const tableBottom = tableEl.offsetTop + tableEl.offsetHeight;

            const movedEls = Array.from(
              (pageEl as HTMLElement).querySelectorAll(`[data-moved-from="${sourceId}"]`),
            ) as HTMLElement[];
            if (!movedEls.length) return;

            movedEls.sort(
              (a, b) =>
                parseFloat(a.getAttribute('data-orig-y') ?? '0') -
                parseFloat(b.getAttribute('data-orig-y') ?? '0'),
            );

            const firstOrigY = parseFloat(movedEls[0].getAttribute('data-orig-y') ?? '0');
            movedEls.forEach((movedEl) => {
              const origY = parseFloat(movedEl.getAttribute('data-orig-y') ?? '0');
              const offset = Math.max(0, origY - firstOrigY);
              movedEl.style.top = `${tableBottom + 8 + offset}px`;
            });
          });
        });
      });

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
  const fallback = header.padding ?? 12;
  const pt = header.paddingTop    ?? 0;
  const pb = header.paddingBottom ?? 0;
  const pl = header.paddingLeft   ?? fallback;
  const pr = header.paddingRight  ?? fallback;
  const border = header.borderBottom
    ? `border-bottom:${header.borderWidth ?? 1}px solid ${escapeHtml(header.borderColor ?? '#e5e7eb')};`
    : '';
  const base = `position:absolute;top:0;left:0;width:${w}px;height:${header.height}px;background:${escapeHtml(header.background)};${border}display:flex;align-items:center;padding:${pt}px ${pr}px ${pb}px ${pl}px;overflow:hidden;z-index:9000;gap:8px;`;

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
  const fallback = footer.padding ?? 12;
  const pt = footer.paddingTop    ?? 0;
  const pb = footer.paddingBottom ?? 0;
  const pl = footer.paddingLeft   ?? fallback;
  const pr = footer.paddingRight  ?? fallback;
  const border = footer.borderTop
    ? `border-top:${footer.borderWidth ?? 1}px solid ${escapeHtml(footer.borderColor ?? '#e5e7eb')};`
    : '';
  const base = `position:absolute;bottom:0;left:0;width:${w}px;height:${footer.height}px;background:${escapeHtml(footer.background)};${border}display:flex;align-items:center;padding:${pt}px ${pr}px ${pb}px ${pl}px;overflow:hidden;z-index:9000;gap:8px;`;

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

// ── Cont-table height estimation ──────────────────────────────────────────────
// Estimates the rendered height of a continuation table in Puppeteer/Chromium.
// Chromium uses line-height ≈ 1.5× for normal text, so we multiply font sizes
// by 1.5 instead of 1. We also add 1px for each row border (border-collapse).
// The result intentionally overestimates by ~5–10% so elements are placed safely
// BELOW the table, never overlapping with it.
function calcContTableHeight(el: ReportElement): number {
  const p = el.props as Record<string, unknown>;
  const allRows = (p.rows as Record<string, string>[]) ?? [];
  const startRow = Math.max(0, (p.startRow as number) ?? 0);
  const endRow   = p.endRow as number | undefined;
  // The summary footer is one extra ordinary row that appears on the last slice
  // (endRow undefined = all remaining rows shown).
  const footerExtra = (p.footerRowEnabled && endRow === undefined) ? 1 : 0;
  const rowCount = allRows.slice(startRow, endRow).length + footerExtra;

  const hPy = (p.headerPaddingY as number) ?? 8;
  const hFs = (p.headerFontSize as number) ?? (p.fontSize as number) ?? 12;
  const cPy = (p.cellPaddingY  as number) ?? 6;
  const fs  = (p.fontSize      as number) ?? 12;

  // Tables use line-height:1.2 explicitly set on the <table> element
  const CONT_BADGE = 20;                               // "Continued …" badge
  const headerH    = hPy * 2 + Math.ceil(hFs * 1.2) + 2; // +2 for header border-bottom
  const rowH       = cPy * 2 + Math.ceil(fs  * 1.2) + 1; // +1 for row border-bottom

  return CONT_BADGE + headerH + rowCount * rowH;
}

// ── Reposition auto-moved elements ────────────────────────────────────────────
// computeAutoLayout moves elements below a paginated table to the last
// continuation page. In the PDF the continuation table renders at its ACTUAL
// row height (no fixed height CSS), which is often much smaller than the
// design-time estimate. Without correction, elements end up far below the table.
//
// Strategy: for each group of auto-moved elements that share a (page, source
// table), place them right after the actual continuation table content with an
// 8px gap, preserving the RELATIVE vertical order and spacing that existed
// between the elements on the original source page.
function repositionMovedElements(elements: ReportElement[], marginTop: number): ReportElement[] {
  // Group auto-moved elements by (pageIdx : sourceTableId)
  const groupMap = new Map<string, ReportElement[]>();
  for (const el of elements) {
    const p = el.props as Record<string, unknown>;
    if (!p.autoMovedFromTableId) continue;
    const key = `${el.page ?? 0}:${p.autoMovedFromTableId as string}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(el);
  }
  if (groupMap.size === 0) return elements;

  const adjustments = new Map<string, number>(); // id → newY

  for (const [key, groupEls] of groupMap) {
    const sep           = key.indexOf(':');
    const pageIdx       = parseInt(key.slice(0, sep));
    const sourceTableId = key.slice(sep + 1);

    // Find the matching continuation table on this page
    const contEl = elements.find((e) => {
      const ep = e.props as Record<string, unknown>;
      return (
        e.type === 'table' &&
        ep.isContinuation &&
        ep.autoGenerated &&
        ep.sourceTableId === sourceTableId &&
        (e.page ?? 0) === pageIdx
      );
    });
    if (!contEl) continue;

    const actualContH = calcContTableHeight(contEl);

    // Sort by original Y on source page to preserve design order
    const getOrigY = (el: ReportElement) =>
      ((el.props as Record<string, unknown>).autoMovedOriginalY as number) ?? el.y;

    groupEls.sort((a, b) => getOrigY(a) - getOrigY(b));

    // Place first element 8px after continuation table; others keep their
    // relative spacing from the first element (as designed on the source page).
    // NOTE: this is a formula-only estimate used as the initial position.
    // generatePdf runs a Puppeteer evaluate() step after rendering that corrects
    // these positions using actual measured offsetHeight, handling text wrapping.
    const firstOrigY = getOrigY(groupEls[0]);
    const baseY      = marginTop + actualContH + 8;

    for (const el of groupEls) {
      const relOffset = Math.max(0, getOrigY(el) - firstOrigY);
      adjustments.set(el.id, baseY + relOffset);
    }
  }

  return elements.map((el) => {
    const newY = adjustments.get(el.id);
    return newY !== undefined ? { ...el, y: newY } : el;
  });
}

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
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
  };
  const allPages: ReportPage[] = tpl.pages?.length ? tpl.pages : [{ id: 'page-0' }];
  const marginTop  = tpl.margins?.top ?? 0;
  // Reposition auto-moved elements based on actual continuation row counts
  const allElements = repositionMovedElements(template.elements ?? [], marginTop);

  // Determine whether a page has any visible content.
  // A page is considered empty if:
  //   1. It has no elements at all, OR
  //   2. Its only elements are continuation table slices with zero data rows.
  function pageHasVisibleContent(pgIdx: number): boolean {
    const pageEls = allElements.filter((el) => (el.page ?? 0) === pgIdx);
    if (pageEls.length === 0) return false;
    return pageEls.some((el) => {
      const p = el.props as Record<string, unknown>;
      if (el.type === 'table' && p.isContinuation && p.autoGenerated) {
        const rows     = (p.rows as unknown[]) ?? [];
        const startRow = Math.max(0, (p.startRow as number) ?? 0);
        const endRow   = p.endRow as number | undefined;
        // The summary footer is an extra row on the last slice (endRow undefined),
        // so a footer-only slice is still visible content.
        return rows.slice(startRow, endRow).length > 0 || (!!p.footerRowEnabled && endRow === undefined);
      }
      return true;
    });
  }

  // Build a compacted list of original page indices that have content.
  // newIdx = position in the output PDF (used for page-number elements).
  const visiblePageIndices = allPages
    .map((_, idx) => idx)
    .filter((idx) => pageHasVisibleContent(idx));

  const totalPages = visiblePageIndices.length || 1;

  const headerEnabled = tpl.header?.enabled;
  const footerEnabled = tpl.footer?.enabled;

  const pagesHtml = visiblePageIndices
    .map((originalIdx, newIdx) => {
      const pg = allPages[originalIdx];
      const bg = pg.background || template.background || '#ffffff';
      const elements = allElements
        .filter((el) => {
          if ((el.page ?? 0) !== originalIdx) return false;
          // Skip continuation table slices that have no data rows
          const p = el.props as Record<string, unknown>;
          if (el.type === 'table' && p.isContinuation && p.autoGenerated) {
            const rows     = (p.rows as unknown[]) ?? [];
            const startRow = Math.max(0, (p.startRow as number) ?? 0);
            const endRow   = p.endRow as number | undefined;
            // Keep footer-only slices (footer is an extra row on the last slice).
            return rows.slice(startRow, endRow).length > 0 || (!!p.footerRowEnabled && endRow === undefined);
          }
          return true;
        })
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((el) => renderElement(el, allData, newIdx, totalPages))
        .join('\n');
      const headerHtml = headerEnabled && shouldShowHF(tpl.header!, newIdx) ? buildHeaderHtml(tpl.header!, w, newIdx, totalPages) : '';
      const footerHtml = footerEnabled && shouldShowHF(tpl.footer!, newIdx) ? buildFooterHtml(tpl.footer!, w, newIdx, totalPages) : '';
      return `<div class="page" style="background:${escapeHtml(bg)};">${elements}${headerHtml}${footerHtml}</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
${fontLinks}
<style>
  /* CSS variables that mirror the web app's light-mode theme tokens.
     Puppeteer has no access to Next.js CSS, so any canvas fallback that uses
     var(--border), var(--bg-subtle), color-mix(), etc. needs these resolved. */
  :root {
    --bg:          #ffffff;
    --bg-card:     #ffffff;
    --bg-subtle:   #f3f4f6;
    --bg-hover:    #f9fafb;
    --bg-input:    #ffffff;
    --text:        #111827;
    --text-sub:    #374151;
    --text-muted:  #6b7280;
    --border:      #e5e7eb;
    --border-strong: #d1d5db;
    --accent-50:   #eef2ff;
    --accent-100:  #e0e7ff;
    --accent-400:  #818cf8;
    --accent-500:  #6366f1;
    --accent-600:  #4f46e5;
    --accent-700:  #4338ca;
  }
  @page { size: ${w}px ${h}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${w}px; background: transparent; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-family: 'Inter', 'Kantumruy Pro', 'Noto Sans Khmer', sans-serif; }
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

// Thin wrapper that injects data-* attributes needed by the Puppeteer evaluate step
// in generatePdf so moved elements can be repositioned using actual rendered heights.
function renderElement(
  el: ReportElement,
  allData: Record<string, WidgetData>,
  pageIndex: number,
  totalPages: number,
): string {
  let html = renderElementInner(el, allData, pageIndex, totalPages);
  const p = el.props as Record<string, unknown>;

  // Tag any auto-layout table (source OR continuation) so the Puppeteer evaluate step
  // can measure its actual offsetHeight and reposition auto-moved elements correctly.
  // Source tables use their own id; continuation tables point back to their source id.
  if (el.type === 'table') {
    const isCont      = !!(p.isContinuation);
    const isAutoLayout = p.autoOriginalH !== undefined || isCont;
    if (isAutoLayout) {
      const tableSourceId = isCont ? String(p.sourceTableId ?? '') : el.id;
      if (tableSourceId) {
        html = html.replace(/^(<div\b)/, `$1 data-autolayout-table="${escapeHtml(tableSourceId)}"`);
      }
    }
  }

  // Auto-moved element: tag with source table ID and original Y for repositioning.
  const movedFrom = p.autoMovedFromTableId as string | undefined;
  if (movedFrom) {
    const origY = (p.autoMovedOriginalY as number) ?? el.y;
    html = html.replace(/^(<div\b)/, `$1 data-moved-from="${escapeHtml(movedFrom)}" data-orig-y="${origY}"`);
  }

  return html;
}

function renderElementInner(
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
      const fw = p.bold ? String((p.boldWeight as number) ?? 600) : '400';
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
      const textContent = applyTextNumberFmt(
        String(p.content ?? ''),
        p.numberFormat as string | undefined,
        (p.numberDecimals as number) ?? 0,
        (p.numberPrefix as string) ?? '',
        (p.numberSuffix as string) ?? '',
      );
      // word-break:break-word matches canvas ElementText overflow:hidden + wordBreak:'break-word'
      return `<div class="el el-text" style="${base}${lh}${ls}${ff}${bg}${px}${py}font-size:${fs}px;font-weight:${fw};font-style:${fi};text-decoration:${td};color:${escapeHtml(color)};text-align:${align};word-break:break-word;">${escapeHtml(textContent)}</div>`;
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
      const headingContent = applyTextNumberFmt(
        String(p.content ?? ''),
        p.numberFormat as string | undefined,
        (p.numberDecimals as number) ?? 0,
        (p.numberPrefix as string) ?? '',
        (p.numberSuffix as string) ?? '',
      );
      return `<div class="el el-heading" style="${base}${lh}${ls}${ff}${bg}${px}${py}font-size:${fs}px;font-weight:${fw};font-style:${fi};text-decoration:${td};color:${escapeHtml(color)};text-align:${align};white-space:pre-wrap;word-break:break-word;">${escapeHtml(headingContent)}</div>`;
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
      return `<div class="el" style="${base}${borderWrapStyle(p)}overflow:hidden;display:flex;flex-direction:column;">${renderChartHtml(data, p, el.w, el.h)}</div>`;
    }

    case 'table': {
      const cols: string[] = (p.columns as string[]) ?? [];
      const realRows: Record<string, string>[] = (p.rows as Record<string, string>[]) ?? [];

      // Summary footer is appended as one ordinary row (mirrors element-table.tsx),
      // so pagination treats it like any other row — no "last page only" handling and
      // no reserved footer height.  Aggregates are computed once over the REAL rows.
      const footerEnabled = !!p.footerRowEnabled;
      const footerCells = (p.footerCells as Record<string, { fn: FooterCellFn; custom?: string; decimals?: number }>) ?? {};
      const footerLabel = (p.footerRowLabel as string) ?? 'Total';
      const footerRowData: Record<string, string> | null = footerEnabled
        ? (() => {
            const out: Record<string, string> = {};
            cols.forEach((c, ci) => {
              const cfg = footerCells[c] ?? { fn: 'none' as FooterCellFn };
              out[c] = cfg.fn === 'none' && ci === 0 ? footerLabel : computeFooterCellPdf(realRows, c, cfg);
            });
            return out;
          })()
        : null;

      const allRows     = footerRowData ? [...realRows, footerRowData] : realRows;
      const footerIndex = footerRowData ? realRows.length : -1;

      const startRow = Math.max(0, (p.startRow as number) ?? 0);
      const endRow   = p.endRow as number | undefined;
      const rows     = allRows.slice(startRow, endRow);
      // The footer is always the last entry of allRows, so it is on this page only
      // when the slice's last row is the footer index.
      const footerOnPage = footerIndex >= 0 && rows.length > 0 && startRow + rows.length - 1 === footerIndex;
      const dataRowCount = footerOnPage ? rows.length - 1 : rows.length;

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
      const colWidths    = (p.colWidths    as Record<string, number> | undefined) ?? {};
      const colLabels    = (p.colLabels    as Record<string, string> | undefined) ?? {};
      const colSubLabels = (p.colSubLabels as Record<string, string> | undefined) ?? {};
      const colFontSizes    = (p.colFontSizes    as Record<string, number> | undefined) ?? {};
      const colTextColors   = (p.colTextColors   as Record<string, string> | undefined) ?? {};
      const colFontFamilies = (p.colFontFamilies as Record<string, string> | undefined) ?? {};
      const hWrap        = !!(p.headerWrapText);

      // Use auto layout when autoPageBreak is on and no explicit colWidths — lets
      // Chromium size columns by content instead of distributing width equally.
      const hasExplicitColWidths = cols.some(c => colWidths[c] != null);
      const tblLayout = (p.autoPageBreak !== false && !hasExplicitColWidths) ? 'auto' : 'fixed';

      // Merge-cell span maps: precompute rowspan for each merge column (same as canvas logic)
      const mergeCols    = (p.mergeCols as string[] | undefined) ?? [];
      const mergeColsSet = new Set(mergeCols);
      const spanMaps: Record<string, number[]> = {};
      if (mergeColsSet.size > 0) {
        const dataRows = footerOnPage ? rows.slice(0, dataRowCount) : rows;
        for (const col of mergeColsSet) {
          spanMaps[col] = computeSpans(dataRows.map((r) => String(r[col] ?? '')));
        }
      }
      const primaryMergeCol = mergeCols[0] ?? null;

      const urlBarH    = 0; // URL badge hidden in PDF — no longer contributes to height
      const contBadgeH = isCont ? 20 : 0;
      const bwRaw      = (p.borderWidth as number) ?? 0.1;
      const bw         = Math.max(0, bwRaw);
      // CSS border properties get pixel-snapped to 0 in Chromium for values < 0.5px.
      // box-shadow inset renders at true sub-pixel precision — use it for all cell lines.
      const hbbColor   = p.headerBottomBorder
        ? escapeHtml((p.headerBottomBorderColor as string) ?? borderColor)
        : borderColor;
      // Build a box-shadow string from shadow parts; filters out empty strings.
      const mkBS = (...parts: string[]): string => {
        const v = parts.filter(Boolean).join(',');
        return v ? `box-shadow:${v};` : '';
      };
      const bsR = (active: boolean) =>
        active ? `inset -${bw}px 0 0 0 ${borderColor}` : '';
      const bsB = (active: boolean, color = borderColor) =>
        active ? `inset 0 -${bw}px 0 0 ${color}` : '';
      const perRowH    = (p.equalRowHeight && p.rowHeight) ? (p.rowHeight as number) : 0;

      // Footer font size — used when rendering the synthetic footer row.
      const fFs        = (p.footerRowFontSize as number | undefined) ?? Math.max(9, Math.round(fs * 0.9));
      // Self-correcting height: the footer is one of the counted rows now, so its
      // height is already in `rows.length * rH_est`.  Templates saved before this change
      // may have el.h that omits the footer — expand el.h to the content minimum so the
      // last row is never clipped in the PDF.
      const hH_est     = hPy * 2 + Math.ceil(hFs * 1.2) + 2;
      const rH_est     = perRowH > 0 ? perRowH : cellPy * 2 + Math.ceil(fs * 1.2) + 1;
      const minElH     = contBadgeH + hH_est + rows.length * rH_est;
      const effectiveH = footerOnPage ? Math.max(el.h, minElH) : el.h;

      // computeAutoLayout stretches auto-paginated source tables to fill the page so
      // the canvas can DOM-measure actual row heights. The PDF has no DOM measurement,
      // so for auto-layout tables we use max-height so content can shrink (no blank
      // space below last row) but cannot grow into the bottom margin / footer area.
      const isAutoLayout  = p.autoOriginalH !== undefined || isCont;
      const isAutoH       = !!(p.autoHeight);
      // When every row is visible (no pagination / no clipping needed) cap at el.h
      // so the table doesn't bleed into the footer. autoHeight tables are unconstrained.
      const showingAllRows = rows.length === allRows.length;
      const heightStyle   = isAutoH ? ''
        : (isAutoLayout || showingAllRows) ? `max-height:${effectiveH}px;`
        : `height:${effectiveH}px;`;

      const tableBase = `left:${el.x}px;top:${el.y}px;width:${el.w}px;${heightStyle}transform:rotate(${el.rotation ?? 0}deg);z-index:${el.zIndex ?? 0};`;

      const contBadge = isCont
        ? `<div style="flex-shrink:0;padding:2px 8px;background:rgba(99,102,241,0.08);border-bottom:1px dashed #6366f1;font-size:9px;color:#6366f1;font-weight:600;">&#8617; Continued from previous page</div>`
        : '';

      // URL badge is editor-only — hidden in PDF output
      const urlBadge = '';

      // Header bottom border — matches element-table.tsx logic
      const headerBottomBorder = p.headerBottomBorder
        ? `${bw}px solid ${escapeHtml((p.headerBottomBorderColor as string) ?? borderColor)}`
        : showRowB ? `${bw}px ${borderStyle} ${borderColor}` : 'none';

      // <colgroup> for column widths (percentages, same as canvas table)
      const colgroupCols = [
        showRowNums ? `<col style="width:36px"/>` : '',
        ...cols.map((c) => colWidths[c] != null ? `<col style="width:${colWidths[c]}%"/>` : '<col/>'),
      ].join('');
      const colgroup = `<colgroup>${colgroupCols}</colgroup>`;

      // Row-number header cell
      const rowNumTh = showRowNums
        ? `<th style="background:${headerBg};color:${headerColor};padding:${hPy}px ${cellPx}px;font-size:${hFs}px;font-weight:${hFw};line-height:1.2;text-transform:${hTT};text-align:center;${mkBS(bsR(showColB), bsB(showRowB, hbbColor))}white-space:nowrap;">${rowNumLabel}</th>`
        : '';

      const thead = rowNumTh + cols.map((c, ci) => {
        const colAlign  = hTA || escapeHtml(((p.colAligns as Record<string, string>)?.[c]) ?? 'left');
        const wrapStyle = hWrap ? 'white-space:normal;word-break:break-word;' : 'white-space:nowrap;';
        const label     = escapeHtml(colLabels[c] ?? c);
        const subLabel  = colSubLabels[c] ? `<span style="display:block;font-size:0.75em;font-weight:400;opacity:0.75;line-height:1.2;margin-top:2px;">${escapeHtml(colSubLabels[c])}</span>` : '';
        return `<th style="background:${headerBg};color:${headerColor};padding:${hPy}px ${cellPx}px;font-size:${hFs}px;font-weight:${hFw};line-height:1.2;text-transform:${hTT};text-align:${colAlign};vertical-align:middle;${mkBS(bsR(showColB && ci < cols.length - 1), bsB(showRowB, hbbColor))}${wrapStyle}">${label}${subLabel}</th>`;
      }).join('');

      const tbody = rows.map((r, i) => {
        const globalI    = startRow + i;
        const isFooter   = globalI === footerIndex;
        const isStripe   = !!(p.stripedRows && i % 2 === 1);
        const isTotalRow = !!(p.showTotalRow && globalI === realRows.length - 1);
        let rowBg = (p.rowBg as string) ?? 'transparent';
        if (isFooter)                        rowBg = escapeHtml((p.footerRowBg as string) ?? '#f3f4f6');
        else if (isTotalRow && p.totalRowBg) rowBg = escapeHtml(p.totalRowBg as string);
        else if (isStripe)                   rowBg = (p.rowAltBg as string) ?? '#f3f4f6';
        const rowFw = isFooter
          ? ((p.footerRowBold as boolean) !== false ? 'font-weight:700;' : '')
          : (isTotalRow && p.totalRowBold !== false ? 'font-weight:bold;' : '');
        const rowFg = isFooter
          ? `color:${escapeHtml((p.footerRowColor as string) ?? '#111111')};`
          : (isTotalRow && p.totalRowColor ? `color:${escapeHtml(p.totalRowColor as string)};` : '');
        const rowFs = isFooter ? `font-size:${fFs}px;` : '';

        // Row-number cell (merge-aware: spans same as primary merge column)
        let rowNumTd = '';
        if (showRowNums && isFooter) {
          rowNumTd = `<td style="padding:${cellPy}px ${cellPx}px;line-height:1.2;${mkBS(bsR(showColB))}text-align:center;"></td>`;
        } else if (showRowNums) {
          const numSpan = primaryMergeCol ? (spanMaps[primaryMergeCol]?.[i] ?? 1) : 1;
          if (numSpan === 0) {
            rowNumTd = ''; // covered by merged cell above
          } else {
            const numRS    = numSpan > 1 ? ` rowspan="${numSpan}"` : '';
            const numLabel = primaryMergeCol ? String((() => {
              // group index: count unique values in the primary merge col up to this row
              let g = 0; let last = '';
              for (let k = 0; k <= i; k++) {
                const v = String(rows[k]?.[primaryMergeCol] ?? '');
                if (v !== last) { g++; last = v; }
              }
              return g + (startRow > 0 ? (() => {
                let off = 0; let lv = '';
                for (let k = 0; k < startRow; k++) {
                  const v = String(allRows[k]?.[primaryMergeCol] ?? '');
                  if (v !== lv) { off++; lv = v; }
                }
                return off;
              })() : 0);
            })()) : String(globalI + 1);
            rowNumTd = `<td${numRS} style="padding:${cellPy}px ${cellPx}px;line-height:1.2;${mkBS(bsR(showColB), bsB(showRowB && i + numSpan - 1 < rows.length - 1))}text-align:center;color:#6b7280;vertical-align:middle;">${numLabel}</td>`;
          }
        }

        const cells = cols.map((c, ci) => {
          // Merge: skip cells covered by a span above (footer is never merged)
          const mergeEnabled = mergeColsSet.has(c) && !isFooter;
          const span = mergeEnabled ? (spanMaps[c]?.[i] ?? 1) : 1;
          if (mergeEnabled && span === 0) return ''; // covered

          const rawVal   = r[c] ?? '';
          const val      = fmtNumber(rawVal, (p.colFormats as Record<string, string> | undefined)?.[c]);
          const align    = escapeHtml(((p.colAligns as Record<string, string>)?.[c]) ?? 'left');
          const colBg    = isFooter ? undefined : (p.colBgs as Record<string, string>)?.[c];
          const isStatus = !isFooter && (p.statusColumns as string[] | undefined)?.includes(c);
          // For merged cells, use the border at the last spanned row
          const lastRowIdx = mergeEnabled && span > 1 ? i + span - 1 : i;
          const rowspanAttr = span > 1 ? ` rowspan="${span}"` : '';

          // Per-column styling (skipped for the footer row, which uses footer styling)
          const colFs  = !isFooter && colFontSizes[c]    ? `font-size:${colFontSizes[c]}px;`                              : '';
          const colFg  = !isFooter && colTextColors[c]   ? `color:${escapeHtml(colTextColors[c])};`                        : '';
          const colFf  = !isFooter && colFontFamilies[c] ? `font-family:${escapeHtml(normalizeFont(colFontFamilies[c]))};` : '';

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
          const cellBS = mkBS(bsR(showColB && ci < cols.length - 1), bsB(showRowB && lastRowIdx < rows.length - 1));
          return `<td${rowspanAttr} style="padding:${cellPy}px ${cellPx}px;line-height:1.2;text-align:${align};vertical-align:middle;${colBg ? `background:${escapeHtml(colBg)};` : ''}${colFs}${colFg}${colFf}${cellBS}">${cellContent}</td>`;
        }).join('');

        const trH = perRowH > 0 ? `height:${perRowH}px;` : '';
        return `<tr style="background:${escapeHtml(rowBg)};${rowFw}${rowFg}${rowFs}${trH}">${rowNumTd}${cells}</tr>`;
      }).join('');

      const outerStyle = outerB ? `border:${bw}px ${borderStyle} ${borderColor};border-radius:4px;` : '';
      const ff = p.fontFamily ? `font-family:${escapeHtml(normalizeFont(p.fontFamily as string))};` : '';
      // When row-stretching is active, set height:100% on the table so it fills
      // the flex container and Puppeteer distributes the explicit tr heights correctly.
      const tableHeightStyle = perRowH > 0 ? 'height:100%;' : '';

      // The summary footer is rendered as the last <tbody> row (see footerRowData),
      // so column widths always align and no separate <tfoot> / overflow exception
      // is needed.  Clipping stays on to keep rows out of header/footer overlay areas.
      const innerOverflow = 'overflow:hidden;';
      return `<div class="el" style="${tableBase}${outerStyle}${ff}overflow:hidden;display:flex;flex-direction:column;">${contBadge}${urlBadge}<div style="flex:1;${innerOverflow}"><table style="width:100%;${tableHeightStyle}table-layout:${tblLayout};border-collapse:separate;border-spacing:0;font-size:${fs}px;line-height:1.2;${ff}">${colgroup}<thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div></div>`;
    }

    case 'grouped-table': {
      type GCol = { label: string; level: 'group_no' | 'group' | 'subgroup' | 'detail'; field: string; width?: number; align?: string; bold?: boolean; color?: string; format?: string };
      const DEFAULT_COLS: GCol[] = [
        { label: 'ល.រ',             level: 'group_no',  field: '',                    width: 36,  align: 'center' },
        { label: 'ក្រុមហ៊ុន',         level: 'group',     field: 'company_kh',          width: 110, align: 'left', color: '#1d6bbc', bold: true },
        { label: 'ស្ថានីយ',           level: 'subgroup',  field: 'site_kh',             width: 120, align: 'left' },
        { label: 'ទូទាត់',            level: 'detail',    field: 'id',                  width: 90,  align: 'left' },
        { label: 'អាតុភាព',           level: 'detail',    field: 'rated_power_display', width: 60,  align: 'center' },
        { label: 'ប្រើប្រាស់',         level: 'detail',    field: 'sessions',            width: 55,  align: 'center', format: 'number' },
        { label: 'ថាមពលសរុប\n(kWh)', level: 'detail',    field: 'kwh',                 width: 80,  align: 'right',  format: 'number_2dp' },
        { label: 'តម្លៃ (ស្ថូ)\n/kWh', level: 'detail',    field: 'price',               width: 70,  align: 'right',  format: 'number' },
        { label: 'ចំណូល\n(ស្ថូ)',       level: 'detail',    field: 'revenue',             width: 90,  align: 'right',  bold: true, format: 'currency_khr' },
      ];

      const rawData    = (p.rawData as Record<string, unknown>[] | undefined) ?? [];
      const groupField = (p.groupByField  as string | undefined) ?? 'company_kh';
      const detField   = (p.detailField   as string | undefined) ?? 'chargers_detail';
      const cols       = (p.columns as GCol[] | undefined) ?? DEFAULT_COLS;

      const headerBg = escapeHtml((p.headerBg  as string | undefined) ?? '#1e3a5f');
      const headerFg = escapeHtml((p.headerColor as string | undefined) ?? '#ffffff');
      const hFs      = (p.headerFontSize   as number | undefined) ?? 10;
      const hFw      = escapeHtml((p.headerFontWeight as string | undefined) ?? '600');
      const hPy      = (p.headerPaddingY   as number | undefined) ?? 7;
      const fs2      = (p.fontSize         as number | undefined) ?? 10;
      const cellPx2  = (p.cellPaddingX     as number | undefined) ?? 8;
      const cellPy2  = (p.cellPaddingY     as number | undefined) ?? 5;
      const bClr     = escapeHtml((p.borderColor as string | undefined) ?? '#d1d5db');
      const bW2      = (p.borderWidth      as number | undefined) ?? 1;
      const bSt2     = escapeHtml((p.borderStyle  as string | undefined) ?? 'solid');
      const bLine    = `${bW2}px ${bSt2} ${bClr}`;
      const showColB2 = p.showColBorders !== false;
      const outerB2   = p.outerBorder !== false;
      const ff2       = p.fontFamily ? `font-family:${escapeHtml(normalizeFont(p.fontFamily as string))};` : '';

      const gFmtVal = (v: unknown, fmt?: string): string => {
        if (v == null || v === '') return '';
        const n = parseFloat(String(v).replace(/,/g, ''));
        if (fmt && !isNaN(n)) {
          if (fmt === 'number')       return n.toLocaleString('en-US');
          if (fmt === 'number_2dp')   return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          if (fmt === 'currency_khr') return n.toLocaleString('en-US');
        }
        return String(v);
      };

      const gGetField = (obj: Record<string, unknown>, field: string): unknown => {
        if (!field) return '';
        return field.split('.').reduce<unknown>((cur, k) => {
          if (cur != null && typeof cur === 'object' && !Array.isArray(cur))
            return (cur as Record<string, unknown>)[k];
          return undefined;
        }, obj);
      };

      // Build grouped structure
      type SiteEntry  = { siteRow: Record<string, unknown>; details: Record<string, unknown>[] };
      type GroupEntry = { key: string; firstRow: Record<string, unknown>; sites: SiteEntry[]; totalDetailRows: number };
      const groups: GroupEntry[] = [];
      const groupIdxMap = new Map<string, number>();

      for (const siteRow of rawData) {
        const gKey    = String(gGetField(siteRow, groupField) ?? '');
        const details = (siteRow[detField] as Record<string, unknown>[] | undefined) ?? [];
        if (!groupIdxMap.has(gKey)) {
          groupIdxMap.set(gKey, groups.length);
          groups.push({ key: gKey, firstRow: siteRow, sites: [], totalDetailRows: 0 });
        }
        const grp = groups[groupIdxMap.get(gKey)!];
        grp.sites.push({ siteRow, details });
        grp.totalDetailRows += Math.max(1, details.length);
      }

      // Build colgroup
      const cg2 = `<colgroup>${cols.map((c) => c.width != null ? `<col style="width:${c.width}px"/>` : '<col/>').join('')}</colgroup>`;

      // Build header
      const theadCells = cols.map((c, ci) => {
        const lines = c.label.split('\n');
        const br = lines[1] ? `<br/><span style="font-weight:400;opacity:0.85;">${escapeHtml(lines[1])}</span>` : '';
        const bR = showColB2 && ci < cols.length - 1 ? `border-right:${bLine};` : '';
        return `<th style="background:${headerBg};color:${headerFg};padding:${hPy}px ${cellPx2}px;font-size:${hFs}px;font-weight:${hFw};line-height:1.3;text-align:${escapeHtml(c.align ?? 'center')};vertical-align:middle;border-bottom:${bLine};${bR}white-space:pre-wrap;">${escapeHtml(lines[0])}${br}</th>`;
      }).join('');

      const startGI   = (p.startGroupIdx as number | undefined) ?? 0;
      const endGI     = (p.endGroupIdx   as number | undefined); // undefined = all remaining
      const isCont    = !!(p.isContinuation);
      const visGroups = groups.slice(startGI, endGI);

      // Re-build bodyRows for visible groups only
      const visBodyRows: string[] = [];
      for (let gi = 0; gi < visGroups.length; gi++) {
        const grp        = visGroups[gi];
        const globalGI   = startGI + gi;
        const isLastGroup = gi === visGroups.length - 1;
        const groupBb    = !isLastGroup ? bLine : 'none';
        let detRowIdx = 0;

        for (let si = 0; si < grp.sites.length; si++) {
          const site = grp.sites[si];
          const siteDetCount = Math.max(1, site.details.length);
          const detailRows   = site.details.length ? site.details : [{}];
          const isLastSite   = si === grp.sites.length - 1;

          for (let di = 0; di < detailRows.length; di++) {
            const detail = detailRows[di];
            const isFirstInGroup = si === 0 && di === 0;
            const isFirstInSite  = di === 0;
            const isLastInGroup  = isLastSite && di === detailRows.length - 1;
            const isLastInSite   = di === detailRows.length - 1;
            const rowBb     = !isLastInGroup ? bLine : groupBb;
            const siteRowBb = !isLastInSite ? bLine : (isLastInGroup ? groupBb : bLine);
            const altBg     = p.stripedRows && detRowIdx % 2 === 1 ? escapeHtml((p.altRowBg as string | undefined) ?? '#f9fafb') : '';

            const cells: string[] = [];
            for (let ci = 0; ci < cols.length; ci++) {
              const col = cols[ci];
              const bR  = showColB2 && ci < cols.length - 1 ? `border-right:${bLine};` : '';
              const baseStyle = `padding:${cellPy2}px ${cellPx2}px;line-height:1.3;vertical-align:middle;text-align:${escapeHtml(col.align ?? 'left')};${col.bold ? 'font-weight:700;' : ''}${col.color ? `color:${escapeHtml(col.color)};` : ''}${bR}`;

              if (col.level === 'group_no') {
                if (isFirstInGroup) {
                  cells.push(`<td rowspan="${grp.totalDetailRows}" style="${baseStyle}${p.groupBg ? `background:${escapeHtml(p.groupBg as string)};` : ''}border-bottom:${groupBb};">${globalGI + 1}</td>`);
                }
              } else if (col.level === 'group') {
                if (isFirstInGroup) {
                  cells.push(`<td rowspan="${grp.totalDetailRows}" style="${baseStyle}${p.groupBg ? `background:${escapeHtml(p.groupBg as string)};` : ''}border-bottom:${groupBb};">${escapeHtml(gFmtVal(gGetField(grp.firstRow, col.field), col.format))}</td>`);
                }
              } else if (col.level === 'subgroup') {
                if (isFirstInSite) {
                  cells.push(`<td rowspan="${siteDetCount}" style="${baseStyle}${p.subGroupBg ? `background:${escapeHtml(p.subGroupBg as string)};` : ''}border-bottom:${siteRowBb};">${escapeHtml(gFmtVal(gGetField(site.siteRow, col.field), col.format))}</td>`);
                }
              } else {
                cells.push(`<td style="${baseStyle}border-bottom:${rowBb};${altBg ? `background:${altBg};` : ''}">${escapeHtml(gFmtVal(gGetField(detail as Record<string, unknown>, col.field), col.format))}</td>`);
              }
            }
            visBodyRows.push(`<tr>${cells.join('')}</tr>`);
            detRowIdx++;
          }
        }
      }

      const contBadgeGT = isCont
        ? `<div style="flex-shrink:0;padding:2px 8px;background:rgba(99,102,241,0.08);border-bottom:1px dashed #6366f1;font-size:9px;color:#6366f1;font-weight:600;">&#8617; Continued from previous page</div>`
        : '';

      const outerStyle2 = outerB2 ? `border:${bLine};border-radius:4px;` : '';
      const tableBase2  = `left:${el.x}px;top:${el.y}px;width:${el.w}px;max-height:${el.h}px;transform:rotate(${el.rotation ?? 0}deg);z-index:${el.zIndex ?? 0};`;

      const emptyRow = rawData.length === 0
        ? `<tr><td colspan="${cols.length}" style="padding:16px 8px;text-align:center;color:#9ca3af;font-size:10px;">No data</td></tr>`
        : '';

      return `<div class="el" style="${tableBase2}${outerStyle2}${ff2}overflow:hidden;display:flex;flex-direction:column;">${contBadgeGT}<div style="flex:1;overflow:hidden;"><table style="width:100%;border-collapse:collapse;font-size:${fs2}px;line-height:1.3;${ff2}">${cg2}<thead><tr>${theadCells}</tr></thead><tbody>${emptyRow}${visBodyRows.join('')}</tbody></table></div></div>`;
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

function renderBarLineChartHtml(series: ChartSI[], p: Record<string, unknown>, barColor: string, title: string, elW = 500, elH = 300): string {
  const lineColor      = (p.lineColor as string)      ?? '#f59e0b';
  const barLabel       = escapeHtml((p.barLabel  as string) ?? 'Count');
  const lineLabel      = escapeHtml((p.lineLabel  as string) ?? 'Value');
  const xAxisLabel     = (p.xAxisLabel     as string) ?? '';
  const leftAxisLabel  = (p.leftAxisLabel  as string) ?? '';
  const rightAxisLabel = (p.rightAxisLabel as string) ?? '';

  // Typography — defaults match canvas element-chart.tsx exactly
  const tSize      = (p.labelFontSize as number) ?? 9;
  const tColor     = escapeHtml((p.labelColor as string) ?? '#6b7280');
  const titleAlign = (p.titleAlign    as string) ?? 'left';
  const titleSize  = (p.titleFontSize as number) ?? 12;
  const titleClr   = escapeHtml((p.titleColor as string) ?? '#111111');
  const rawFont    = p.labelFontFamily as string | undefined;
  const svgFont    = rawFont ? ` font-family="${escapeHtml(normalizeFont(rawFont))}"` : '';
  const divFont    = rawFont ? `font-family:${escapeHtml(normalizeFont(rawFont))};` : '';

  const maxBar  = Math.max(...series.map((s) => s.value), 1);
  const maxLine = Math.max(...series.map((s) => s.value2 ?? 0), 1);
  const hasLine = series.some((s) => s.value2 !== undefined);

  // Title + legend are HTML divs — estimate their combined height to compute SVG space.
  const titleH  = title ? titleSize + 8 : 0;
  const legendH = tSize + 14; // legend HTML row height (computed again later for svgHAdj)

  // SVG viewBox dimensions (1 SVG unit ≈ 1 CSS px, so font sizes match canvas).
  const svgW = Math.max(100, elW - 12);
  const svgH = Math.max(60,  elH - titleH - legendH - 16); // 16 = wrapper padding

  // Internal SVG margins — mirror Recharts ComposedChart defaults in element-chart.tsx.
  // Canvas uses margin.left=-20 (axis clips off) giving more bar space; match by using 24px.
  const mL = leftAxisLabel  ? 50 : 24;
  const mR = rightAxisLabel ? 52 : 36;
  const mT = 8;
  const mB = xAxisLabel ? tSize + 18 : tSize + 4;  // canvas mB = 4 (no x-label)
  const cW = svgW - mL - mR;
  const cH = svgH - mT - mB;
  const n  = series.length;
  // Bar width: Recharts barCategoryGap=10% default → bar occupies ~90% of each slot.
  // Previous 0.45 produced bars that were half the Recharts width.
  const barW = Math.min(18, Math.max(2, (cW / Math.max(n, 1)) * 0.9));
  const step = cW / Math.max(n, 1);

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
    return `<text x="${x.toFixed(1)}" y="${(mT + cH + tSize + 4).toFixed(1)}" text-anchor="middle" font-size="${tSize}" fill="${tColor}"${svgFont}>${escapeHtml(s.name)}</text>`;
  }).join('');

  // 5 ticks at [0, 25%, 50%, 75%, 100%] — matches Recharts' default 5-tick output
  const leftTicks = [0, 0.25, 0.5, 0.75, 1.0].map((f) => {
    const y = mT + cH * (1 - f);
    return `<text x="${(mL - 4).toFixed(1)}" y="${(y + tSize / 3).toFixed(1)}" text-anchor="end" font-size="${tSize}" fill="${tColor}"${svgFont}>${Math.round(maxBar * f)}</text>`;
  }).join('');

  let rightTicks = '';
  let lineEl = '';
  if (hasLine) {
    rightTicks = [0, 0.25, 0.5, 0.75, 1.0].map((f) => {
      const y = mT + cH * (1 - f);
      return `<text x="${(mL + cW + 4).toFixed(1)}" y="${(y + tSize / 3).toFixed(1)}" text-anchor="start" font-size="${tSize}" fill="${tColor}"${svgFont}>${Math.round(maxLine * f)}</text>`;
    }).join('');

    const pts = series.map((s, i) => {
      const x = mL + i * step + step / 2;
      const y = mT + cH - ((s.value2 ?? 0) / maxLine) * cH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const dots = series.map((s, i) => {
      const x = mL + i * step + step / 2;
      const y = mT + cH - ((s.value2 ?? 0) / maxLine) * cH;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${lineColor}"/>`;
    }).join('');
    lineEl = `<polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="2"/>${dots}`;
  }

  // ── Legend: HTML div above SVG so long Khmer text wraps naturally ───────
  // Legend text uses #374151 (text-sub) — canvas Recharts Legend inherits dark page text color,
  // not the gray axis-tick color. tColor (#6b7280) is only for axis ticks.
  const legendTextClr = '#374151';
  const legendHtml = `<div style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:14px;margin-bottom:4px;flex-shrink:0;${divFont}">
    <span style="display:inline-flex;align-items:center;gap:5px;">
      <span style="display:inline-block;width:11px;height:9px;background:${barColor};border-radius:2px;flex-shrink:0;"></span>
      <span style="font-size:${tSize + 1}px;color:${legendTextClr};">${barLabel}</span>
    </span>
    ${hasLine ? `<span style="display:inline-flex;align-items:center;gap:6px;">
      <span style="display:inline-block;position:relative;width:22px;height:${tSize + 2}px;flex-shrink:0;">
        <span style="position:absolute;top:50%;left:0;right:0;height:2px;margin-top:-1px;background:${lineColor};"></span>
        <span style="position:absolute;top:50%;left:50%;width:6px;height:6px;margin-top:-3px;margin-left:-3px;background:${lineColor};border-radius:50%;"></span>
      </span>
      <span style="font-size:${tSize + 1}px;color:${legendTextClr};">${lineLabel}</span>
    </span>` : ''}
  </div>`;

  const svgHAdj = svgH; // already excludes legend height (computed in header)

  // Rotated axis labels
  const leftLabelEl  = leftAxisLabel
    ? `<text transform="rotate(-90)" x="${-(mT + cH / 2).toFixed(0)}" y="${(tSize).toFixed(0)}" text-anchor="middle" font-size="${tSize}" fill="${tColor}"${svgFont}>${escapeHtml(leftAxisLabel)}</text>`
    : '';
  const rightLabelEl = rightAxisLabel
    ? `<text transform="rotate(90)" x="${(mT + cH / 2).toFixed(0)}" y="${-(svgW - tSize).toFixed(0)}" text-anchor="middle" font-size="${tSize}" fill="${tColor}"${svgFont}>${escapeHtml(rightAxisLabel)}</text>`
    : '';
  const xLabelEl = xAxisLabel
    ? `<text x="${(mL + cW / 2).toFixed(1)}" y="${(svgHAdj - 2).toFixed(1)}" text-anchor="middle" font-size="${tSize}" fill="${tColor}"${svgFont}>${escapeHtml(xAxisLabel)}</text>`
    : '';

  return `<div style="width:100%;height:100%;padding:6px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
    ${title ? `<div style="font-size:${titleSize}px;font-weight:600;${divFont}color:${titleClr};text-align:${titleAlign};margin-bottom:4px;flex-shrink:0;">${title}</div>` : ''}
    ${legendHtml}
    <div style="flex:1;min-height:0;">
      <svg width="100%" height="100%" viewBox="0 0 ${svgW} ${svgHAdj}" xmlns="http://www.w3.org/2000/svg" overflow="visible" preserveAspectRatio="none">
        ${grid}${bars}${lineEl}${xLabels}${leftTicks}${rightTicks}${leftLabelEl}${rightLabelEl}${xLabelEl}
      </svg>
    </div>
  </div>`;
}

function renderBarHChartHtml(series: ChartSI[], p: Record<string, unknown>, accent: string, title: string): string {
  const sortDesc     = !!(p.sortDesc);
  const showValues   = !!(p.showBarValues);
  const singleColor  = !!(p.singleColor);
  const showTrack    = !!(p.showBarTrack);
  const valueSuffix  = (p.valueSuffix  as string) ?? '';
  const value2Suffix = (p.value2Suffix as string) ?? '';

  // Typography — defaults mirror element-chart.tsx canvas exactly
  const lSize      = (p.labelFontSize  as number) ?? 9;   // canvas: ?? 9
  const vSize      = (p.valueFontSize  as number) ?? 9;   // canvas: ?? 9
  const lColor     = escapeHtml((p.labelColor  as string) ?? '#6b7280'); // canvas: ?? '#6b7280'
  const vColor     = escapeHtml((p.valueColor  as string) ?? '#6b7280');
  const lAlign     = (p.labelAlign    as string) ?? 'right';
  const titleAlign = (p.titleAlign    as string) ?? 'left';
  const titleSize  = (p.titleFontSize as number) ?? 12;
  const titleClr   = escapeHtml((p.titleColor as string) ?? '#111111');
  const boldLabels = !!(p.boldLabels);
  // normalizeFont strips var(--xxx) CSS variable prefixes — they don't work in Puppeteer HTML
  const rawFont    = p.labelFontFamily as string | undefined;
  const fontFam    = rawFont ? `font-family:${escapeHtml(normalizeFont(rawFont))};` : '';
  // Bar height as % of row — mirrors canvas barHeightScale prop (default 0.7)
  const barHPct    = Math.round(((p.barHeightScale as number) ?? 0.7) * 100);

  const sorted  = sortDesc ? [...series].sort((a, b) => b.value - a.value) : series;
  const dataMax = Math.max(...sorted.map((s) => s.value), 1);

  // Round up to a "nice" axis max the same way Recharts does
  const magnitude = Math.pow(10, Math.floor(Math.log10(dataMax)));
  const step      = magnitude >= 1 ? magnitude : 1;
  const axisMax   = Math.ceil(dataMax / step) * step || 1;

  const ticks  = [0, 0.25, 0.5, 0.75, 1.0].map((f) => Math.round(axisMax * f));
  const labelW = (p.labelWidth as number) ?? 80;  // canvas: ?? 80
  // Respect the configured right margin; default wider when a suffix is present
  const valueW = showValues
    ? ((p.valueRightMargin as number) ?? (valueSuffix || value2Suffix ? 120 : 72))
    : 0;

  // Format number with commas; abbreviate to K/M for axis ticks to save space
  const fmtNum = (v: number) => v.toLocaleString('en-US');
  const fmtAxis = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
    if (v >= 1_000)     return `${(v / 1_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K`;
    return String(v);
  };

  const rowGap = (p.barRowGap as number) ?? 6;

  // Each row uses flex:1 so bars fill the container height naturally — no fixed px height
  const rows = sorted.map((s) => {
    // No Math.round — canvas uses raw fraction so tiny values (e.g. 0.88/3000 = 0.03%) remain visible
    const pct   = s.value > 0 ? Math.max(0.3, Math.min(100, (s.value / axisMax) * 100)) : 0;
    const color = escapeHtml(singleColor ? accent : (s.color ?? accent));
    const barArea = showTrack
      ? `<div style="flex:1;height:${barHPct}%;background:#e5e7eb;border-radius:3px;overflow:hidden;">
           <div style="height:100%;width:${pct}%;background:${color};border-radius:0 3px 3px 0;"></div>
         </div>`
      : `<div style="flex:1;height:${barHPct}%;overflow:hidden;">
           <div style="height:100%;width:${pct}%;background:${color};border-radius:0 3px 3px 0;min-height:1px;"></div>
         </div>`;
    const numStr  = fmtNum(s.value);
    const v2part  = s.value2 !== undefined && value2Suffix
      ? ` (${fmtNum(s.value2)} ${value2Suffix})`
      : '';
    const displayVal = escapeHtml(`${numStr}${valueSuffix ? ' ' + valueSuffix : ''}${v2part}`);
    return `<div style="flex:1;min-height:12px;display:flex;align-items:center;gap:6px;">
      <div style="width:${labelW}px;font-size:${lSize}px;${fontFam}color:${lColor};font-weight:${boldLabels ? 600 : 'normal'};text-align:${lAlign};flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(s.name)}</div>
      ${barArea}
      ${showValues ? `<div style="width:${valueW}px;font-size:${vSize}px;${fontFam}color:${vColor};flex-shrink:0;text-align:right;white-space:nowrap;">${displayVal}</div>` : ''}
    </div>`;
  }).join('');

  // X-axis tick row — gap:6 matches canvas inner row gap (was 8)
  const axisRow = `<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
    <div style="width:${labelW}px;flex-shrink:0;"></div>
    <div style="flex:1;position:relative;height:14px;">
      ${ticks.map((t) => {
        const left = Math.round((t / axisMax) * 100);
        return `<span style="position:absolute;left:${left}%;transform:translateX(-50%);font-size:${Math.max(8, lSize - 1)}px;${fontFam}color:#9ca3af;">${fmtAxis(t)}</span>`;
      }).join('')}
    </div>
    ${showValues ? `<div style="width:${valueW}px;flex-shrink:0;"></div>` : ''}
  </div>`;

  return `<div style="width:100%;height:100%;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
    ${title ? `<div style="font-size:${titleSize}px;font-weight:600;${fontFam}color:${titleClr};text-align:${titleAlign};margin-bottom:6px;flex-shrink:0;">${title}</div>` : ''}
    <div style="flex:1;min-height:0;display:flex;flex-direction:column;gap:${rowGap}px;">
      ${rows}
    </div>
    <div style="margin-top:4px;">${axisRow}</div>
  </div>`;
}

// ── SVG pie / donut chart ─────────────────────────────────────────────────────

function pdfPieLabelText(name: string, value: number, pct: number, type: string): string {
  const ps = `${pct.toFixed(0)}%`;
  if (type === 'name')        return name;
  if (type === 'percent')     return ps;
  if (type === 'value')       return String(value);
  if (type === 'name-value')  return `${name}: ${value}`;
  return `${name} ${ps}`; // name-percent (default)
}

function renderPieChartHtml(series: ChartSI[], title: string, p: Record<string, unknown> = {}): string {
  const PALETTE = ['#6366f1','#f59e0b','#22c55e','#ef4444','#06b6d4','#ec4899','#8b5cf6','#14b8a6','#f97316','#64748b'];
  const total = series.reduce((s, item) => s + item.value, 0);
  if (!total) return `<div style="padding:10px;color:#9ca3af;font-size:11px;">No data</div>`;

  // Typography / style props
  const rawFont    = p.labelFontFamily as string | undefined;
  const svgFont    = rawFont ? ` font-family="${escapeHtml(normalizeFont(rawFont))}"` : '';
  const fontFam    = rawFont ? `font-family:${escapeHtml(normalizeFont(rawFont))};` : '';
  const titleAlign = (p.titleAlign    as string) ?? 'left';
  const titleSize  = (p.titleFontSize as number) ?? 12;
  const titleClr   = escapeHtml((p.titleColor  as string) ?? '#111111');
  const lSize      = (p.labelFontSize as number) ?? 10;
  const lColor     = escapeHtml((p.labelColor  as string) ?? '#374151');
  const pieStyle   = (p.pieStyle      as string) ?? 'solid';
  const innerPct   = (p.innerRadius   as number) ?? 35;
  const pieLabelP  = (p.pieLabel      as string) ?? 'outside';
  const labelType  = (p.labelContent  as string) ?? 'name-percent';
  const showLine   = (p.labelLine as boolean) !== false && pieLabelP === 'outside';
  const showLegend = !!(p.showLegend) || pieLabelP !== 'outside';

  // Single-slice fallback
  if (series.length === 1) {
    const s = series[0];
    const color = s.color ?? PALETTE[0];
    return `<div style="width:100%;padding:12px;">
      ${title ? `<div style="font-size:${titleSize}px;font-weight:600;${fontFam}color:${titleClr};text-align:${titleAlign};margin-bottom:10px;">${title}</div>` : ''}
      <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:12px;border:1.5px solid ${escapeHtml(color)}20;background:${escapeHtml(color)}08;">
        <div style="width:44px;height:44px;border-radius:50%;background:${escapeHtml(color)};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <span style="font-size:16px;font-weight:700;color:white;">100%</span>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:#111;">${escapeHtml(s.name)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">Value: ${escapeHtml(String(s.value))}</div>
        </div>
      </div>
    </div>`;
  }

  // ── SVG geometry ──────────────────────────────────────────────────────────
  // Leave a margin for outside labels. viewBox is 320×320 to give more room.
  const vb = 320;
  const cx = vb / 2, cy = vb / 2;
  // Outer radius: smaller when we have outside labels so they fit in the viewBox
  const r  = pieLabelP === 'outside' ? 88 : 110;
  const ir = pieStyle === 'donut' ? Math.round(r * (innerPct / 100)) : 0;

  const slices: string[] = [];
  const labels: string[] = [];
  const lines:  string[] = [];
  let cur = -Math.PI / 2;

  for (let i = 0; i < series.length; i++) {
    const s     = series[i];
    const pct   = (s.value / total) * 100;
    const slice = (s.value / total) * 2 * Math.PI;
    const end   = cur + slice;
    const color = s.color ?? PALETTE[i % PALETTE.length];
    const large = slice > Math.PI ? 1 : 0;
    const mid   = cur + slice / 2;

    // ── Slice path ───────────────────────────────────────────────────────
    const x1 = cx + r  * Math.cos(cur), y1 = cy + r  * Math.sin(cur);
    const x2 = cx + r  * Math.cos(end), y2 = cy + r  * Math.sin(end);

    let d: string;
    if (ir > 0) {
      // Donut: arc on outer rim + arc back on inner rim
      const i1 = cx + ir * Math.cos(cur), j1 = cy + ir * Math.sin(cur);
      const i2 = cx + ir * Math.cos(end), j2 = cy + ir * Math.sin(end);
      d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r},0,${large},1,${x2.toFixed(1)},${y2.toFixed(1)}`
        + ` L${i2.toFixed(1)},${j2.toFixed(1)} A${ir},${ir},0,${large},0,${i1.toFixed(1)},${j1.toFixed(1)} Z`;
    } else {
      // Solid pie: fan from center
      d = `M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r},0,${large},1,${x2.toFixed(1)},${y2.toFixed(1)} Z`;
    }
    slices.push(`<path d="${escapeHtml(d)}" fill="${escapeHtml(color)}" stroke="white" stroke-width="1.5"/>`);

    // ── Inside label (% in slice) ─────────────────────────────────────────
    if (pieLabelP === 'inside' && pct >= 5) {
      const lr = ir > 0 ? (ir + r) / 2 : r * 0.6;
      const lx = cx + lr * Math.cos(mid);
      const ly = cy + lr * Math.sin(mid);
      labels.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="${lSize}" font-weight="600" fill="white"${svgFont}>${escapeHtml(pdfPieLabelText(s.name, s.value, pct, labelType))}</text>`);
    }

    // ── Outside label with leader line ────────────────────────────────────
    if (pieLabelP === 'outside' && pct >= 1) {
      const labelR  = r + 28;
      const kinkR   = r + 14;
      const kinkX   = cx + kinkR  * Math.cos(mid);
      const kinkY   = cy + kinkR  * Math.sin(mid);
      const rimX    = cx + r      * Math.cos(mid);
      const rimY    = cy + r      * Math.sin(mid);
      const lx      = cx + labelR * Math.cos(mid);
      const ly      = cy + labelR * Math.sin(mid);
      const onRight = Math.cos(mid) >= 0;
      const hLen    = 10;
      const endX    = lx + (onRight ? hLen : -hLen);
      const anchor  = onRight ? 'start' : 'end';
      const textX   = (endX + (onRight ? 3 : -3)).toFixed(1);

      if (showLine) {
        lines.push(`<polyline points="${rimX.toFixed(1)},${rimY.toFixed(1)} ${kinkX.toFixed(1)},${kinkY.toFixed(1)} ${endX.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="#9ca3af" stroke-width="0.8"/>`);
      }

      // Name + optional suffix
      const suffix = (p.labelNameSuffix as string) ?? '';
      const nameT  = escapeHtml(suffix ? `${s.name}${suffix}` : s.name);
      const pctStr = `${pct.toFixed(0)}%`;
      const lineH  = (lSize * 1.3).toFixed(1);

      if (labelType === 'name-percent' || labelType === 'name-value') {
        // Two lines: name on top, value/% below
        const line2 = escapeHtml(labelType === 'name-percent' ? pctStr : String(s.value));
        const topY  = (ly - lSize * 0.65).toFixed(1);
        labels.push(`<text x="${textX}" y="${topY}" text-anchor="${anchor}" font-size="${lSize}" fill="${lColor}"${svgFont}><tspan x="${textX}" dy="0">${nameT}</tspan><tspan x="${textX}" dy="${lineH}">${line2}</tspan></text>`);
      } else {
        // Single line
        const raw = pdfPieLabelText(s.name, s.value, pct, labelType);
        const content = escapeHtml(labelType === 'name' && suffix ? `${raw}${suffix}` : raw);
        labels.push(`<text x="${textX}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${lSize}" fill="${lColor}"${svgFont}>${content}</text>`);
      }
    }

    cur = end;
  }

  // ── Center label (donut) ──────────────────────────────────────────────
  const centerLabelProp = (p.centerLabel as string) ?? 'none';
  let centerEl = '';
  if (ir > 0 && centerLabelProp !== 'none') {
    const cv = centerLabelProp === 'total' ? String(total) : escapeHtml((p.centerText as string) ?? '');
    const cfs = (p.centerFontSize as number) ?? 24;
    const cfc = escapeHtml((p.centerColor as string) ?? '#111111');
    centerEl = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${cfs}" font-weight="700" fill="${cfc}"${svgFont}>${cv}</text>`;
  }

  // ── Bottom legend ─────────────────────────────────────────────────────
  const legendHtml = showLegend ? `<div style="display:flex;flex-wrap:wrap;justify-content:center;padding-top:4px;flex-shrink:0;">
    ${series.map((s, i) => {
      const color = s.color ?? PALETTE[i % PALETTE.length];
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;margin-bottom:3px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(color)};flex-shrink:0;"></span>
        <span style="font-size:9px;${fontFam}color:#374151;">${escapeHtml(s.name)}</span>
      </span>`;
    }).join('')}
  </div>` : '';

  return `<div style="width:100%;height:100%;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
    ${title ? `<div style="font-size:${titleSize}px;font-weight:600;${fontFam}color:${titleClr};text-align:${titleAlign};margin-bottom:6px;flex-shrink:0;">${title}</div>` : ''}
    <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
      <svg viewBox="0 0 ${vb} ${vb}" style="width:auto;height:auto;max-width:100%;max-height:100%;">
        ${slices.join('')}${lines.join('')}${labels.join('')}${centerEl}
      </svg>
    </div>
    ${legendHtml}
  </div>`;
}

// ── Main chart dispatcher ─────────────────────────────────────────────────────

function renderChartHtml(data: WidgetData | undefined, p: Record<string, unknown>, elW = 500, elH = 300): string {
  const chartType = (p.chartType as string) ?? 'bar';
  const accent    = (p.colorScheme as string) ?? (chartType === 'bar-line' ? '#5b9bd5' : '#6366f1');
  const title     = escapeHtml((p.title as string) ?? '');

  // Render seriesData whether it came from a live datasource or manual entry
  if (Array.isArray(p.seriesData) && (p.seriesData as unknown[]).length > 0) {
    const series = p.seriesData as ChartSI[];

    if (chartType === 'bar-line') return renderBarLineChartHtml(series, p, accent, title, elW, elH);
    if (chartType === 'bar-h')    return renderBarHChartHtml(series, p, accent, title);
    if (chartType === 'pie')      return renderPieChartHtml(series, title, p);

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
