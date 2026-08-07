'use client';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CellStyle, NamedRange, Sheet, SheetRange } from '@/schemas/workbook';
import { useFormat } from '@prism/i18n';
import { colA1, a1Col } from '@/lib/sheets/a1';
import { computeSheet } from '@/lib/sheets/formula';
import { evaluateCondFmt } from '@/lib/sheets/cond-fmt';
import {
  PAPER_SIZES,
  MARGIN_PRESETS,
  paperPx,
  withPrintDefaults,
  type PrintSetup,
} from '@/lib/sheets/print/print-types';
import { paginate, usedRange, type Pagination } from '@/lib/sheets/print/paginate';
import { printPagesHtml } from '@/lib/sheets/print/print-to-iframe';
import { HEADER_FOOTER_TOKENS } from '@/lib/sheets/print/header-footer';
import { PrintDocument } from './print-document';

type Scope = 'sheet' | 'selection' | 'workbook';

interface Props {
  open: boolean;
  onClose: () => void;
  activeSheet: Sheet;
  allSheets: Sheet[];
  namedRanges: NamedRange[];
  fileName: string;
  selection: SheetRange | null;
  readOnly?: boolean;
  /** Persist the edited setup onto the active sheet. */
  onSaveSetup: (setup: PrintSetup) => void;
}

interface Section {
  sheet: Sheet;
  computed: Record<string, unknown>;
  condFmt: Record<string, CellStyle>;
  pagination: Pagination;
}

// ---------- repeat row/col parsing ("1:2", "A:B") ----------
function parseRows(str: string): { from: number; to: number } | null {
  const s = str.trim();
  if (!s) return null;
  const m = /^(\d+)(?::(\d+))?$/.exec(s);
  if (!m) return null;
  const from = parseInt(m[1], 10) - 1;
  const to = (m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10)) - 1;
  if (from < 0 || to < 0) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}
function fmtRows(r: { from: number; to: number } | null): string {
  if (!r) return '';
  return r.from === r.to ? `${r.from + 1}` : `${r.from + 1}:${r.to + 1}`;
}
function parseCols(str: string): { from: number; to: number } | null {
  const s = str.trim().toUpperCase();
  if (!s) return null;
  const m = /^([A-Z]+)(?::([A-Z]+))?$/.exec(s);
  if (!m) return null;
  const from = a1Col(m[1]);
  const to = m[2] ? a1Col(m[2]) : a1Col(m[1]);
  if (from < 0 || to < 0) return null;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}
function fmtCols(r: { from: number; to: number } | null): string {
  if (!r) return '';
  return r.from === r.to ? colA1(r.from) : `${colA1(r.from)}:${colA1(r.to)}`;
}

// ---------- small UI helpers ----------
function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">
      {children}
    </p>
  );
}
const fieldCls =
  'w-full border border-border rounded-sm px-2.5 py-[7px] text-[13px] bg-bg-input outline-none focus:border-accent';

function Sel({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={fieldCls}
      data-no-csel
    >
      {children}
    </select>
  );
}
function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent w-3.5 h-3.5"
      />
      {label}
    </label>
  );
}

export function PrintPreviewModal({
  open,
  onClose,
  activeSheet,
  allSheets,
  namedRanges,
  fileName,
  selection,
  readOnly,
  onSaveSetup,
}: Props) {
  const [setup, setSetup] = useState<PrintSetup>(() =>
    withPrintDefaults(activeSheet.printSetup),
  );
  const [scope, setScope] = useState<Scope>('sheet');
  const [zoomMode, setZoomMode] = useState<'fit' | number>('fit');
  const [marginPreset, setMarginPreset] = useState<string>('Normal');

  // Re-seed from the sheet whenever the modal (re)opens.
  useEffect(() => {
    if (open) {
      setSetup(withPrintDefaults(activeSheet.printSetup));
      setScope('sheet');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSheet.id]);

  const printRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(0.6);

  const upd = useCallback((patch: Partial<PrintSetup>) => {
    setSetup((s) => ({ ...s, ...patch }));
  }, []);

  // ---- Build the sections (one per printed sheet) ----
  const sections = useMemo<Section[]>(() => {
    const sheets =
      scope === 'workbook' ? allSheets.filter((s) => !s.hidden) : [activeSheet];
    return sheets.map((sheet) => {
      const computed = computeSheet(sheet, namedRanges) as Record<
        string,
        unknown
      >;
      const condFmt = evaluateCondFmt(sheet, computed);
      let range: SheetRange;
      if (scope === 'selection' && selection) range = selection;
      else if (scope === 'sheet' && setup.printArea) range = setup.printArea;
      else range = usedRange(sheet);
      const pagination = paginate(sheet, setup, range);
      return { sheet, computed, condFmt, pagination };
    });
  }, [scope, activeSheet, allSheets, namedRanges, selection, setup]);

  const totalPages = sections.reduce((n, s) => n + s.pagination.totalPages, 0);
  const paper = paperPx(setup);

  // ---- Fit-to-width zoom ----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const compute = () => {
      const avail = el.clientWidth - 48;
      setFitScale(Math.max(0.15, Math.min(1, avail / paper.w)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paper.w, open]);

  const zoom = zoomMode === 'fit' ? fitScale : zoomMode;

  // ---- header/footer token insertion (into last-focused field) ----
  const lastFieldRef = useRef<{
    band: 'header' | 'footer';
    pos: 'left' | 'center' | 'right';
  } | null>(null);
  const insertToken = (token: string) => {
    const f = lastFieldRef.current;
    if (!f) return;
    setSetup((s) => {
      const band = { ...s[f.band] };
      band[f.pos] = (band[f.pos] ?? '') + token;
      return { ...s, [f.band]: band };
    });
  };

  const f = useFormat();
  const dateStr = useMemo(() => f.date(Date.now()), [f]);
  const timeStr = useMemo(() => f.time(Date.now()), [f]);

  const collectPagesHtml = (): string => {
    const node = printRef.current;
    if (!node) return '';
    return Array.from(node.querySelectorAll('.sh-print-page'))
      .map((p) => (p as HTMLElement).outerHTML)
      .join('');
  };

  const doPrint = () => {
    const pages = collectPagesHtml();
    if (pages) printPagesHtml(pages, setup);
  };

  const save = () => {
    onSaveSetup(setup);
    onClose();
  };

  if (!open || typeof document === 'undefined') return null;

  const hfField = (band: 'header' | 'footer', pos: 'left' | 'center' | 'right') => (
    <input
      value={setup[band][pos]}
      onFocus={() => (lastFieldRef.current = { band, pos })}
      onChange={(e) =>
        setSetup((s) => ({ ...s, [band]: { ...s[band], [pos]: e.target.value } }))
      }
      placeholder={pos}
      className="w-full border border-border rounded-sm px-2 py-1 text-[12px] bg-bg-input outline-none focus:border-accent"
    />
  );

  return createPortal(
    <div className="fixed inset-0 z-[600] flex flex-col bg-[var(--overlay)] backdrop-blur-[6px] animate-fade-in">
      {/* preview-only page chrome */}
      <style>{`
        [data-print-preview] .sh-print-page {
          box-shadow: 0 1px 6px rgba(0,0,0,.28);
          margin: 0 auto;
        }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 h-[52px] bg-bg-card border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Printer className="w-[18px] h-[18px] text-accent" />
          <h2 className="text-[15px] font-bold tracking-tight">Print preview</h2>
          <span className="text-[12px] text-text-muted ml-2">
            {totalPages} page{totalPages === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button variant="outline" onClick={save}>
              Save settings
            </Button>
          )}
          <Button variant="primary" onClick={doPrint}>
            <Printer className="w-4 h-4 mr-1.5" />
            Print
          </Button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Settings panel */}
        <div className="w-[300px] flex-shrink-0 bg-bg-card border-r border-border overflow-y-auto p-4 space-y-4">
          <div>
            <PanelLabel>What to print</PanelLabel>
            <Sel value={scope} onChange={(v) => setScope(v as Scope)}>
              <option value="sheet">Active sheet</option>
              <option value="selection" disabled={!selection}>
                Current selection
              </option>
              <option value="workbook">Entire workbook</option>
            </Sel>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <PanelLabel>Paper size</PanelLabel>
              <Sel
                value={setup.paper}
                onChange={(v) => upd({ paper: v as PrintSetup['paper'] })}
              >
                {Object.entries(PAPER_SIZES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Sel>
            </div>
            <div>
              <PanelLabel>Orientation</PanelLabel>
              <Sel
                value={setup.orientation}
                onChange={(v) =>
                  upd({ orientation: v as PrintSetup['orientation'] })
                }
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </Sel>
            </div>
          </div>

          <div>
            <PanelLabel>Scaling</PanelLabel>
            <Sel
              value={setup.scaling.mode}
              onChange={(v) =>
                upd({
                  scaling: {
                    ...setup.scaling,
                    mode: v as PrintSetup['scaling']['mode'],
                  },
                })
              }
            >
              <option value="percent">Custom (%)</option>
              <option value="fitWidth">Fit all columns to width</option>
              <option value="fitPage">Fit sheet to one page</option>
            </Sel>
            {setup.scaling.mode === 'percent' && (
              <input
                type="number"
                min={10}
                max={400}
                value={setup.scaling.percent}
                onChange={(e) =>
                  upd({
                    scaling: {
                      ...setup.scaling,
                      percent: Math.max(10, Math.min(400, +e.target.value || 100)),
                    },
                  })
                }
                className={`${fieldCls} mt-2`}
              />
            )}
            {setup.scaling.mode === 'fitWidth' && (
              <label className="flex items-center gap-2 text-[12px] text-text-sub mt-2">
                Pages wide:
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={setup.scaling.fitWide}
                  onChange={(e) =>
                    upd({
                      scaling: {
                        ...setup.scaling,
                        fitWide: Math.max(1, +e.target.value || 1),
                      },
                    })
                  }
                  className="w-16 border border-border rounded-sm px-2 py-1 bg-bg-input"
                />
              </label>
            )}
          </div>

          <div>
            <PanelLabel>Margins</PanelLabel>
            <Sel
              value={marginPreset}
              onChange={(v) => {
                setMarginPreset(v);
                if (v !== 'Custom')
                  upd({ margins: { ...MARGIN_PRESETS[v] } });
              }}
            >
              {Object.keys(MARGIN_PRESETS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
              <option value="Custom">Custom…</option>
            </Sel>
            {marginPreset === 'Custom' && (
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                  <label
                    key={side}
                    className="flex items-center gap-1 text-[11px] text-text-sub capitalize"
                  >
                    {side}
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={5}
                      value={setup.margins[side]}
                      onChange={(e) =>
                        upd({
                          margins: {
                            ...setup.margins,
                            [side]: Math.max(0, +e.target.value || 0),
                          },
                        })
                      }
                      className="w-full border border-border rounded-sm px-1.5 py-1 bg-bg-input"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <PanelLabel>Options</PanelLabel>
            <Check
              checked={setup.gridlines}
              onChange={(v) => upd({ gridlines: v })}
              label="Show gridlines"
            />
            <Check
              checked={setup.headings}
              onChange={(v) => upd({ headings: v })}
              label="Show row & column headings"
            />
            <Check
              checked={setup.centerH}
              onChange={(v) => upd({ centerH: v })}
              label="Center horizontally"
            />
            <Check
              checked={setup.centerV}
              onChange={(v) => upd({ centerV: v })}
              label="Center vertically"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <PanelLabel>Repeat rows</PanelLabel>
              <input
                defaultValue={fmtRows(setup.repeatRows)}
                key={`rr-${activeSheet.id}-${open}`}
                onBlur={(e) => upd({ repeatRows: parseRows(e.target.value) })}
                placeholder="e.g. 1:2"
                className={fieldCls}
              />
            </div>
            <div>
              <PanelLabel>Repeat cols</PanelLabel>
              <input
                defaultValue={fmtCols(setup.repeatCols)}
                key={`rc-${activeSheet.id}-${open}`}
                onBlur={(e) => upd({ repeatCols: parseCols(e.target.value) })}
                placeholder="e.g. A:A"
                className={fieldCls}
              />
            </div>
          </div>

          <div>
            <PanelLabel>Header</PanelLabel>
            <div className="grid grid-cols-3 gap-1">
              {hfField('header', 'left')}
              {hfField('header', 'center')}
              {hfField('header', 'right')}
            </div>
            <PanelLabel>
              <span className="block mt-3">Footer</span>
            </PanelLabel>
            <div className="grid grid-cols-3 gap-1">
              {hfField('footer', 'left')}
              {hfField('footer', 'center')}
              {hfField('footer', 'right')}
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {HEADER_FOOTER_TOKENS.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertToken(t.token)}
                  className="text-[11px] px-2 py-0.5 rounded-sm border border-border bg-bg-subtle hover:bg-bg-hover"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-muted mt-1.5">
              Click a field, then a token to insert it.
            </p>
          </div>

          {setup.printArea && (
            <button
              onClick={() => upd({ printArea: null })}
              className="text-[12px] text-accent hover:underline"
            >
              Clear print area
            </button>
          )}
        </div>

        {/* Preview pane */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#525659]">
          <div className="flex items-center justify-end gap-2 px-4 h-9 flex-shrink-0 text-white/80">
            <button
              onClick={() =>
                setZoomMode((z) =>
                  z === 'fit' ? 0.5 : Math.max(0.25, (z as number) - 0.25),
                )
              }
              className="p-1 hover:text-white"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[12px] w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() =>
                setZoomMode((z) =>
                  z === 'fit' ? 0.75 : Math.min(2, (z as number) + 0.25),
                )
              }
              className="p-1 hover:text-white"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoomMode('fit')}
              className="text-[12px] px-2 py-0.5 rounded hover:bg-white/10"
            >
              Fit
            </button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-auto p-6">
            <div
              data-print-preview
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
                width: paper.w,
                margin: '0 auto',
              }}
            >
              <div ref={printRef} className="flex flex-col items-center gap-5">
                {sections.map((sec) => (
                  <PrintDocument
                    key={sec.sheet.id}
                    sheet={sec.sheet}
                    computed={sec.computed}
                    condFmt={sec.condFmt}
                    setup={setup}
                    pagination={sec.pagination}
                    fileName={fileName}
                    dateStr={dateStr}
                    timeStr={timeStr}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
