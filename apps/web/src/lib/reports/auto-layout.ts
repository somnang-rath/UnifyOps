import type { ReportElement, ReportPage, ReportTemplate } from '@/schemas/report';
import { PAGE_CANVAS_SIZES } from '@/schemas/report';

// ReportPage extended with auto-layout tracking field
type AutoPage = ReportPage & { sourceTableId?: string };

// ── Grouped-table helpers ─────────────────────────────────────────────────────

interface GTGroup { key: string; totalDetailRows: number; }

function buildGTGroups(el: ReportElement): GTGroup[] {
  const p          = (el.props ?? {}) as Record<string, unknown>;
  const rawData    = (p.rawData as Record<string, unknown>[]) ?? [];
  const groupField = (p.groupByField as string) ?? 'company_kh';
  const detField   = (p.detailField  as string) ?? 'chargers_detail';
  const groups: GTGroup[] = [];
  const idxMap = new Map<string, number>();
  for (const siteRow of rawData) {
    let gKey = '';
    const parts = groupField.split('.');
    let cur: unknown = siteRow;
    for (const pt of parts) {
      if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) { cur = undefined; break; }
      cur = (cur as Record<string, unknown>)[pt];
    }
    gKey = String(cur ?? '');
    const details = (siteRow[detField] as unknown[] | undefined) ?? [];
    if (!idxMap.has(gKey)) { idxMap.set(gKey, groups.length); groups.push({ key: gKey, totalDetailRows: 0 }); }
    groups[idxMap.get(gKey)!].totalDetailRows += Math.max(1, details.length);
  }
  return groups;
}

// Returns how many groups (starting at startIdx) fit within height h, including the table header.
function calcGTGroupsFitH(el: ReportElement, h: number, groups: GTGroup[], startIdx = 0): number {
  const p      = (el.props ?? {}) as Record<string, unknown>;
  const hPy    = (p.headerPaddingY as number) ?? 7;
  const hFs    = (p.headerFontSize as number) ?? (p.fontSize as number) ?? 10;
  const cellPy = (p.cellPaddingY   as number) ?? 5;
  const fs     = (p.fontSize       as number) ?? 10;
  const headerH = hPy * 2 + Math.ceil(hFs * 1.3) + 1;
  const rowH    = cellPy * 2 + Math.ceil(fs  * 1.3) + 1;
  let remaining = h - headerH;
  let fit = 0;
  for (let i = startIdx; i < groups.length; i++) {
    const groupH = groups[i].totalDetailRows * rowH;
    if (remaining < groupH && fit > 0) break;
    remaining -= groupH;
    fit++;
  }
  return Math.max(1, fit);
}

// Natural content height for a slice of groups (header + rows, no overflow indicator).
function calcGTSliceH(el: ReportElement, groups: GTGroup[], startIdx: number, endIdx: number): number {
  const p      = (el.props ?? {}) as Record<string, unknown>;
  const hPy    = (p.headerPaddingY as number) ?? 7;
  const hFs    = (p.headerFontSize as number) ?? (p.fontSize as number) ?? 10;
  const cellPy = (p.cellPaddingY   as number) ?? 5;
  const fs     = (p.fontSize       as number) ?? 10;
  const headerH = hPy * 2 + Math.ceil(hFs * 1.3) + 1;
  const rowH    = cellPy * 2 + Math.ceil(fs  * 1.3) + 1;
  let totalRows = 0;
  for (let i = startIdx; i < endIdx && i < groups.length; i++) totalRows += groups[i].totalDetailRows;
  return headerH + totalRows * rowH;
}

// ── Row-fit helpers ───────────────────────────────────────────────────────────

function calcRowsFit(el: ReportElement): number {
  return calcRowsFitH(el, el.h);
}

function calcRowsFitH(el: ReportElement, h: number): number {
  const p = (el.props ?? {}) as Record<string, unknown>;
  const hPy     = (p.headerPaddingY as number) ?? 8;
  const hFs     = (p.headerFontSize as number) ?? (p.fontSize as number) ?? 12;
  const cPy     = (p.cellPaddingY as number)   ?? 6;
  const fs      = (p.fontSize as number)       ?? 12;
  const urlBarH = p.dataSource ? 22 : 0;
  // Use CSS line-height ≈ 1.5× font size to match Puppeteer/browser rendering.
  // Without this, rows are under-estimated in height causing overflow in PDF output.
  const headerH = hPy * 2 + Math.ceil(hFs * 1.5) + 2;
  const rowH    = cPy * 2 + Math.ceil(fs  * 1.5) + 1;
  return Math.max(1, Math.floor((h - headerH - urlBarH) / rowH));
}

// Natural height of the last continuation table (header + N rows).
// The last continuation has no overflow indicator, so we don't add the indicator height.
function calcLastContH(el: ReportElement, rowCount: number): number {
  const p = (el.props ?? {}) as Record<string, unknown>;
  const hPy     = (p.headerPaddingY as number) ?? 8;
  const hFs     = (p.headerFontSize as number) ?? (p.fontSize as number) ?? 12;
  const cPy     = (p.cellPaddingY as number)   ?? 6;
  const fs      = (p.fontSize as number)       ?? 12;
  const urlBarH = p.dataSource ? 22 : 0;
  const headerH = hPy * 2 + Math.ceil(hFs * 1.5) + 2;
  const rowH    = cPy * 2 + Math.ceil(fs  * 1.5) + 1;
  return headerH + urlBarH + rowCount * rowH;
}

// ── Signature for change-detection ───────────────────────────────────────────
// Uses the *effective* original height (autoOriginalH ?? el.h) so the sig stays
// stable after a stretch is applied, preventing infinite re-layout loops.

export function autoLayoutSig(elements: ReportElement[], canvasH = 0, marginTop = 0, marginBottom = 0, footerH = 0, headerH = 0): string {
  const tableSig = elements
    .filter((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      return (
        el.type === 'table' &&
        p.autoPageBreak !== false &&
        !p.isContinuation &&
        !p.autoGenerated
      );
    })
    .map((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      const rows          = (p.rows as unknown[]) ?? [];
      const effectiveH    = (p.autoOriginalH as number | undefined) ?? el.h;
      const footerEnabled = !!(p.footerRowEnabled);
      return `${el.id}|${effectiveH}|${el.y}|${rows.length}|${el.page ?? 0}|${footerEnabled}`;
    })
    .join('::');

  const gtSig = elements
    .filter((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      return (
        el.type === 'grouped-table' &&
        p.autoPageBreak !== false &&
        !p.isContinuation &&
        !p.autoGenerated
      );
    })
    .map((el) => {
      const p       = (el.props ?? {}) as Record<string, unknown>;
      const rawData = (p.rawData as unknown[]) ?? [];
      const effectiveH = (p.autoOriginalH as number | undefined) ?? el.h;
      return `${el.id}|${effectiveH}|${el.y}|${rawData.length}|${el.page ?? 0}`;
    })
    .join('::');

  return `${canvasH}|${marginTop}|${marginBottom}|${footerH}|${headerH}|${tableSig}||gt:${gtSig}`;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function computeAutoLayout(
  template: ReportTemplate,
  fitHints?: Record<string, number>,
): { pages: ReportPage[]; elements: ReportElement[] } | null {
  // Derive canvas height from the template's page-size / orientation
  const ps           = PAGE_CANVAS_SIZES[template.pageSize] ?? PAGE_CANVAS_SIZES.A4;
  const canvasH      = template.orientation === 'landscape' ? ps.w : ps.h;
  const marginTop    = template.margins?.top    ?? 0;
  const marginBottom = template.margins?.bottom ?? 0;

  // Header/footer overlays sit at z-index:9000 over the page.  Tables must not
  // render rows into their area or those rows will be hidden/clipped in the PDF.
  const footerOverlay = template.footer?.enabled ? (template.footer?.height ?? 0) : 0;
  const headerOverlay = template.header?.enabled ? (template.header?.height ?? 0) : 0;
  // Effective clearances: whichever is larger between the margin guide and the overlay.
  const effectiveTop    = Math.max(marginTop,    headerOverlay);
  const effectiveBottom = Math.max(marginBottom, footerOverlay);

  const originalPages    = (
    template.pages?.length ? template.pages : [{ id: 'page-0' }]
  ) as AutoPage[];
  const originalElements = template.elements ?? [];

  // Source tables: non-continuation, non-auto-generated, autoPageBreak not explicitly disabled
  const autoTables = originalElements.filter((el) => {
    const p = (el.props ?? {}) as Record<string, unknown>;
    return (
      el.type === 'table' &&
      p.autoPageBreak !== false &&
      !p.isContinuation &&
      !p.autoGenerated
    );
  });

  const autoGroupedTables = originalElements.filter((el) => {
    const p = (el.props ?? {}) as Record<string, unknown>;
    return (
      el.type === 'grouped-table' &&
      p.autoPageBreak !== false &&
      !p.isContinuation &&
      !p.autoGenerated
    );
  });

  // ── Orphan cleanup ───────────────────────────────────────────────────────────
  // When a table previously had autoPageBreak=true but no longer does (e.g. user
  // switched to autoHeight), computeAutoLayout normally skips it entirely.  But
  // the auto-generated continuation pages/elements from the previous run are still
  // in the template.  Detect and remove them here before the early-return guard.
  if (autoTables.length === 0 && autoGroupedTables.length === 0) {
    const hasOrphanPages = originalPages.some((pg) => (pg as AutoPage).sourceTableId);
    const hasOrphanEls   = originalElements.some((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      return p.autoGenerated || p.autoMovedFromTableId;
    });
    if (!hasOrphanPages && !hasOrphanEls) return null;

    // Remove auto-generated elements
    let cleanEls = originalElements.filter((el) => !(el.props as Record<string, unknown>).autoGenerated);

    // Restore any auto-moved elements to their original position
    cleanEls = cleanEls.map((el) => {
      const p = el.props as Record<string, unknown>;
      if (!p.autoMovedFromTableId) return el;
      const { autoMovedFromPage, autoMovedFromTableId: _id, autoMovedOriginalY, ...restProps } = p;
      return {
        ...el,
        page:  autoMovedFromPage as number,
        y:     autoMovedOriginalY !== undefined ? (autoMovedOriginalY as number) : el.y,
        props: restProps,
      };
    });

    // Strip autoOriginalH / endRow left on former source tables
    cleanEls = cleanEls.map((el) => {
      const p = el.props as Record<string, unknown>;
      if (p.autoOriginalH === undefined && p.endRow === undefined) return el;
      const { endRow: _e, autoOriginalH, ...restProps } = p;
      return { ...el, h: autoOriginalH !== undefined ? (autoOriginalH as number) : el.h, props: restProps };
    });

    // Remove orphaned auto-generated pages and re-index
    const orphanPageIdxs = new Set(
      originalPages.map((pg, i) => ((pg as AutoPage).sourceTableId ? i : -1)).filter((i) => i >= 0),
    );
    const keptIdxs = originalPages.map((_, i) => i).filter((i) => !orphanPageIdxs.has(i));
    const oldToNew = new Map(keptIdxs.map((oldI, newI) => [oldI, newI]));
    const cleanPages = originalPages.filter((_, i) => !orphanPageIdxs.has(i));
    cleanEls = cleanEls.map((el) => ({
      ...el,
      page: oldToNew.get(el.page ?? 0) ?? (el.page ?? 0),
    }));

    const pagesEq = cleanPages.length === originalPages.length &&
      cleanPages.every((pg, i) => JSON.stringify(pg) === JSON.stringify(originalPages[i]));
    const elsEq = cleanEls.length === originalElements.length &&
      cleanEls.every((el, i) => JSON.stringify(el) === JSON.stringify(originalElements[i]));
    if (pagesEq && elsEq) return null;

    return { pages: cleanPages as ReportPage[], elements: cleanEls };
  }

  let workPages    = [...originalPages] as AutoPage[];
  let workElements = [...originalElements];

  for (const tableEl of autoTables) {
    const tableId = tableEl.id;

    // ── 1. Restore previously auto-moved elements (page + y) ──────────────
    workElements = workElements.map((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      if (p.autoMovedFromTableId === tableId && p.autoMovedFromPage !== undefined) {
        const { autoMovedFromPage, autoMovedFromTableId, autoMovedOriginalY, ...restProps } = p;
        return {
          ...el,
          page: autoMovedFromPage as number,
          y:    autoMovedOriginalY !== undefined ? (autoMovedOriginalY as number) : el.y,
          props: restProps,
        };
      }
      return el;
    });

    // ── 2. Remove auto-generated content; restore original table height ────
    const autoPageIdxs = new Set<number>();
    workPages.forEach((pg, i) => {
      if (pg.sourceTableId === tableId) autoPageIdxs.add(i);
      // Fallback: match by id prefix for templates saved before sourceTableId was preserved
      else if (typeof pg.id === 'string' && pg.id.startsWith(`al-${tableId}-`)) autoPageIdxs.add(i);
    });

    workElements = workElements.filter((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      return !(p.autoGenerated && p.sourceTableId === tableId);
    });

    // Restore original h (saved as autoOriginalH) and clear pagination props
    workElements = workElements.map((el) => {
      if (el.id !== tableId) return el;
      const p = (el.props ?? {}) as Record<string, unknown>;
      const { endRow: _e, autoOriginalH, ...restProps } = p;
      return {
        ...el,
        h:     autoOriginalH !== undefined ? (autoOriginalH as number) : el.h,
        props: restProps,
      };
    });

    // Remove auto-generated pages and re-index remaining elements
    if (autoPageIdxs.size > 0) {
      const keptIdxs = workPages.map((_, i) => i).filter((i) => !autoPageIdxs.has(i));
      const oldToNew = new Map(keptIdxs.map((oldI, newI) => [oldI, newI]));
      workPages       = workPages.filter((_, i) => !autoPageIdxs.has(i));
      workElements    = workElements.map((el) => ({
        ...el,
        page: oldToNew.get(el.page ?? 0) ?? (el.page ?? 0),
      }));
    }

    // ── 3. Re-fetch table after mutations ────────────────────────────────────
    const tEl = workElements.find((el) => el.id === tableId);
    if (!tEl) continue;

    const p          = tEl.props as Record<string, unknown>;
    const allRows    = (p.rows as Record<string, unknown>[]) ?? [];
    const sourcePage = tEl.page ?? 0;

    // ── 3.5. Overflow check against the ORIGINAL (restored) height ───────────
    //  Case 1 — no overflow: nothing to do.
    //  Use the DOM-measured hint when available — formula underestimates row heights
    //  for multi-line text, causing rows to silently clip instead of paginating.
    const origTableH  = tEl.h;
    const hintFit     = fitHints?.[tableId];

    // Always use the page-filling height so stretchedH never exceeds one page.
    // Using Math.max(origTableH, …) was wrong when origTableH was inflated by
    // autoHeight (all rows + footer), causing the source element to extend beyond
    // the canvas when the footer row was added before Auto Page Break was enabled.
    const stretchedH  = canvasH - tEl.y;
    const IND         = 24; // overflow indicator height
    const CONT_BADGE  = 20; // "Continued from previous page" badge

    const _tElPp  = tEl.props as Record<string, unknown>;
    const urlBarH = _tElPp.dataSource ? 22 : 0;
    const _hPy    = (_tElPp.headerPaddingY as number) ?? 8;
    const _hFs    = (_tElPp.headerFontSize as number) ?? (_tElPp.fontSize as number) ?? 12;
    const headerH = _hPy * 2 + Math.ceil(_hFs * 1.5) + 2;

    // Footer row height — computed early so it can be used in both the special-case
    // block (effectiveHintFit >= allRows.length) and Case 2 (allRows.length <= rowsFit).
    const _fs     = (_tElPp.fontSize as number) ?? 12;
    const _cellPy = (_tElPp.cellPaddingY as number) ?? 6;
    const _fFs    = (_tElPp.footerRowFontSize as number) ?? Math.max(9, Math.round(_fs * 0.9));
    const footerH = _tElPp.footerRowEnabled ? _cellPy * 2 + _fFs + 2 : 0;

    // Cap the DOM-measured hint at the formula-safe row count (excluding footer
    // clearance).  The DOM measurement in element-table.tsx has no awareness of
    // the footer overlay — `available = areaH - theadH` uses the full canvas height —
    // so hintFit can include rows that fall inside the footer area.  Those rows are
    // hidden behind the footer in the PDF but are counted, which inflates
    // hintedAvgRowH and packs too many rows into continuation pages.
    const safeFormula      = calcRowsFitH(tEl, stretchedH - effectiveBottom - IND - footerH);
    const effectiveHintFit = hintFit != null ? Math.min(hintFit, safeFormula) : null;
    // Subtract footerH so that when el.h was expanded to include the summary
    // footer row, the formula doesn't over-count rows and skip pagination.
    const origRowsFit      = effectiveHintFit ?? calcRowsFitH(tEl, tEl.h - footerH);

    // ── Special case: footer-safe DOM hint says ALL rows fit ──────────────────
    //  The underflow detection in element-table.tsx can raise hintFit to
    //  allRows.length when it finds the formula over-estimated row height.
    //  In that situation we still want to stretch the element (so it fills the
    //  page and the guard `autoOriginalH !== undefined` stays satisfied for
    //  future DOM measurements), but we must NOT set an endRow or create any
    //  continuation pages — every row is shown on the source page.
    if (effectiveHintFit !== null && effectiveHintFit >= allRows.length) {
      // Fill the full page canvas — do NOT subtract marginBottom here.
      // Row stretching (perRowH in element-table.tsx + PDF generator) distributes
      // content within the element so rows never enter the margin area, while the
      // element boundary itself reaching canvasH eliminates the blank gap below the
      // indicator that was visible in the design canvas.
      if (stretchedH !== origTableH) {
        // Re-apply stretch or shrink so the element fills exactly one page and
        // autoOriginalH is preserved.  The shrink path is needed when origTableH
        // was inflated by autoHeight (footer-first scenario) and effectiveHintFit
        // confirms all rows still fit within the corrected (smaller) stretchedH.
        workElements = workElements.map((el) =>
          el.id === tableId
            ? { ...el, h: stretchedH, props: { ...el.props, autoOriginalH: origTableH } }
            : el,
        );
        // Move any below-table elements to a new page (same logic as Case 2).
        const origTableBottom2 = tEl.y + origTableH;
        const belowIdsFull = new Set(
          workElements
            .filter(
              (el) =>
                (el.page ?? 0) === sourcePage &&
                el.id !== tableId &&
                el.y >= origTableBottom2,
            )
            .map((el) => el.id),
        );
        if (belowIdsFull.size > 0) {
          // If all below elements fit on the same page right after the natural table
          // height, keep them there instead of creating an unnecessary new page.
          const naturalH35 = Math.max(origTableH, Math.min(stretchedH, calcLastContH(tEl, allRows.length) + footerH));
          const naturalBottom35 = tEl.y + naturalH35;
          const belowElsFull = workElements.filter((el) => belowIdsFull.has(el.id));
          const allFitFull = belowElsFull.every((el) => {
            const gap = Math.max(0, el.y - origTableBottom2);
            return naturalBottom35 + gap + el.h <= canvasH - effectiveBottom;
          });

          if (allFitFull) {
            // Use natural height; reposition below elements on same page.
            // Use autoMovedOriginalY as baseline to prevent y drift across mounts.
            workElements = workElements.map((el) => {
              if (el.id === tableId) return { ...el, h: naturalH35 };
              if (belowIdsFull.has(el.id)) {
                const origY = (el.props as Record<string, unknown>).autoMovedOriginalY as number | undefined ?? el.y;
                const gap = Math.max(0, origY - origTableBottom2);
                return {
                  ...el,
                  y: naturalBottom35 + gap,
                  props: {
                    ...el.props,
                    autoMovedFromPage:    sourcePage,
                    autoMovedFromTableId: tableId,
                    autoMovedOriginalY:   origY,
                  },
                };
              }
              return el;
            });
          } else {
            const insertIdx = sourcePage + 1;
            workPages = [
              ...workPages.slice(0, insertIdx),
              {
                id:            `al-${tableId}-p${insertIdx}`,
                background:    workPages[sourcePage]?.background,
                sourceTableId: tableId,
              } as AutoPage,
              ...workPages.slice(insertIdx),
            ];
            workElements = workElements.map((el) => {
              if (belowIdsFull.has(el.id)) return el;
              const elPage = el.page ?? 0;
              return elPage >= insertIdx ? { ...el, page: elPage + 1 } : el;
            });
            workElements = workElements.map((el) => {
              if (!belowIdsFull.has(el.id)) return el;
              const gap = Math.max(0, el.y - origTableBottom2);
              return {
                ...el,
                page:  insertIdx,
                y:     effectiveTop + gap,
                props: {
                  ...el.props,
                  autoMovedFromPage:    sourcePage,
                  autoMovedFromTableId: tableId,
                  autoMovedOriginalY:   el.y,
                },
              };
            });
          }
        }
      }
      continue; // no endRow, no continuation pages
    }

    if (allRows.length <= origRowsFit) continue;

    // Has overflow → stretch table to fill the full page canvas.
    // stretchedH, IND, CONT_BADGE, _tElPp, urlBarH, headerH already computed above.

    // rowsFit: how many rows fit in the source table.  effectiveHintFit is already
    // capped at safeFormula (footer-excluded count), so this is always footer-safe.
    const rowsFit = effectiveHintFit ?? safeFormula;

    // Average actual row height from the DOM measurement.
    // Numerator uses the actual DOM-available height (stretchedH - IND - headerH),
    // NOT footer-adjusted, so it reflects true measured row heights.
    // effectiveHintFit is already capped at safeFormula, so when the cap was applied
    // the denominator is smaller → hintedAvgRowH is generously estimated (conservative).
    const hintedAvgRowH: number | null =
      effectiveHintFit != null && effectiveHintFit > 0
        ? (stretchedH - IND - headerH - urlBarH) / effectiveHintFit
        : null;

    // Usable height per continuation page: full canvas minus header/footer overlays and page margins.
    const contPageH   = canvasH - effectiveTop - effectiveBottom;
    // Reserve footerH on every continuation page — we don't know which is last ahead of time,
    // and the summary footer only renders on the last slice.  Being conservative here ensures
    // the last page always has room for the footer without clipping it.
    const contRowsFit = hintedAvgRowH != null
      ? Math.max(1, Math.floor((contPageH - CONT_BADGE - IND - headerH - urlBarH - footerH) / hintedAvgRowH))
      : calcRowsFitH(tEl, contPageH - CONT_BADGE - IND - footerH);

    // Source table fills the page (stretchedH) so the DOM measurement can correctly
    // count how many rows fit at their natural height.  Rows are no longer stretched
    // (perRowH=0), so any blank gap at the bottom is between the last row and the
    // page edge — not inflated row cells.
    workElements = workElements.map((el) =>
      el.id === tableId
        ? { ...el, h: stretchedH, props: { ...el.props, autoOriginalH: origTableH } }
        : el,
    );

    const updatedTEl     = workElements.find((el) => el.id === tableId)!;
    const origTableBottom = tEl.y + origTableH;

    // Elements below the ORIGINAL table bottom (y >= origTableBottom) will be migrated
    const belowIds = new Set(
      workElements
        .filter(
          (el) =>
            (el.page ?? 0) === sourcePage &&
            el.id !== tableId &&
            el.y >= origTableBottom,
        )
        .map((el) => el.id),
    );

    // ── Case 2: all rows fit in the stretched table ───────────────────────────
    //  Prefer keeping below-table elements on the same page when they fit after
    //  the natural (content-only) table height.  Only create a new page when
    //  the elements genuinely overflow the page boundary.
    if (allRows.length <= rowsFit) {
      if (belowIds.size > 0) {
        const naturalH2 = Math.max(
          origTableH,
          Math.min(
            stretchedH,
            (hintedAvgRowH != null
              ? Math.ceil(urlBarH + headerH + allRows.length * hintedAvgRowH)
              : calcLastContH(updatedTEl, allRows.length)) + footerH,
          ),
        );
        const naturalBottom2 = tEl.y + naturalH2;
        const belowEls2 = workElements.filter((el) => belowIds.has(el.id));
        const allFit2 = belowEls2.every((el) => {
          const gap = Math.max(0, el.y - origTableBottom);
          return naturalBottom2 + gap + el.h <= canvasH - effectiveBottom;
        });

        if (allFit2) {
          // Shrink table to natural height; reposition below elements on same page.
          // Use autoMovedOriginalY as the gap baseline so the distance stays stable
          // across mounts (without this, gap grows each mount causing slow overflow).
          workElements = workElements.map((el) => {
            if (el.id === tableId) return { ...el, h: naturalH2 };
            if (belowIds.has(el.id)) {
              const origY = (el.props as Record<string, unknown>).autoMovedOriginalY as number | undefined ?? el.y;
              const gap = Math.max(0, origY - origTableBottom);
              return {
                ...el,
                y: naturalBottom2 + gap,
                props: {
                  ...el.props,
                  autoMovedFromPage:    sourcePage,
                  autoMovedFromTableId: tableId,
                  autoMovedOriginalY:   origY,
                },
              };
            }
            return el;
          });
        } else {
          const insertIdx = sourcePage + 1;
          workPages = [
            ...workPages.slice(0, insertIdx),
            {
              id:            `al-${tableId}-p${insertIdx}`,
              background:    workPages[sourcePage]?.background,
              sourceTableId: tableId,
            } as AutoPage,
            ...workPages.slice(insertIdx),
          ];
          workElements = workElements.map((el) => {
            if (belowIds.has(el.id)) return el;
            const elPage = el.page ?? 0;
            return elPage >= insertIdx ? { ...el, page: elPage + 1 } : el;
          });
          workElements = workElements.map((el) => {
            if (!belowIds.has(el.id)) return el;
            const gap  = Math.max(0, el.y - origTableBottom);
            return {
              ...el,
              page:  insertIdx,
              y:     effectiveTop + gap,
              props: {
                ...el.props,
                autoMovedFromPage:    sourcePage,
                autoMovedFromTableId: tableId,
                autoMovedOriginalY:   el.y,
              },
            };
          });
        }
      }
      continue; // no continuation table needed
    }

    // ── Case 3: still overflow after stretch → create continuation pages ─────
    //  Set endRow on original table to show only the rows that fit
    workElements = workElements.map((el) =>
      el.id === tableId
        ? { ...el, props: { ...el.props, endRow: rowsFit } }
        : el,
    );

    // ── 5. Build continuation slices ─────────────────────────────────────────
    //  Each continuation is inserted right after the source page so that
    //  continuation pages appear immediately after the table, before any other
    //  pages the user placed later in the report.
    let sliceStart     = rowsFit;
    let lastNewPageIdx = sourcePage;
    let lastSliceStart = rowsFit;
    let insertedCount  = 0;

    while (sliceStart < allRows.length) {
      lastSliceStart     = sliceStart;
      const isLast       = sliceStart + contRowsFit >= allRows.length;
      const sliceEnd     = isLast ? undefined : sliceStart + contRowsFit;
      const insertIdx    = sourcePage + 1 + insertedCount;

      // Natural content height for each continuation slice (no blank gap at bottom).
      // Last slice adds footer row height; non-last pages show the overflow indicator.
      const sliceRowCount = isLast ? allRows.length - sliceStart : contRowsFit;
      const thisContH = Math.min(
        contPageH,
        hintedAvgRowH != null
          ? Math.ceil(CONT_BADGE + urlBarH + headerH + sliceRowCount * hintedAvgRowH) + (isLast ? footerH : IND)
          : CONT_BADGE + calcLastContH(updatedTEl, sliceRowCount) + (isLast ? footerH : IND),
      );

      workPages = [
        ...workPages.slice(0, insertIdx),
        {
          id:            `al-${tableId}-r${sliceStart}`,
          background:    workPages[sourcePage]?.background,
          sourceTableId: tableId,
        } as AutoPage,
        ...workPages.slice(insertIdx),
      ];

      // Shift page indices for elements displaced by the insertion
      workElements = workElements.map((el) => {
        if (el.id === tableId) return el; // original table stays on its page
        const elPage = el.page ?? 0;
        return elPage >= insertIdx ? { ...el, page: elPage + 1 } : el;
      });

      workElements = [
        ...workElements,
        {
          ...updatedTEl,
          id:    `al-${tableId}-r${sliceStart}`,
          page:  insertIdx,
          y:     effectiveTop,   // respect the page top margin and header overlay
          h:     thisContH,      // natural height for last slice; full page for others
          props: {
            ...updatedTEl.props,
            startRow:       sliceStart,
            endRow:         sliceEnd,
            isContinuation: true,
            autoGenerated:  true,
            sourceTableId:  tableId,
          },
        },
      ];

      lastNewPageIdx = insertIdx;
      insertedCount++;
      sliceStart     = sliceEnd ?? allRows.length;
    }

    // ── 6. Move below-table elements to the last continuation page ────────────
    if (belowIds.size > 0) {
      const lastBatchCount   = allRows.length - lastSliceStart;
      // Use measured average row height for more accurate placement of below-elements.
      const lastContContentH = hintedAvgRowH != null
        ? Math.ceil(CONT_BADGE + headerH + urlBarH + footerH + lastBatchCount * hintedAvgRowH)
        : CONT_BADGE + footerH + calcLastContH(updatedTEl, lastBatchCount);

      workElements = workElements.map((el) => {
        if (!belowIds.has(el.id)) return el;
        const gap  = Math.max(0, el.y - origTableBottom);
        const newY = effectiveTop + lastContContentH + gap;
        return {
          ...el,
          page:  lastNewPageIdx,
          y:     newY,
          props: {
            ...el.props,
            autoMovedFromPage:    sourcePage,
            autoMovedFromTableId: tableId,
            autoMovedOriginalY:   el.y,
          },
        };
      });
    }
  }

  // ── Grouped-table auto-pagination ────────────────────────────────────────────
  const CONT_BADGE_GT = 20;

  for (const tableEl of autoGroupedTables) {
    const tableId = tableEl.id;

    // 1. Remove previously auto-generated continuation pages/elements for this table
    const autoPageIdxsGT = new Set<number>();
    workPages.forEach((pg, i) => {
      if ((pg as AutoPage).sourceTableId === tableId) autoPageIdxsGT.add(i);
      else if (typeof pg.id === 'string' && pg.id.startsWith(`al-${tableId}-`)) autoPageIdxsGT.add(i);
    });
    workElements = workElements.filter((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      return !(p.autoGenerated && p.sourceTableId === tableId);
    });
    // Restore autoOriginalH
    workElements = workElements.map((el) => {
      if (el.id !== tableId) return el;
      const p = (el.props ?? {}) as Record<string, unknown>;
      const { autoOriginalH, endGroupIdx: _e, ...restProps } = p;
      return { ...el, h: autoOriginalH !== undefined ? (autoOriginalH as number) : el.h, props: restProps };
    });
    if (autoPageIdxsGT.size > 0) {
      const keptIdxs = workPages.map((_, i) => i).filter((i) => !autoPageIdxsGT.has(i));
      const oldToNew = new Map(keptIdxs.map((oldI, newI) => [oldI, newI]));
      workPages    = workPages.filter((_, i) => !autoPageIdxsGT.has(i));
      workElements = workElements.map((el) => ({ ...el, page: oldToNew.get(el.page ?? 0) ?? (el.page ?? 0) }));
    }

    // 2. Re-fetch after mutations
    const tEl = workElements.find((el) => el.id === tableId);
    if (!tEl) continue;

    const groups     = buildGTGroups(tEl);
    if (groups.length === 0) continue;

    const sourcePage  = tEl.page ?? 0;
    const stretchedH  = canvasH - tEl.y;
    const origH       = tEl.h;

    // How many groups fit on the source page
    const groupsFitSource = calcGTGroupsFitH(tEl, stretchedH - effectiveBottom, groups, 0);

    if (groupsFitSource >= groups.length) {
      // All groups fit — stretch element to fill page if needed
      if (stretchedH !== origH) {
        workElements = workElements.map((el) =>
          el.id === tableId
            ? { ...el, h: stretchedH, props: { ...el.props, autoOriginalH: origH } }
            : el,
        );
      }
      continue;
    }

    // Overflow → stretch source to fill page, set endGroupIdx
    workElements = workElements.map((el) =>
      el.id === tableId
        ? { ...el, h: stretchedH, props: { ...el.props, autoOriginalH: origH, endGroupIdx: groupsFitSource } }
        : el,
    );

    const updatedTEl = workElements.find((el) => el.id === tableId)!;

    // 3. Create continuation pages
    let sliceStart    = groupsFitSource;
    let insertedCount = 0;
    const contPageH   = canvasH - effectiveTop - effectiveBottom;

    while (sliceStart < groups.length) {
      const groupsFitCont = calcGTGroupsFitH(tEl, contPageH - CONT_BADGE_GT, groups, sliceStart);
      const isLast        = sliceStart + groupsFitCont >= groups.length;
      const sliceEnd      = isLast ? groups.length : sliceStart + groupsFitCont;
      const insertIdx     = sourcePage + 1 + insertedCount;

      const sliceH = Math.min(
        contPageH,
        CONT_BADGE_GT + calcGTSliceH(tEl, groups, sliceStart, sliceEnd),
      );

      workPages = [
        ...workPages.slice(0, insertIdx),
        { id: `al-${tableId}-g${sliceStart}`, background: workPages[sourcePage]?.background, sourceTableId: tableId } as AutoPage,
        ...workPages.slice(insertIdx),
      ];

      workElements = workElements.map((el) => {
        if (el.id === tableId) return el;
        const elPage = el.page ?? 0;
        return elPage >= insertIdx ? { ...el, page: elPage + 1 } : el;
      });

      workElements = [
        ...workElements,
        {
          ...updatedTEl,
          id:    `al-${tableId}-g${sliceStart}`,
          page:  insertIdx,
          y:     effectiveTop,
          h:     sliceH,
          props: {
            ...updatedTEl.props,
            startGroupIdx:  sliceStart,
            endGroupIdx:    isLast ? undefined : sliceEnd,
            isContinuation: true,
            autoGenerated:  true,
            sourceTableId:  tableId,
            // clear source-only props
            autoOriginalH:  undefined,
          },
        },
      ];

      insertedCount++;
      sliceStart = sliceEnd;
    }
  }

  // Skip onChange when nothing actually changed (prevents spurious dirty flag on load)
  const pagesEq =
    workPages.length === originalPages.length &&
    workPages.every((pg, i) => JSON.stringify(pg) === JSON.stringify(originalPages[i]));
  const elsEq   =
    workElements.length === originalElements.length &&
    workElements.every((el, i) => JSON.stringify(el) === JSON.stringify(originalElements[i]));

  if (pagesEq && elsEq) return null;

  return { pages: workPages as ReportPage[], elements: workElements };
}

// ── Overflow signature for non-table elements ─────────────────────────────────

export function pageOverflowSig(
  elements: ReportElement[],
  template: ReportTemplate,
): string {
  const ps      = PAGE_CANVAS_SIZES[template.pageSize] ?? PAGE_CANVAS_SIZES.A4;
  const canvasH = template.orientation === 'landscape' ? ps.w : ps.h;
  return elements
    .filter((el) => {
      const p = (el.props ?? {}) as Record<string, unknown>;
      if (p.autoGenerated)        return false;
      if (p.autoMovedFromTableId) return false; // auto-layout owns placement of these
      if (el.y + el.h <= canvasH + 5) return false;
      // Skip elements taller than one page — computePageOverflow can't place them.
      const pagesForward = Math.ceil((el.y + el.h - canvasH) / canvasH);
      const maxForward   = Math.floor(el.y / canvasH);
      return pagesForward <= maxForward;
    })
    .map((el) => `${el.id}|${el.page ?? 0}|${el.y}|${el.h}`)
    .join('::');
}

// ── General element page-overflow handler ─────────────────────────────────────
// Moves any non-auto element whose bottom exceeds the canvas height to the next page.

export function computePageOverflow(
  template: ReportTemplate,
): { pages: ReportPage[]; elements: ReportElement[] } | null {
  const ps      = PAGE_CANVAS_SIZES[template.pageSize] ?? PAGE_CANVAS_SIZES.A4;
  const canvasH = template.orientation === 'landscape' ? ps.w : ps.h;

  const originalPages    = (template.pages?.length ? template.pages : [{ id: 'page-0' }]) as ReportPage[];
  const originalElements = template.elements ?? [];

  const overflowing = originalElements.filter((el) => {
    const p = (el.props ?? {}) as Record<string, unknown>;
    if (p.autoGenerated)        return false;
    if (p.autoMovedFromTableId) return false; // auto-layout owns placement of these
    if (el.type === 'table' && p.autoPageBreak) return false;
    if (el.y + el.h <= canvasH + 5) return false;
    // Skip elements taller than one page — they can never fit, moving them would loop.
    const pagesForward = Math.ceil((el.y + el.h - canvasH) / canvasH);
    const maxForward   = Math.floor(el.y / canvasH);
    return pagesForward <= maxForward;
  });

  if (overflowing.length === 0) return null;

  let workPages    = [...originalPages];
  let workElements = [...originalElements];

  for (const el of overflowing) {
    const sourcePage = el.page ?? 0;

    // How many pages forward does this element need to move so it fits?
    // pagesForward = ceil((y + h - canvasH) / canvasH).
    // If h > canvasH the element can never fit on any single page — skip it
    // so we don't create an infinite series of of-pg-N pages on every mount.
    const pagesForward = Math.ceil((el.y + el.h - canvasH) / canvasH);
    const maxForward   = Math.floor(el.y / canvasH); // must stay non-negative y
    if (pagesForward > maxForward) continue;          // element is taller than one page

    const targetPageIdx = sourcePage + pagesForward;
    const newY          = el.y - pagesForward * canvasH;

    while (workPages.length <= targetPageIdx) {
      workPages = [
        ...workPages,
        {
          id:         `of-pg-${workPages.length}`,
          background: workPages[sourcePage]?.background,
        } as ReportPage,
      ];
    }

    workElements = workElements.map((e) =>
      e.id === el.id ? { ...e, page: targetPageIdx, y: newY } : e,
    );
  }

  const pagesEq =
    workPages.length === originalPages.length &&
    workPages.every((pg, i) => JSON.stringify(pg) === JSON.stringify(originalPages[i]));
  const elsEq   =
    workElements.length === originalElements.length &&
    workElements.every((e, i) => JSON.stringify(e) === JSON.stringify(originalElements[i]));

  if (pagesEq && elsEq) return null;
  return { pages: workPages as ReportPage[], elements: workElements };
}
