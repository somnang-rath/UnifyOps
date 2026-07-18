'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useWorkbook,
  useWorkbookMutations,
} from '@/hooks/use-workbooks';
import { useDebounce } from '@/hooks/use-debounce';
import { a1ToRC, colA1, normalizeRange, rcToA1 } from '@/lib/sheets/a1';
import { computeSheet, formatComputed } from '@/lib/sheets/formula';
import { applyFill } from '@/lib/sheets/fill';
import {
  deleteCol,
  deleteRow,
  insertCol,
  insertRow,
} from '@/lib/sheets/row-col';
import { sortSheet, computeUsedRange, type SortDir } from '@/lib/sheets/sort';
import { api } from '@/lib/api';
import { computeFilteredOutRows } from '@/lib/sheets/filter';
import { evaluateCondFmt } from '@/lib/sheets/cond-fmt';
import { ruleForCell, validateInput } from '@/lib/sheets/validation';
import { toast } from '@/stores/toast-store';
import { FilterPopover } from './filter-popover';
import { ConditionalFormatPanel } from './conditional-format-panel';
import { DataValidationPanel } from './data-validation-panel';
import { ValidationListPopover } from './validation-list-popover';
import {
  applyPaste,
  buildClipboard,
  clipboardToTSV,
  parseTSV,
  type ClipboardData,
} from '@/lib/sheets/clipboard';
import type {
  Cell,
  CellBorder,
  CellLink,
  CellStyle,
  PrintSetup,
  Sheet,
  SheetChart,
  SheetCondFmtRule,
  SheetFilterCriterion,
  SheetValidationRule,
  Workbook,
} from '@/schemas/workbook';
import type { MenuDef } from './menu-bar';
import { TitleBar } from './title-bar';
import { ShareWorkbookModal } from './share-workbook-modal';
import { Confirm } from '@/components/ui/confirm';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Toolbar, type BorderApply } from './toolbar';
import { FormulaBar, type FormulaBarHandle } from './formula-bar';
import { FunctionWizard, type FunctionWizardProps } from './function-wizard';
import { Grid } from './grid';
import { SheetTabs } from './sheet-tabs';
import {
  ContextMenu,
  type CtxMenuSection,
} from './context-menu';
import { ImageCropModal } from './image-crop-modal';
import { CellNoteModal } from './cell-note-modal';
import { NamedRangesModal } from './named-ranges-modal';
import { FindReplaceModal } from './find-replace-modal';
import { InsertLinkModal } from './insert-link-modal';
import { CommentsPopover } from './comments-popover';
import { useWorkbookComments } from '@/hooks/use-workbook-comments';
import { ImportModal, type ImportResult } from './import-modal';
import { KeyboardShortcutsModal } from './keyboard-shortcuts-modal';
import { ChartConfigModal } from './chart-config-modal';
import { ChartOverlay } from './chart-overlay';
import { PrintPreviewModal } from './print/print-preview-modal';
import { withPrintDefaults } from '@/lib/sheets/print/print-types';
import { pageBreakIndices, usedRange } from '@/lib/sheets/print/paginate';

type Dir = 'up' | 'down' | 'left' | 'right' | null;

function formatStat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Use compact notation for large numbers, fixed decimals for small ones.
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Round to at most 6 significant digits to avoid floating-point noise.
  const rounded = parseFloat(n.toPrecision(6));
  return rounded % 1 === 0 ? String(rounded) : rounded.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

interface SelRange {
  sr: number;
  sc: number;
  er: number;
  ec: number;
}

interface EditingState {
  r: number;
  c: number;
  value: string;
  source: 'cell' | 'formula-bar';
}

interface Props {
  workbookId: string;
  onBack?: () => void;
}

export function SheetsShell({ workbookId, onBack }: Props) {
  const router = useRouter();
  const { data: serverWb, isLoading } = useWorkbook(workbookId);
  const { update, copy } = useWorkbookMutations();

  // Local workbook state — single source of truth for the UI.
  const [wb, setWb] = useState<Workbook | null>(null);
  const wbDirtyRef = useRef(false);

  useEffect(() => {
    if (!serverWb) return;
    // Only adopt server state when not dirty (no in-flight edits).
    if (!wbDirtyRef.current) setWb(normalizeWorkbook(serverWb));
  }, [serverWb]);

  // Selection state
  const [sel, setSel] = useState<SelRange>({ sr: 0, sc: 0, er: 0, ec: 0 });
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [draggingSel, setDraggingSel] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  // Fill drag state
  const [fillSource, setFillSource] = useState<SelRange | null>(null);
  const [fillTarget, setFillTarget] = useState<{
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  } | null>(null);

  // Clipboard state
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);

  // Formula point mode — tracks where in the formula a range ref was injected
  // so drag-extends can replace it in place, and the orange marquee can be shown.
  // Ref (not state) so onMouseOverCell always reads the up-to-date insertLen
  // even when multiple mouseover events fire before a React re-render.
  const formulaPointRef = useRef<{
    anchor: { r: number; c: number };
    insertStart: number;
    insertLen: number;
  } | null>(null);
  // True only during the synchronous window between setting formulaPointRef and
  // injectAtCursor's el.focus() call. el.focus() synchronously fires blur on the
  // inline editor, which would otherwise call commitEdit and corrupt the formula.
  const formulaPointingRef = useRef(false);
  const [formulaPointRange, setFormulaPointRange] = useState<{
    r1: number; c1: number; r2: number; c2: number;
  } | null>(null);

  // Autosave status indicator
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markSaved = useCallback(() => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setSaveStatus('saved');
    savedTimerRef.current = setTimeout(() => setSaveStatus(null), 2500);
  }, []);

  // Share modal
  const [sharing, setSharing] = useState(false);

  // Function Wizard
  const [wizardProps, setWizardProps] = useState<FunctionWizardProps | null>(null);

  // Operators & Symbols reference panel
  const [symbolsOpen, setSymbolsOpen] = useState(false);

  // Import modal
  const [importing, setImporting] = useState(false);

  // Print preview modal
  const [printOpen, setPrintOpen] = useState(false);

  // Page-break preview overlay (View menu toggle)
  const [pageBreakView, setPageBreakView] = useState(false);

  // Keyboard shortcuts modal
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Pending sheet-deletion confirmation
  const [deletingSheetId, setDeletingSheetId] = useState<string | null>(null);

  // Auto-save preference, persisted across reloads.
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('unifyops.sheets.autoSave') !== 'false';
  });
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  const toggleAutoSave = useCallback(() => {
    setAutoSave((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(
          'unifyops.sheets.autoSave',
          next ? 'true' : 'false',
        );
      } catch {
        /* storage may be unavailable; preference is best-effort */
      }
      return next;
    });
  }, []);

  // Leave-page guard — fires when auto-save is off and there are unsaved edits.
  const [leaveDialog, setLeaveDialog] = useState<{ href: string } | null>(null);

  // Browser close / tab refresh guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (wbDirtyRef.current && !autoSaveRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // In-app navigation guard: intercept <a> clicks while dirty + auto-save off
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wbDirtyRef.current || autoSaveRef.current) return;
      const anchor = (e.target as Element).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      try {
        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname) return;
        e.preventDefault();
        e.stopPropagation();
        setLeaveDialog({ href: url.pathname + url.search });
      } catch {
        // invalid href, ignore
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);

  const saveAndNavigate = useCallback(
    (href: string) => {
      if (!wb || readOnlyRef.current) { router.push(href); return; }
      const isOwner = wb._access === 'owner';
      update.mutate(
        {
          id: wb._id,
          body: {
            ...(isOwner ? { name: wb.name } : {}),
            sheets: wb.sheets,
            activeSheetId: wb.activeSheetId,
          },
        },
        {
          onSuccess: () => {
            wbDirtyRef.current = false;
            router.push(href);
          },
          onError: () => {
            toast('Failed to save', 'error');
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wb, router],
  );

  // Context-menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    kind: 'cell' | 'col' | 'row';
    r?: number;
    c?: number;
  } | null>(null);

  // History state. Stacks live in a ref; a version counter triggers re-renders
  // so toolbar/menu items can reflect can-undo/can-redo.
  const historyRef = useRef<{
    undo: Array<{ label: string; before: Workbook; after: Workbook }>;
    redo: Array<{ label: string; before: Workbook; after: Workbook }>;
  }>({ undo: [], redo: [] });
  const [historyVer, setHistoryVer] = useState(0);
  const HISTORY_CAP = 50;

  const activeSheet = useMemo<Sheet | null>(() => {
    if (!wb) return null;
    return (
      wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0] ?? null
    );
  }, [wb]);

  const computed = useMemo<Record<string, unknown>>(
    () => (activeSheet ? computeSheet(activeSheet, wb?.namedRanges ?? []) : {}),
    [activeSheet, wb?.namedRanges],
  );

  const pageBreaks = useMemo(() => {
    if (!pageBreakView || !activeSheet) return null;
    const range = activeSheet.printSetup?.printArea ?? usedRange(activeSheet);
    return pageBreakIndices(activeSheet, activeSheet.printSetup, range);
  }, [pageBreakView, activeSheet]);

  // Reset selection when sheet changes
  useEffect(() => {
    setSel({ sr: 0, sc: 0, er: 0, ec: 0 });
    setActive({ r: 0, c: 0 });
    setEditing(null);
  }, [activeSheet?.id]);

  // Debounced save (gated by readOnly so collaborators with 'read' don't even attempt)
  const debouncedWb = useDebounce(wb, 500);
  const readOnlyRef = useRef(false);
  readOnlyRef.current =
    !!(wb?._access && wb._access !== 'owner' && wb._access !== 'edit');
  useEffect(() => {
    if (readOnlyRef.current) return;
    if (!autoSaveRef.current) return; // manual mode: skip background save
    if (!debouncedWb || !wbDirtyRef.current) return;
    const isOwner = debouncedWb._access === 'owner';
    setSaveStatus('saving');
    update.mutate(
      {
        id: debouncedWb._id,
        body: {
          ...(isOwner ? { name: debouncedWb.name } : {}),
          sheets: debouncedWb.sheets,
          activeSheetId: debouncedWb.activeSheetId,
        },
      },
      {
        onSuccess: () => {
          wbDirtyRef.current = false;
          markSaved();
        },
        onError: () => {
          setSaveStatus(null);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedWb, autoSave]);

  // Manual save — flushes the current workbook to the server immediately,
  // regardless of the auto-save preference. No-op when read-only or clean.
  const saveNow = useCallback(() => {
    if (readOnlyRef.current) return;
    if (!wb || !wbDirtyRef.current) {
      toast('Already up to date', 'info');
      return;
    }
    const isOwner = wb._access === 'owner';
    setSaveStatus('saving');
    update.mutate(
      {
        id: wb._id,
        body: {
          ...(isOwner ? { name: wb.name } : {}),
          sheets: wb.sheets,
          activeSheetId: wb.activeSheetId,
        },
      },
      {
        onSuccess: () => {
          wbDirtyRef.current = false;
          markSaved();
          toast('Saved', 'success');
        },
        onError: () => {
          setSaveStatus(null);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb]);

  // ---- Mutators ----

  const access = wb?._access ?? 'owner';
  const readOnly = access !== 'owner' && access !== 'edit';
  const canShare = access === 'owner';

  const mutateWb = useCallback(
    (fn: (wb: Workbook) => Workbook, historyLabel?: string) => {
      if (readOnly) return;
      let pushed = false;
      setWb((cur) => {
        if (!cur) return cur;
        const next = fn(cur);
        if (next === cur) return cur;
        if (historyLabel) {
          historyRef.current.undo.push({
            label: historyLabel,
            before: cur,
            after: next,
          });
          if (historyRef.current.undo.length > HISTORY_CAP) {
            historyRef.current.undo.shift();
          }
          historyRef.current.redo = [];
          pushed = true;
        }
        wbDirtyRef.current = true;
        return next;
      });
      if (pushed) setHistoryVer((v) => v + 1);
    },
    [readOnly],
  );

  const mutateSheet = useCallback(
    (fn: (s: Sheet) => Sheet, historyLabel?: string) => {
      mutateWb(
        (cur) => ({
          ...cur,
          sheets: cur.sheets.map((s) =>
            s.id === cur.activeSheetId ? fn(s) : s,
          ),
        }),
        historyLabel,
      );
    },
    [mutateWb],
  );

  const setPrintArea = useCallback(() => {
    const range = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet(
      (s) => ({
        ...s,
        printSetup: { ...withPrintDefaults(s.printSetup), printArea: range },
      }),
      'set print area',
    );
    toast('Print area set', 'success');
  }, [sel, mutateSheet]);

  const clearPrintArea = useCallback(() => {
    mutateSheet(
      (s) => ({
        ...s,
        printSetup: { ...withPrintDefaults(s.printSetup), printArea: null },
      }),
      'clear print area',
    );
  }, [mutateSheet]);

  const savePrintSetup = useCallback(
    (printSetup: PrintSetup) => {
      mutateSheet((s) => ({ ...s, printSetup }), 'page setup');
    },
    [mutateSheet],
  );

  const undo = useCallback(() => {
    if (readOnly) return;
    const cmd = historyRef.current.undo.pop();
    if (!cmd) return;
    historyRef.current.redo.push(cmd);
    setWb(cmd.before);
    wbDirtyRef.current = true;
    setHistoryVer((v) => v + 1);
  }, [readOnly]);

  const redo = useCallback(() => {
    if (readOnly) return;
    const cmd = historyRef.current.redo.pop();
    if (!cmd) return;
    historyRef.current.undo.push(cmd);
    setWb(cmd.after);
    wbDirtyRef.current = true;
    setHistoryVer((v) => v + 1);
  }, [readOnly]);

  const canUndo =
    !readOnly && historyVer >= 0 && historyRef.current.undo.length > 0;
  const canRedo =
    !readOnly && historyVer >= 0 && historyRef.current.redo.length > 0;

  const writeCellFromString = useCallback(
    (r: number, c: number, raw: string) => {
      const key = rcToA1(r, c);
      // Read-then-merge so style/borders/link/note survive a value change.
      // Without this carry-over, retyping a cell's text would wipe its
      // background and text colors.
      mutateSheet((s) => {
        const cells = { ...s.cells };
        const cur = cells[key] ?? {};
        // Strip the previous value/formula; anything else is preserved.
        const { v: _v, f: _f, ...rest } = cur;
        let next: Cell = { ...rest };
        if (raw === '') {
          // value cleared — keep style/borders so colors stick around
        } else if (raw.startsWith('=')) {
          next = { ...next, f: raw, v: raw };
        } else {
          const asNum = Number(raw);
          if (
            raw.trim() !== '' &&
            !Number.isNaN(asNum) &&
            Number.isFinite(asNum)
          ) {
            next = { ...next, v: asNum };
          } else if (raw.toUpperCase() === 'TRUE') {
            next = { ...next, v: true };
          } else if (raw.toUpperCase() === 'FALSE') {
            next = { ...next, v: false };
          } else {
            next = { ...next, v: raw };
          }
        }
        if (isCellEmpty(next)) delete cells[key];
        else cells[key] = next;
        return { ...s, cells };
      }, 'edit');
    },
    [mutateSheet],
  );

  // ---- Selection / nav ----

  // If a click lands inside a merged range, snap the selection to the merge
  // anchor and expand the range to cover the whole merge.
  const mergeContaining = useCallback(
    (r: number, c: number) => {
      if (!activeSheet) return null;
      for (const m of activeSheet.merges ?? []) {
        if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
      }
      return null;
    },
    [activeSheet],
  );

  const setSelToCell = useCallback(
    (r: number, c: number) => {
      const m = mergeContaining(r, c);
      if (m) {
        setSel({ sr: m.r1, sc: m.c1, er: m.r2, ec: m.c2 });
        setActive({ r: m.r1, c: m.c1 });
        return;
      }
      setSel({ sr: r, sc: c, er: r, ec: c });
      setActive({ r, c });
    },
    [mergeContaining],
  );

  const extendSelToCell = useCallback(
    (r: number, c: number) => {
      setSel((cur) => ({ sr: cur.sr, sc: cur.sc, er: r, ec: c }));
    },
    [],
  );

  const moveActive = useCallback(
    (dr: number, dc: number, extend = false) => {
      if (!activeSheet) return;
      const r = clamp(active.r + dr, 0, activeSheet.rowCount - 1);
      const c = clamp(active.c + dc, 0, activeSheet.colCount - 1);
      if (extend) {
        setSel((cur) => ({ sr: cur.sr, sc: cur.sc, er: r, ec: c }));
        setActive({ r, c });
      } else {
        setSelToCell(r, c);
      }
    },
    [active, activeSheet, setSelToCell],
  );

  const focusGrid = useCallback(() => {
    setFocusKey((k) => k + 1);
  }, []);

  // ---- Edit ----

  const startEdit = useCallback(
    (r: number, c: number, initial?: string) => {
      const key = rcToA1(r, c);
      const cell = activeSheet?.cells?.[key];
      const start =
        initial !== undefined
          ? initial
          : cell?.f
            ? cell.f
            : cell?.v != null
              ? String(cell.v)
              : '';
      setEditing({ r, c, value: start, source: 'cell' });
      formulaPointRef.current = null;
      setFormulaPointRange(null);
    },
    [activeSheet],
  );

  const startEditFromBar = useCallback(() => {
    if (!activeSheet) return;
    const key = rcToA1(active.r, active.c);
    const cell = activeSheet.cells?.[key];
    const start = cell?.f ? cell.f : cell?.v != null ? String(cell.v) : '';
    setEditing({ r: active.r, c: active.c, value: start, source: 'formula-bar' });
  }, [activeSheet, active]);

  const commitEdit = useCallback(
    (dir: Dir) => {
      if (!editing || !activeSheet) return;
      // Skip if we're mid-injection: injectAtCursor calls el.focus() which fires
      // blur on the inline editor synchronously, before formulaPointRef is set.
      if (formulaPointingRef.current) return;
      formulaPointRef.current = null;
      setFormulaPointRange(null);
      // Strict validation rejects the commit before any state mutates.
      const rule = ruleForCell(activeSheet, editing.r, editing.c);
      if (rule && rule.strict) {
        const outcome = validateInput(rule, editing.value);
        if (!outcome.ok) {
          toast(outcome.reason, 'error');
          return;
        }
      }
      writeCellFromString(editing.r, editing.c, editing.value);
      setEditing(null);
      const dr = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
      const dc = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
      if (dr || dc) {
        const r = clamp(editing.r + dr, 0, activeSheet.rowCount - 1);
        const c = clamp(editing.c + dc, 0, activeSheet.colCount - 1);
        setSelToCell(r, c);
      }
      focusGrid();
    },
    [editing, activeSheet, writeCellFromString, setSelToCell, focusGrid],
  );

  const cancelEdit = useCallback(() => {
    setEditing(null);
    formulaPointRef.current = null;
    setFormulaPointRange(null);
    focusGrid();
  }, [focusGrid]);

  // ---- Fill drag ----

  const onFillStart = useCallback(() => {
    setFillSource({ ...sel });
    setFillTarget(null);
  }, [sel]);

  const computeFillTarget = useCallback(
    (src: SelRange, hoverR: number, hoverC: number) => {
      const r1 = Math.min(src.sr, src.er);
      const c1 = Math.min(src.sc, src.ec);
      const r2 = Math.max(src.sr, src.er);
      const c2 = Math.max(src.sc, src.ec);
      const dDown = Math.max(0, hoverR - r2);
      const dUp = Math.max(0, r1 - hoverR);
      const dRight = Math.max(0, hoverC - c2);
      const dLeft = Math.max(0, c1 - hoverC);
      const vOver = dDown + dUp;
      const hOver = dRight + dLeft;
      if (vOver === 0 && hOver === 0) return { r1, c1, r2, c2 };
      if (vOver >= hOver) {
        return {
          r1: Math.min(r1, hoverR),
          c1,
          r2: Math.max(r2, hoverR),
          c2,
        };
      }
      return {
        r1,
        c1: Math.min(c1, hoverC),
        r2,
        c2: Math.max(c2, hoverC),
      };
    },
    [],
  );

  const onFillEnd = useCallback(() => {
    if (!fillSource || !fillTarget || !activeSheet) {
      setFillSource(null);
      setFillTarget(null);
      return;
    }
    const src = {
      r1: Math.min(fillSource.sr, fillSource.er),
      c1: Math.min(fillSource.sc, fillSource.ec),
      r2: Math.max(fillSource.sr, fillSource.er),
      c2: Math.max(fillSource.sc, fillSource.ec),
    };
    const changes = applyFill(activeSheet, src, fillTarget);
    mutateSheet((s) => {
      const cells = { ...s.cells };
      for (const [key, val] of Object.entries(changes)) {
        if (val == null) continue; // empty source → leave target untouched
        // Carry over the target's own borders / note / link / image so fill
        // only overwrites the source-derived fields (v / f / s).
        const prev = cells[key];
        const merged: Cell = {
          ...(prev?.b1 ? { b1: prev.b1 } : {}),
          ...(prev?.b2 ? { b2: prev.b2 } : {}),
          ...(prev?.b3 ? { b3: prev.b3 } : {}),
          ...(prev?.b4 ? { b4: prev.b4 } : {}),
          ...(prev?.img ? { img: prev.img } : {}),
          ...(prev?.link ? { link: prev.link } : {}),
          ...(prev?.note ? { note: prev.note } : {}),
          ...val,
        };
        if (isCellEmpty(merged)) delete cells[key];
        else cells[key] = merged;
      }
      return { ...s, cells };
    }, 'fill');
    // Promote selection to the new range
    setSel({
      sr: fillTarget.r1,
      sc: fillTarget.c1,
      er: fillTarget.r2,
      ec: fillTarget.c2,
    });
    setFillSource(null);
    setFillTarget(null);
  }, [fillSource, fillTarget, activeSheet, mutateSheet]);

  // ---- Clipboard ----

  const handleCopy = useCallback(
    (kind: 'copy' | 'cut') => {
      if (!activeSheet) return;
      const range = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      const cb = buildClipboard(activeSheet, range, kind);
      setClipboard(cb);
      // Best-effort write to system clipboard so external apps can paste.
      try {
        const tsv = clipboardToTSV(cb);
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(tsv).catch(() => {});
        }
      } catch {
        // ignore
      }
    },
    [activeSheet, sel],
  );

  const handlePaste = useCallback(async () => {
    if (!activeSheet) return;
    let cells: (Cell | undefined)[][] | null = null;
    let sourceForRefShift: { r1: number; c1: number } | null = null;

    // Prefer system clipboard if it matches our internal TSV — caller may
    // have copied from another sheet/app.
    let systemText = '';
    try {
      systemText = (await navigator.clipboard?.readText()) ?? '';
    } catch {
      // permission denied — fall back to internal
    }

    if (clipboard && (!systemText || systemText === clipboardToTSV(clipboard))) {
      cells = clipboard.cells;
      sourceForRefShift = { r1: clipboard.source.r1, c1: clipboard.source.c1 };
    } else if (systemText) {
      cells = parseTSV(systemText);
    } else if (clipboard) {
      cells = clipboard.cells;
      sourceForRefShift = { r1: clipboard.source.r1, c1: clipboard.source.c1 };
    }
    if (!cells || !cells.length) return;

    const destRange = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    const destR = destRange.r1;
    const destC = destRange.c1;

    const pasteCb: ClipboardData = sourceForRefShift
      ? clipboard!
      : {
          kind: 'copy',
          source: { r1: 0, c1: 0, r2: cells.length - 1, c2: (cells[0]?.length ?? 1) - 1 },
          sheetId: activeSheet.id,
          cells,
        };
    const changes = applyPaste(
      pasteCb,
      destR,
      destC,
      destRange,
      !!sourceForRefShift,
    );

    mutateSheet((s) => {
      const cellsMap = { ...s.cells };
      // For cut, also clear the source cells.
      if (clipboard?.kind === 'cut' && clipboard.sheetId === activeSheet.id) {
        for (let r = clipboard.source.r1; r <= clipboard.source.r2; r++) {
          for (let c = clipboard.source.c1; c <= clipboard.source.c2; c++) {
            delete cellsMap[rcToA1(r, c)];
          }
        }
      }
      for (const [key, val] of Object.entries(changes)) {
        if (val == null || isCellEmpty(val)) delete cellsMap[key];
        else cellsMap[key] = val;
      }
      return { ...s, cells: cellsMap };
    }, clipboard?.kind === 'cut' ? 'cut & paste' : 'paste');

    // Cut becomes empty after paste.
    if (clipboard?.kind === 'cut') setClipboard(null);

    // Expand selection to the pasted area.
    const sRows = cells.length;
    const sCols = cells[0]?.length ?? 0;
    setSel({
      sr: destR,
      sc: destC,
      er: destR + sRows - 1,
      ec: destC + sCols - 1,
    });
  }, [activeSheet, clipboard, sel, mutateSheet]);

  const handlePasteValuesOnly = useCallback(async () => {
    if (!activeSheet) return;
    let cells: (Cell | undefined)[][] | null = null;
    try {
      const text = (await navigator.clipboard?.readText()) ?? '';
      if (text) cells = parseTSV(text);
    } catch { /* permission denied */ }
    if (!cells && clipboard) cells = clipboard.cells;
    if (!cells?.length) return;
    const destRange = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    const pasteCb: ClipboardData = clipboard ?? {
      kind: 'copy',
      source: { r1: 0, c1: 0, r2: cells.length - 1, c2: (cells[0]?.length ?? 1) - 1 },
      sheetId: activeSheet.id,
      cells,
    };
    const changes = applyPaste(pasteCb, destRange.r1, destRange.c1, destRange, false);
    mutateSheet((s) => {
      const cellsMap = { ...s.cells };
      for (const [key, val] of Object.entries(changes)) {
        if (val == null || isCellEmpty(val)) delete cellsMap[key];
        else {
          // Values only: strip formula, keep existing style
          const existing = cellsMap[key] ?? {};
          cellsMap[key] = { ...existing, v: val.v, f: undefined };
        }
      }
      return { ...s, cells: cellsMap };
    }, 'paste values');
  }, [activeSheet, clipboard, sel, mutateSheet]);

  const clearClipboard = useCallback(() => setClipboard(null), []);

  // ---- ----

  // ---- Style mutators ----

  const applyStyle = useCallback(
    (patch: Partial<CellStyle>) => {
      if (!activeSheet) return;
      const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      mutateSheet((s) => {
        const cells = { ...s.cells };
        for (let rr = r.r1; rr <= r.r2; rr++) {
          for (let cc = r.c1; cc <= r.c2; cc++) {
            const key = rcToA1(rr, cc);
            const cur = cells[key] || {};
            const merged: CellStyle = { ...(cur.s ?? {}), ...patch };
            // Strip undefined/null keys so the style stays compact
            (Object.keys(merged) as (keyof CellStyle)[]).forEach((k) => {
              const v = merged[k];
              if (v === undefined || v === null || v === '') delete merged[k];
            });
            const hasStyle = Object.keys(merged).length > 0;
            const next: Cell = {
              ...cur,
              ...(hasStyle ? { s: merged } : { s: undefined }),
            };
            if (!hasStyle) delete (next as Record<string, unknown>).s;
            if (isCellEmpty(next)) delete cells[key];
            else cells[key] = next;
          }
        }
        return { ...s, cells };
      }, 'format');
    },
    [activeSheet, sel, mutateSheet],
  );

  const activeStyle = useMemo<CellStyle | undefined>(() => {
    if (!activeSheet) return undefined;
    return activeSheet.cells?.[rcToA1(active.r, active.c)]?.s;
  }, [activeSheet, active]);

  const toggleStyle = useCallback(
    (key: 'b' | 'i' | 'u' | 's' | 'wrap') => {
      const next = !activeStyle?.[key];
      applyStyle({ [key]: next || undefined });
    },
    [activeStyle, applyStyle],
  );

  const bumpFontSize = useCallback(
    (delta: number) => {
      const cur = activeStyle?.fs ?? 10;
      const next = Math.max(6, Math.min(72, cur + delta));
      applyStyle({ fs: next });
    },
    [activeStyle, applyStyle],
  );

  const setFontSizeExact = useCallback(
    (px: number) => {
      const next = Math.max(6, Math.min(400, Math.round(px)));
      applyStyle({ fs: next });
    },
    [applyStyle],
  );

  const cycleAlignH = useCallback(() => {
    const seq: Array<'left' | 'center' | 'right'> = [
      'left',
      'center',
      'right',
    ];
    const cur = activeStyle?.ha ?? 'left';
    const idx = seq.indexOf(cur);
    applyStyle({ ha: seq[(idx + 1) % seq.length] });
  }, [activeStyle, applyStyle]);

  const cycleAlignV = useCallback(() => {
    const seq: Array<'top' | 'middle' | 'bottom'> = [
      'top',
      'middle',
      'bottom',
    ];
    const cur = activeStyle?.va ?? 'middle';
    const idx = seq.indexOf(cur);
    applyStyle({ va: seq[(idx + 1) % seq.length] });
  }, [activeStyle, applyStyle]);

  const setColor = useCallback(
    (which: 'fg' | 'bg', color: string | null) => {
      applyStyle({ [which]: color ?? undefined });
    },
    [applyStyle],
  );

  const setNumberFormat = useCallback(
    (nf: 'currency' | 'percent' | null) => {
      applyStyle({ nf: nf ?? undefined });
    },
    [applyStyle],
  );

  const bumpDecimalPlaces = useCallback(
    (delta: number) => {
      if (!activeSheet) return;
      const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      mutateSheet((s) => {
        const cells = { ...s.cells };
        for (let rr = r.r1; rr <= r.r2; rr++) {
          for (let cc = r.c1; cc <= r.c2; cc++) {
            const key = rcToA1(rr, cc);
            const cur = cells[key] || {};
            const curStyle: CellStyle = { ...(cur.s ?? {}) };
            const baseDp = curStyle.dp ?? defaultDp(cur, curStyle);
            const nextDp = Math.max(0, Math.min(20, baseDp + delta));
            const next: Cell = {
              ...cur,
              s: { ...curStyle, dp: nextDp },
            };
            cells[key] = next;
          }
        }
        return { ...s, cells };
      }, 'change decimals');
    },
    [activeSheet, sel, mutateSheet],
  );

  // ---- Borders ----

  const applyBorders = useCallback(
    (border: BorderApply) => {
      if (!activeSheet) return;
      const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      const b: CellBorder | null =
        border.side === 'none'
          ? null
          : { style: border.style, color: border.color };
      mutateSheet((s) => {
        const cells = { ...s.cells };
        const setSide = (rr: number, cc: number, side: 1 | 2 | 3 | 4) => {
          const key = rcToA1(rr, cc);
          const cur = cells[key] || {};
          const next: Cell = { ...cur };
          if (b === null) {
            delete (next as Record<string, unknown>)[`b${side}`];
          } else {
            (next as Record<string, CellBorder | undefined>)[`b${side}`] = b;
          }
          if (isCellEmpty(next)) delete cells[key];
          else cells[key] = next;
        };
        const clearAllSides = (rr: number, cc: number) => {
          const key = rcToA1(rr, cc);
          const cur = cells[key];
          if (!cur) return;
          const next: Cell = { ...cur };
          delete next.b1;
          delete next.b2;
          delete next.b3;
          delete next.b4;
          if (isCellEmpty(next)) delete cells[key];
          else cells[key] = next;
        };
        for (let rr = r.r1; rr <= r.r2; rr++) {
          for (let cc = r.c1; cc <= r.c2; cc++) {
            switch (border.side) {
              case 'none':
                clearAllSides(rr, cc);
                break;
              case 'all':
                setSide(rr, cc, 1);
                setSide(rr, cc, 2);
                setSide(rr, cc, 3);
                setSide(rr, cc, 4);
                break;
              case 'outer':
                if (rr === r.r1) setSide(rr, cc, 1);
                if (rr === r.r2) setSide(rr, cc, 3);
                if (cc === r.c1) setSide(rr, cc, 4);
                if (cc === r.c2) setSide(rr, cc, 2);
                break;
              case 'inner':
                // Inner verticals: every column's right edge except the rightmost.
                if (cc < r.c2) setSide(rr, cc, 2);
                // Inner horizontals: every row's bottom edge except the bottom.
                if (rr < r.r2) setSide(rr, cc, 3);
                break;
              case 'top':
                if (rr === r.r1) setSide(rr, cc, 1);
                break;
              case 'right':
                if (cc === r.c2) setSide(rr, cc, 2);
                break;
              case 'bottom':
                if (rr === r.r2) setSide(rr, cc, 3);
                break;
              case 'left':
                if (cc === r.c1) setSide(rr, cc, 4);
                break;
            }
          }
        }
        return { ...s, cells };
      }, border.side === 'none' ? 'clear borders' : 'apply borders');
    },
    [activeSheet, sel, mutateSheet],
  );

  // ---- Paint format ----

  const [paintStyle, setPaintStyle] = useState<{
    style?: CellStyle;
    b1?: CellBorder;
    b2?: CellBorder;
    b3?: CellBorder;
    b4?: CellBorder;
  } | null>(null);

  const togglePaintFormat = useCallback(() => {
    if (paintStyle) {
      setPaintStyle(null);
      return;
    }
    if (!activeSheet) return;
    const cell = activeSheet.cells?.[rcToA1(active.r, active.c)];
    setPaintStyle({
      style: cell?.s,
      b1: cell?.b1,
      b2: cell?.b2,
      b3: cell?.b3,
      b4: cell?.b4,
    });
  }, [activeSheet, active, paintStyle]);

  // After a paint target is captured, the next cell-mousedown applies the
  // captured style to the new selection and clears the paint state.
  const consumePaint = useCallback(
    (r1: number, c1: number, r2: number, c2: number) => {
      if (!paintStyle) return;
      mutateSheet((s) => {
        const cells = { ...s.cells };
        for (let rr = r1; rr <= r2; rr++) {
          for (let cc = c1; cc <= c2; cc++) {
            const key = rcToA1(rr, cc);
            const cur = cells[key] || {};
            const next: Cell = { ...cur };
            if (paintStyle.style) next.s = { ...paintStyle.style };
            else delete next.s;
            for (const k of ['b1', 'b2', 'b3', 'b4'] as const) {
              if (paintStyle[k]) next[k] = paintStyle[k];
              else delete next[k];
            }
            if (isCellEmpty(next)) delete cells[key];
            else cells[key] = next;
          }
        }
        return { ...s, cells };
      }, 'paint format');
      setPaintStyle(null);
    },
    [paintStyle, mutateSheet],
  );

  const clearFormat = useCallback(() => {
    if (!activeSheet) return;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const cells = { ...s.cells };
      for (let rr = r.r1; rr <= r.r2; rr++) {
        for (let cc = r.c1; cc <= r.c2; cc++) {
          const key = rcToA1(rr, cc);
          const cur = cells[key];
          if (!cur) continue;
          const next: Cell = { ...cur };
          delete (next as Record<string, unknown>).s;
          if (isCellEmpty(next)) delete cells[key];
          else cells[key] = next;
        }
      }
      return { ...s, cells };
    }, 'clear formatting');
  }, [activeSheet, sel, mutateSheet]);

  // ---- Font + image ----

  const setFont = useCallback(
    (ff: string | null) => {
      applyStyle({ ff: ff ?? undefined });
    },
    [applyStyle],
  );

  const insertImageRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<FormulaBarHandle>(null);

  const handleInsertImage = useCallback(() => {
    insertImageRef.current?.click();
  }, []);

  const onImageFile = useCallback(
    (file: File) => {
      if (!activeSheet) return;
      if (!/^image\//.test(file.type)) return;
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || '');
        if (!src) return;
        const key = rcToA1(active.r, active.c);
        mutateSheet((s) => {
          const cells = { ...s.cells };
          const cur = cells[key] || {};
          cells[key] = { ...cur, img: { src, alt: file.name } };
          return { ...s, cells };
        }, 'insert image');
      };
      reader.readAsDataURL(file);
    },
    [activeSheet, active, mutateSheet],
  );

  // Image crop state
  const [cropTarget, setCropTarget] = useState<{
    r: number;
    c: number;
    src: string;
  } | null>(null);

  const openCropForActive = useCallback(() => {
    if (!activeSheet) return;
    const cell = activeSheet.cells?.[rcToA1(active.r, active.c)];
    if (!cell?.img) return;
    setCropTarget({ r: active.r, c: active.c, src: cell.img.src });
  }, [activeSheet, active]);

  const applyCrop = useCallback(
    (newSrc: string) => {
      if (!cropTarget) return;
      const key = rcToA1(cropTarget.r, cropTarget.c);
      mutateSheet((s) => {
        const cells = { ...s.cells };
        const cur = cells[key] || {};
        if (!cur.img) return s;
        cells[key] = { ...cur, img: { ...cur.img, src: newSrc } };
        return { ...s, cells };
      }, 'crop image');
      setCropTarget(null);
    },
    [cropTarget, mutateSheet],
  );

  // ---- Comments ----

  const { data: comments = [] } = useWorkbookComments(workbookId);
  const [commentPopover, setCommentPopover] = useState<{
    sheetId: string;
    cellRef: string;
    x: number;
    y: number;
  } | null>(null);

  // Set of "sheetId/cellRef" for any cell that has at least one comment
  // (unresolved or otherwise). Filtered down to the active sheet's cells
  // before passing to Grid so the marker only shows on this sheet.
  const commentedCellsForActive = useMemo(() => {
    if (!activeSheet) return new Set<string>();
    const set = new Set<string>();
    for (const c of comments) {
      if (c.sheetId === activeSheet.id) set.add(c.cellRef);
    }
    return set;
  }, [comments, activeSheet]);

  const openCommentsAtActive = useCallback(() => {
    if (!activeSheet) return;
    const ref = rcToA1(active.r, active.c);
    // Anchor the popover to the cell's bottom-left corner. Fall back to
    // page center when the DOM element isn't mounted yet.
    const el = document.querySelector<HTMLElement>(`[data-cell-a1="${ref}"]`);
    let x: number;
    let y: number;
    if (el) {
      const rect = el.getBoundingClientRect();
      x = rect.left;
      y = rect.bottom + 4;
      // Keep the popover (≈320px wide, ≈400px tall) on screen.
      x = Math.min(x, window.innerWidth - 336);
      y = Math.min(y, window.innerHeight - 416);
    } else {
      x = window.innerWidth / 2 - 160;
      y = window.innerHeight / 2 - 200;
    }
    setCommentPopover({ sheetId: activeSheet.id, cellRef: ref, x, y });
  }, [activeSheet, active]);

  const commentsForPopover = useMemo(() => {
    if (!commentPopover) return [];
    return comments.filter(
      (c) =>
        c.sheetId === commentPopover.sheetId &&
        c.cellRef === commentPopover.cellRef,
    );
  }, [comments, commentPopover]);

  // ---- Hyperlinks ----

  const [linkModalOpen, setLinkModalOpen] = useState(false);

  // ---- Find & Replace ----

  const [findReplaceMode, setFindReplaceMode] = useState<'find' | 'replace' | null>(null);

  const handleReplaceOne = useCallback(
    (r: number, c: number, newValue: string) => {
      writeCellFromString(r, c, newValue);
    },
    [writeCellFromString],
  );

  const handleReplaceAll = useCallback(
    (replacements: Array<{ r: number; c: number; newValue: string }>) => {
      mutateSheet((s) => {
        const cells = { ...s.cells };
        for (const { r, c, newValue } of replacements) {
          const key = rcToA1(r, c);
          const cur = cells[key] ?? {};
          const { v: _v, f: _f, ...rest } = cur;
          let next: Cell = { ...rest };
          if (newValue === '') {
            // intentionally empty
          } else if (newValue.startsWith('=')) {
            next = { ...next, f: newValue, v: newValue };
          } else {
            const asNum = Number(newValue);
            next = {
              ...next,
              v:
                newValue.trim() !== '' && !Number.isNaN(asNum) && Number.isFinite(asNum)
                  ? asNum
                  : newValue,
            };
          }
          if (isCellEmpty(next)) delete cells[key];
          else cells[key] = next;
        }
        return { ...s, cells };
      }, 'replace all');
    },
    [mutateSheet],
  );

  // ---- Cell notes ----

  const [noteTarget, setNoteTarget] = useState<{
    r: number;
    c: number;
    text: string;
  } | null>(null);

  const openNoteEditor = useCallback(() => {
    if (!activeSheet) return;
    const key = rcToA1(active.r, active.c);
    const cell = activeSheet.cells?.[key];
    setNoteTarget({ r: active.r, c: active.c, text: cell?.note ?? '' });
  }, [activeSheet, active]);

  const applyNote = useCallback(
    (text: string) => {
      if (!noteTarget) return;
      const key = rcToA1(noteTarget.r, noteTarget.c);
      mutateSheet((s) => {
        const cells = { ...s.cells };
        const cur = cells[key] ?? {};
        const next: Cell = { ...cur };
        if (text.trim()) next.note = text;
        else delete next.note;
        if (isCellEmpty(next)) delete cells[key];
        else cells[key] = next;
        return { ...s, cells };
      }, text.trim() ? 'insert note' : 'remove note');
      setNoteTarget(null);
    },
    [noteTarget, mutateSheet],
  );

  const removeNote = useCallback(() => {
    if (!activeSheet) return;
    const key = rcToA1(active.r, active.c);
    mutateSheet((s) => {
      const cells = { ...s.cells };
      const cur = cells[key];
      if (!cur?.note) return s;
      const next: Cell = { ...cur };
      delete next.note;
      if (isCellEmpty(next)) delete cells[key];
      else cells[key] = next;
      return { ...s, cells };
    }, 'remove note');
  }, [activeSheet, active, mutateSheet]);

  const setCellLink = useCallback(
    (link: CellLink | null) => {
      if (!activeSheet) return;
      const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      mutateSheet((s) => {
        const cells = { ...s.cells };
        for (let rr = r.r1; rr <= r.r2; rr++) {
          for (let cc = r.c1; cc <= r.c2; cc++) {
            const key = rcToA1(rr, cc);
            const cur = cells[key];
            if (!cur && !link) continue;
            const next: Cell = { ...(cur ?? {}) };
            if (link) next.link = link;
            else delete next.link;
            if (isCellEmpty(next)) delete cells[key];
            else cells[key] = next;
          }
        }
        return { ...s, cells };
      }, link ? 'insert link' : 'remove link');
    },
    [activeSheet, sel, mutateSheet],
  );

  const removeImage = useCallback(() => {
    if (!activeSheet) return;
    const key = rcToA1(active.r, active.c);
    mutateSheet((s) => {
      const cells = { ...s.cells };
      const cur = cells[key];
      if (!cur?.img) return s;
      const next = { ...cur };
      delete next.img;
      if (isCellEmpty(next)) delete cells[key];
      else cells[key] = next;
      return { ...s, cells };
    }, 'remove image');
  }, [activeSheet, active, mutateSheet]);

  // ---- Header click → select whole column / row ----

  const selectColumn = useCallback(
    (c: number, extend: boolean) => {
      if (!activeSheet) return;
      // While editing a formula, inject the whole-column ref instead of changing selection.
      if (editing?.value.startsWith('=')) {
        const col = colA1(c);
        const ref = `${col}:${col}`;
        const fp = formulaPointRef.current;
        if (fp) {
          formulaBarRef.current?.replaceRange(fp.insertStart, fp.insertLen, ref);
          formulaPointRef.current = { ...fp, insertLen: ref.length };
        } else {
          const pos = formulaBarRef.current?.getCursorPos() ?? editing.value.length;
          formulaBarRef.current?.injectAtCursor(ref);
          formulaPointRef.current = { anchor: { r: 0, c }, insertStart: pos, insertLen: ref.length };
        }
        return;
      }
      const rEnd = activeSheet.rowCount - 1;
      if (extend) {
        // Anchor at the active column, extend to c — always spanning full height.
        setSel((cur) => ({
          sr: 0,
          sc: cur.sc,
          er: rEnd,
          ec: c,
        }));
      } else {
        setSel({ sr: 0, sc: c, er: rEnd, ec: c });
        setActive({ r: 0, c });
      }
      focusGrid();
    },
    [activeSheet, editing, focusGrid],
  );

  const selectRow = useCallback(
    (r: number, extend: boolean) => {
      if (!activeSheet) return;
      // While editing a formula, inject the whole-row ref instead of changing selection.
      if (editing?.value.startsWith('=')) {
        const row = r + 1;
        const ref = `${row}:${row}`;
        const fp = formulaPointRef.current;
        if (fp) {
          formulaBarRef.current?.replaceRange(fp.insertStart, fp.insertLen, ref);
          formulaPointRef.current = { ...fp, insertLen: ref.length };
        } else {
          const pos = formulaBarRef.current?.getCursorPos() ?? editing.value.length;
          formulaBarRef.current?.injectAtCursor(ref);
          formulaPointRef.current = { anchor: { r, c: 0 }, insertStart: pos, insertLen: ref.length };
        }
        return;
      }
      const cEnd = activeSheet.colCount - 1;
      if (extend) {
        // Anchor at the active row, extend to r — always spanning full width.
        setSel((cur) => ({
          sr: cur.sr,
          sc: 0,
          er: r,
          ec: cEnd,
        }));
      } else {
        setSel({ sr: r, sc: 0, er: r, ec: cEnd });
        setActive({ r, c: 0 });
      }
      focusGrid();
    },
    [activeSheet, editing, focusGrid],
  );

  // ---- Context-menu openers (also normalize the selection) ----

  const openColCtxMenu = useCallback(
    (c: number, x: number, y: number) => {
      // If the column wasn't already part of the selection, replace it.
      const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      const colInRange = c >= r.c1 && c <= r.c2;
      const isWholeColSel =
        colInRange &&
        r.r1 === 0 &&
        r.r2 === (activeSheet?.rowCount ?? 1) - 1;
      if (!isWholeColSel) selectColumn(c, false);
      setCtxMenu({ x, y, kind: 'col', c });
    },
    [sel, activeSheet, selectColumn],
  );

  const openRowCtxMenu = useCallback(
    (r: number, x: number, y: number) => {
      const range = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      const rowInRange = r >= range.r1 && r <= range.r2;
      const isWholeRowSel =
        rowInRange &&
        range.c1 === 0 &&
        range.c2 === (activeSheet?.colCount ?? 1) - 1;
      if (!isWholeRowSel) selectRow(r, false);
      setCtxMenu({ x, y, kind: 'row', r });
    },
    [sel, activeSheet, selectRow],
  );

  const openCellCtxMenu = useCallback(
    (r: number, c: number, x: number, y: number) => {
      const range = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      const inRange =
        r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
      if (!inRange) {
        setSel({ sr: r, sc: c, er: r, ec: c });
        setActive({ r, c });
      }
      setCtxMenu({ x, y, kind: 'cell', r, c });
    },
    [sel],
  );

  // ---- Column / row resize ----

  const handleColResize = useCallback(
    (cols: number[], width: number) => {
      mutateSheet((s) => {
        const colWidths = { ...(s.colWidths ?? {}) };
        for (const col of cols) {
          const key = colA1(col);
          if (width === 100) delete colWidths[key];
          else colWidths[key] = width;
        }
        return { ...s, colWidths };
      }, cols.length > 1 ? 'resize columns' : 'resize column');
    },
    [mutateSheet],
  );

  const handleRowResize = useCallback(
    (rows: number[], height: number) => {
      mutateSheet((s) => {
        const rowHeights = { ...(s.rowHeights ?? {}) };
        for (const row of rows) {
          if (height === 21) delete rowHeights[String(row)];
          else rowHeights[String(row)] = height;
        }
        return { ...s, rowHeights };
      }, rows.length > 1 ? 'resize rows' : 'resize row');
    },
    [mutateSheet],
  );

  // ---- Row / column structural ops ----

  const handleInsertRowAbove = useCallback(() => {
    mutateSheet((s) => insertRow(s, active.r), 'insert row');
  }, [mutateSheet, active]);

  const handleInsertRowBelow = useCallback(() => {
    mutateSheet((s) => insertRow(s, active.r + 1), 'insert row');
  }, [mutateSheet, active]);

  const handleDeleteRow = useCallback(() => {
    mutateSheet((s) => deleteRow(s, active.r), 'delete row');
    // Clamp active position if we removed the bottom row.
    setActive((cur) => {
      if (!activeSheet) return cur;
      const max = activeSheet.rowCount - 2;
      return cur.r > max ? { ...cur, r: Math.max(0, max) } : cur;
    });
  }, [mutateSheet, active, activeSheet]);

  const handleInsertColLeft = useCallback(() => {
    mutateSheet((s) => insertCol(s, active.c), 'insert column');
  }, [mutateSheet, active]);

  const handleInsertColRight = useCallback(() => {
    mutateSheet((s) => insertCol(s, active.c + 1), 'insert column');
  }, [mutateSheet, active]);

  const handleDeleteCol = useCallback(() => {
    mutateSheet((s) => deleteCol(s, active.c), 'delete column');
    setActive((cur) => {
      if (!activeSheet) return cur;
      const max = activeSheet.colCount - 2;
      return cur.c > max ? { ...cur, c: Math.max(0, max) } : cur;
    });
  }, [mutateSheet, active, activeSheet]);

  // ---- Conditional formatting ----

  const [condFmtOpen, setCondFmtOpen] = useState(false);

  const isSheetEmpty = useMemo(
    () => Object.keys(activeSheet?.cells ?? {}).length === 0,
    [activeSheet],
  );

  const condFmtStyles = useMemo<Record<string, CellStyle>>(
    () => (activeSheet ? evaluateCondFmt(activeSheet, computed) : {}),
    [activeSheet, computed],
  );

  const openCondFmt = useCallback(() => setCondFmtOpen(true), []);
  const closeCondFmt = useCallback(() => setCondFmtOpen(false), []);

  const addCondFmtRule = useCallback(
    (rule: SheetCondFmtRule) => {
      mutateSheet(
        (s) => ({ ...s, condFmt: [...(s.condFmt ?? []), rule] }),
        'add conditional rule',
      );
    },
    [mutateSheet],
  );

  const updateCondFmtRule = useCallback(
    (id: string, patch: Partial<SheetCondFmtRule>) => {
      mutateSheet(
        (s) => ({
          ...s,
          condFmt: (s.condFmt ?? []).map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
        }),
        'update conditional rule',
      );
    },
    [mutateSheet],
  );

  const removeCondFmtRule = useCallback(
    (id: string) => {
      mutateSheet(
        (s) => ({
          ...s,
          condFmt: (s.condFmt ?? []).filter((r) => r.id !== id),
        }),
        'remove conditional rule',
      );
    },
    [mutateSheet],
  );

  // ---- Charts ----

  // The modal carries the in-progress chart plus whether it's a fresh insert
  // (committed on save) or an edit of an existing chart on the sheet.
  const [chartModal, setChartModal] = useState<{
    chart: SheetChart;
    isNew: boolean;
  } | null>(null);

  const openInsertChart = useCallback(() => {
    if (!activeSheet) return;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    // A single cell isn't a meaningful range — default to a small block anchored
    // at the selection so the modal opens with something plottable.
    const range =
      r.r1 === r.r2 && r.c1 === r.c2
        ? {
            r1: r.r1,
            c1: r.c1,
            r2: Math.min(r.r1 + 4, activeSheet.rowCount - 1),
            c2: Math.min(r.c1 + 1, activeSheet.colCount - 1),
          }
        : r;
    setChartModal({
      isNew: true,
      chart: {
        id: `ch_${Math.random().toString(36).slice(2, 9)}`,
        type: 'column',
        title: '',
        range,
        headerRow: true,
        headerCol: true,
        legend: true,
        stacked: false,
        // Float near the top-left of the grid viewport, nudged per existing count
        // so a second chart doesn't land exactly on the first.
        x: 60 + (activeSheet.charts?.length ?? 0) * 24,
        y: 60 + (activeSheet.charts?.length ?? 0) * 24,
        w: 480,
        h: 300,
      },
    });
  }, [activeSheet, sel]);

  const saveChart = useCallback(
    (chart: SheetChart, isNew: boolean) => {
      mutateSheet(
        (s) => {
          const charts = s.charts ?? [];
          return isNew
            ? { ...s, charts: [...charts, chart] }
            : { ...s, charts: charts.map((c) => (c.id === chart.id ? chart : c)) };
        },
        isNew ? 'insert chart' : 'edit chart',
      );
      setChartModal(null);
    },
    [mutateSheet],
  );

  const removeChart = useCallback(
    (id: string) => {
      mutateSheet(
        (s) => ({ ...s, charts: (s.charts ?? []).filter((c) => c.id !== id) }),
        'delete chart',
      );
    },
    [mutateSheet],
  );

  const moveChart = useCallback(
    (id: string, rect: { x: number; y: number; w: number; h: number }) => {
      mutateSheet(
        (s) => ({
          ...s,
          charts: (s.charts ?? []).map((c) =>
            c.id === id ? { ...c, ...rect } : c,
          ),
        }),
        'move chart',
      );
    },
    [mutateSheet],
  );

  // ---- Freeze ----

  const handleFreezeRows = useCallback(
    (rows: number) => {
      mutateSheet(
        (s) => ({
          ...s,
          frozen: { rows, cols: s.frozen?.cols ?? 0 },
        }),
        rows === 0 ? 'unfreeze rows' : 'freeze rows',
      );
    },
    [mutateSheet],
  );

  const handleFreezeCols = useCallback(
    (cols: number) => {
      mutateSheet(
        (s) => ({
          ...s,
          frozen: { rows: s.frozen?.rows ?? 0, cols },
        }),
        cols === 0 ? 'unfreeze columns' : 'freeze columns',
      );
    },
    [mutateSheet],
  );

  // ---- Merge cells ----

  const isRangeSingle = sel.sr === sel.er && sel.sc === sel.ec;
  const hasMergeOverlap = useMemo(() => {
    if (!activeSheet) return false;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    return (activeSheet.merges ?? []).some((m) =>
      rangesOverlap(m, r),
    );
  }, [activeSheet, sel]);

  const handleMergeCells = useCallback(() => {
    if (isRangeSingle) return;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      // Remove any existing merge that overlaps; then add the new one.
      const next = (s.merges ?? []).filter((m) => !rangesOverlap(m, r));
      next.push(r);
      // Clear contents of non-anchor cells so they don't linger.
      const cells = { ...s.cells };
      for (let rr = r.r1; rr <= r.r2; rr++) {
        for (let cc = r.c1; cc <= r.c2; cc++) {
          if (rr === r.r1 && cc === r.c1) continue;
          delete cells[rcToA1(rr, cc)];
        }
      }
      return { ...s, merges: next, cells };
    }, 'merge cells');
  }, [isRangeSingle, sel, mutateSheet]);

  const handleUnmergeCells = useCallback(() => {
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet(
      (s) => ({
        ...s,
        merges: (s.merges ?? []).filter((m) => !rangesOverlap(m, r)),
      }),
      'unmerge cells',
    );
  }, [sel, mutateSheet]);

  const handleMergeAndCenter = useCallback(() => {
    if (isRangeSingle) return;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const next = (s.merges ?? []).filter((m) => !rangesOverlap(m, r));
      next.push(r);
      const cells = { ...s.cells };
      for (let rr = r.r1; rr <= r.r2; rr++) {
        for (let cc = r.c1; cc <= r.c2; cc++) {
          if (rr === r.r1 && cc === r.c1) continue;
          delete cells[rcToA1(rr, cc)];
        }
      }
      const anchorKey = rcToA1(r.r1, r.c1);
      const anchor = cells[anchorKey] ?? {};
      cells[anchorKey] = {
        ...anchor,
        s: { ...(anchor.s ?? {}), ha: 'center', va: 'middle' },
      };
      return { ...s, merges: next, cells };
    }, 'merge & center');
  }, [isRangeSingle, sel, mutateSheet]);

  // ---- Data validation ----

  const [validationOpen, setValidationOpen] = useState(false);
  const [listPopover, setListPopover] = useState<{
    r: number;
    c: number;
    values: string[];
    current: string | null;
    x: number;
    y: number;
  } | null>(null);

  const openValidation = useCallback(() => setValidationOpen(true), []);
  const closeValidation = useCallback(() => setValidationOpen(false), []);

  const addValidationRule = useCallback(
    (rule: SheetValidationRule) => {
      mutateSheet(
        (s) => ({ ...s, validations: [...(s.validations ?? []), rule] }),
        'add validation rule',
      );
    },
    [mutateSheet],
  );

  const updateValidationRule = useCallback(
    (id: string, patch: Partial<SheetValidationRule>) => {
      mutateSheet(
        (s) => ({
          ...s,
          validations: (s.validations ?? []).map((r) =>
            r.id === id ? { ...r, ...patch } : r,
          ),
        }),
        'update validation rule',
      );
    },
    [mutateSheet],
  );

  const removeValidationRule = useCallback(
    (id: string) => {
      mutateSheet(
        (s) => ({
          ...s,
          validations: (s.validations ?? []).filter((r) => r.id !== id),
        }),
        'remove validation rule',
      );
    },
    [mutateSheet],
  );

  // Toggle handler for inline checkbox cells.
  const toggleCheckboxCell = useCallback(
    (r: number, c: number) => {
      if (!activeSheet) return;
      const a1 = rcToA1(r, c);
      const cur = activeSheet.cells?.[a1];
      const next = !(cur?.v === true);
      mutateSheet((s) => {
        const cells = { ...s.cells };
        const prev = cells[a1] ?? {};
        cells[a1] = { ...prev, v: next };
        return { ...s, cells };
      }, 'toggle checkbox');
    },
    [activeSheet, mutateSheet],
  );

  // ---- Named ranges ----

  const [namedRangesOpen, setNamedRangesOpen] = useState(false);

  const addNamedRange = useCallback(
    (nr: import('@/schemas/workbook').NamedRange) => {
      mutateWb((w) => ({ ...w, namedRanges: [...(w.namedRanges ?? []), nr] }), 'add named range');
    },
    [mutateWb],
  );

  const removeNamedRange = useCallback(
    (name: string) => {
      mutateWb(
        (w) => ({ ...w, namedRanges: (w.namedRanges ?? []).filter((r) => r.name !== name) }),
        'remove named range',
      );
    },
    [mutateWb],
  );

  // ---- Filter ----

  const filteredOutRows = useMemo(
    () => (activeSheet ? computeFilteredOutRows(activeSheet) : []),
    [activeSheet],
  );

  const [filterPopover, setFilterPopover] = useState<{
    col: number;
    x: number;
    y: number;
  } | null>(null);

  const handleCreateFilter = useCallback(() => {
    if (!activeSheet) return;
    const used = computeUsedRange(activeSheet);
    const range =
      sel.sr === sel.er && sel.sc === sel.ec
        ? used
        : normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    if (!range) return;
    mutateSheet(
      (s) => ({ ...s, filter: { range, criteria: {} } }),
      'create filter',
    );
  }, [activeSheet, sel, mutateSheet]);

  const handleRemoveFilter = useCallback(() => {
    mutateSheet((s) => ({ ...s, filter: null }), 'remove filter');
    setFilterPopover(null);
  }, [mutateSheet]);

  const setFilterCriterion = useCallback(
    (col: number, criterion: SheetFilterCriterion | null) => {
      mutateSheet((s) => {
        if (!s.filter) return s;
        const criteria = { ...(s.filter.criteria ?? {}) };
        if (criterion === null) delete criteria[String(col)];
        else criteria[String(col)] = criterion;
        return { ...s, filter: { ...s.filter, criteria } };
      }, 'update filter');
    },
    [mutateSheet],
  );

  // ---- Sort ----

  const handleSortSheet = useCallback(
    (dir: SortDir) => {
      mutateSheet(
        (s) => sortSheet(s, { byCol: active.c, dir }),
        `sort sheet ${dir === 'asc' ? 'A→Z' : 'Z→A'}`,
      );
    },
    [active.c, mutateSheet],
  );

  const handleSortRange = useCallback(
    (dir: SortDir) => {
      const range = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
      // A single-cell selection isn't a meaningful range; fall back to sheet.
      const isSingle = range.r1 === range.r2 && range.c1 === range.c2;
      mutateSheet(
        (s) =>
          sortSheet(s, {
            byCol: active.c,
            dir,
            range: isSingle ? undefined : range,
          }),
        `sort ${isSingle ? 'sheet' : 'range'} ${dir === 'asc' ? 'A→Z' : 'Z→A'}`,
      );
    },
    [active.c, sel, mutateSheet],
  );

  // ---- Hide / unhide rows & columns ----

  const handleHideRows = useCallback(() => {
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const set = new Set(s.hiddenRows ?? []);
      for (let row = r.r1; row <= r.r2; row++) set.add(row);
      return { ...s, hiddenRows: [...set].sort((a, b) => a - b) };
    }, 'hide rows');
  }, [sel, mutateSheet]);

  const handleHideCols = useCallback(() => {
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const set = new Set(s.hiddenCols ?? []);
      for (let col = r.c1; col <= r.c2; col++) set.add(colA1(col));
      return { ...s, hiddenCols: [...set].sort() };
    }, 'hide columns');
  }, [sel, mutateSheet]);

  const handleUnhideRows = useCallback(() => {
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const set = new Set(s.hiddenRows ?? []);
      // Unhide any hidden row that lies between r1-1 and r2+1 inclusive,
      // i.e. the user selected the visible rows bracketing a hidden span.
      for (let row = r.r1; row <= r.r2; row++) set.delete(row);
      return { ...s, hiddenRows: [...set].sort((a, b) => a - b) };
    }, 'unhide rows');
  }, [sel, mutateSheet]);

  const handleUnhideCols = useCallback(() => {
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const set = new Set(s.hiddenCols ?? []);
      for (let col = r.c1; col <= r.c2; col++) set.delete(colA1(col));
      return { ...s, hiddenCols: [...set].sort() };
    }, 'unhide columns');
  }, [sel, mutateSheet]);

  // True when the current selection contains at least one hidden row/col.
  const selHasHiddenRow = useMemo(() => {
    if (!activeSheet) return false;
    const hidden = new Set(activeSheet.hiddenRows ?? []);
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    for (let row = r.r1; row <= r.r2; row++) if (hidden.has(row)) return true;
    return false;
  }, [activeSheet, sel]);

  const selHasHiddenCol = useMemo(() => {
    if (!activeSheet) return false;
    const hidden = new Set(activeSheet.hiddenCols ?? []);
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    for (let col = r.c1; col <= r.c2; col++)
      if (hidden.has(colA1(col))) return true;
    return false;
  }, [activeSheet, sel]);

  // ---- Sheet rename / delete ----

  const handleSheetRename = useCallback(
    (sheetId: string, name: string) => {
      mutateWb(
        (w) => ({
          ...w,
          sheets: w.sheets.map((s) =>
            s.id === sheetId ? { ...s, name } : s,
          ),
        }),
        'rename sheet',
      );
    },
    [mutateWb],
  );

  const handleSheetDelete = useCallback(
    (sheetId: string) => {
      if (!wb || wb.sheets.length <= 1) return;
      setDeletingSheetId(sheetId);
    },
    [wb],
  );

  const confirmSheetDelete = useCallback(() => {
    if (!deletingSheetId) return;
    const sheetId = deletingSheetId;
    mutateWb(
      (w) => {
        if (w.sheets.length <= 1) return w;
        const remaining = w.sheets.filter((s) => s.id !== sheetId);
        const nextActive =
          w.activeSheetId === sheetId
            ? remaining[0].id
            : w.activeSheetId;
        return { ...w, sheets: remaining, activeSheetId: nextActive };
      },
      'delete sheet',
    );
  }, [deletingSheetId, mutateWb]);

  const deletingSheetName = useMemo(
    () =>
      deletingSheetId
        ? wb?.sheets.find((s) => s.id === deletingSheetId)?.name ?? ''
        : '',
    [deletingSheetId, wb],
  );

  const handleSheetReorder = useCallback(
    (sheetId: string, toIndex: number) => {
      mutateWb(
        (w) => {
          // Sort current sheets by index, then move the dragged one to toIndex.
          const sorted = [...w.sheets].sort(
            (a, b) => (a.index ?? 0) - (b.index ?? 0),
          );
          const fromIdx = sorted.findIndex((s) => s.id === sheetId);
          if (fromIdx < 0) return w;
          const [moved] = sorted.splice(fromIdx, 1);
          const clamped = Math.max(0, Math.min(sorted.length, toIndex));
          sorted.splice(clamped, 0, moved);
          // Re-assign indices in iteration order.
          const reindexed = sorted.map((s, i) => ({ ...s, index: i }));
          // Preserve the original array shape (Mongoose sub-doc ids), but
          // assign new indices by id-lookup.
          const byId = new Map(reindexed.map((s) => [s.id, s]));
          return {
            ...w,
            sheets: w.sheets.map((s) => byId.get(s.id) ?? s),
          };
        },
        'reorder sheet',
      );
    },
    [mutateWb],
  );

  const handleSheetHide = useCallback(
    (sheetId: string) => {
      mutateWb(
        (w) => ({
          ...w,
          sheets: w.sheets.map((s) => (s.id === sheetId ? { ...s, hidden: true } : s)),
        }),
        'hide sheet',
      );
    },
    [mutateWb],
  );

  const handleSheetUnhide = useCallback(
    (sheetId: string) => {
      mutateWb(
        (w) => ({
          ...w,
          sheets: w.sheets.map((s) => (s.id === sheetId ? { ...s, hidden: false } : s)),
        }),
        'unhide sheet',
      );
    },
    [mutateWb],
  );

  const handleSheetColor = useCallback(
    (sheetId: string, color: string | null) => {
      mutateWb(
        (w) => ({
          ...w,
          sheets: w.sheets.map((s) =>
            s.id === sheetId ? { ...s, color } : s,
          ),
        }),
        color ? 'color sheet' : 'clear sheet color',
      );
    },
    [mutateWb],
  );

  const handleSheetDuplicate = useCallback(
    (sheetId: string) => {
      mutateWb(
        (w) => {
          const src = w.sheets.find((s) => s.id === sheetId);
          if (!src) return w;
          const newId = `sh_${Math.random().toString(36).slice(2, 8)}`;
          const maxIndex = w.sheets.reduce(
            (m, s) => Math.max(m, s.index ?? 0),
            -1,
          );
          const baseName = `${src.name} copy`;
          let name = baseName;
          let n = 2;
          while (w.sheets.some((s) => s.name === name)) {
            name = `${baseName} ${n++}`;
          }
          return {
            ...w,
            sheets: [
              ...w.sheets,
              { ...src, id: newId, name, index: maxIndex + 1 },
            ],
            activeSheetId: newId,
          };
        },
        'duplicate sheet',
      );
    },
    [mutateWb],
  );

  // ---- ----

  const clearSelection = useCallback(() => {
    if (!activeSheet) return;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    mutateSheet((s) => {
      const cells = { ...s.cells };
      for (let rr = r.r1; rr <= r.r2; rr++) {
        for (let cc = r.c1; cc <= r.c2; cc++) {
          delete cells[rcToA1(rr, cc)];
        }
      }
      return { ...s, cells };
    }, 'delete cells');
  }, [sel, activeSheet, mutateSheet]);

  // ---- Keyboard ----

  // Jump to the edge of a data block in a given direction (Excel Ctrl+Arrow).
  const findEdge = useCallback(
    (r: number, c: number, dr: number, dc: number): { r: number; c: number } => {
      if (!activeSheet) return { r, c };
      const maxR = activeSheet.rowCount - 1;
      const maxC = activeSheet.colCount - 1;
      const has = (row: number, col: number) => {
        if (row < 0 || row > maxR || col < 0 || col > maxC) return false;
        const cell = activeSheet.cells?.[rcToA1(row, col)];
        return !!cell && (cell.v !== undefined && cell.v !== null && cell.v !== '') || !!cell?.f;
      };
      const cur = has(r, c);
      const nr0 = r + dr, nc0 = c + dc;
      if (cur && has(nr0, nc0)) {
        // Move to end of current data block
        let lr = nr0, lc = nc0;
        while (has(lr + dr, lc + dc)) { lr += dr; lc += dc; }
        return { r: clamp(lr, 0, maxR), c: clamp(lc, 0, maxC) };
      } else {
        // Skip to next non-empty cell (or boundary)
        let lr = nr0, lc = nc0;
        while (lr >= 0 && lr <= maxR && lc >= 0 && lc <= maxC) {
          if (has(lr, lc)) return { r: lr, c: lc };
          lr += dr; lc += dc;
        }
        return { r: dr > 0 ? maxR : dr < 0 ? 0 : r, c: dc > 0 ? maxC : dc < 0 ? 0 : c };
      }
    },
    [activeSheet],
  );

  const onGridKeyDown = useCallback(
    (ev: React.KeyboardEvent) => {
      if (editing) return; // editor handles its own keys
      const ext = ev.shiftKey;
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod) {
        const k = ev.key.toLowerCase();
        if (k === 's') {
          ev.preventDefault();
          saveNow();
          return;
        }
        if (k === 'p') {
          ev.preventDefault();
          setPrintOpen(true);
          return;
        }
        if (k === 'f') {
          ev.preventDefault();
          setFindReplaceMode('find');
          return;
        }
        if (k === 'h') {
          ev.preventDefault();
          setFindReplaceMode('replace');
          return;
        }
        if (k === '/') {
          ev.preventDefault();
          setShortcutsOpen(true);
          return;
        }
        if (k === 'z' && !ev.shiftKey) {
          ev.preventDefault();
          undo();
          return;
        }
        if (k === 'y' || (k === 'z' && ev.shiftKey)) {
          ev.preventDefault();
          redo();
          return;
        }
        if (k === 'c') {
          ev.preventDefault();
          handleCopy('copy');
          return;
        }
        if (k === 'x') {
          ev.preventDefault();
          handleCopy('cut');
          return;
        }
        if (k === 'v') {
          ev.preventDefault();
          handlePaste();
          return;
        }
        if (k === 'a') {
          ev.preventDefault();
          if (activeSheet) {
            setSel({
              sr: 0,
              sc: 0,
              er: activeSheet.rowCount - 1,
              ec: activeSheet.colCount - 1,
            });
          }
          return;
        }
        if (k === 'b') {
          ev.preventDefault();
          toggleStyle('b');
          return;
        }
        if (k === 'i') {
          ev.preventDefault();
          toggleStyle('i');
          return;
        }
        if (k === 'u') {
          ev.preventDefault();
          toggleStyle('u');
          return;
        }
        // Ctrl+Home → A1
        if (ev.key === 'Home') {
          ev.preventDefault();
          if (ext) { setSel((s) => ({ sr: 0, sc: 0, er: s.er, ec: s.ec })); setActive({ r: 0, c: 0 }); }
          else setSelToCell(0, 0);
          return;
        }
        // Ctrl+End → last used cell
        if (ev.key === 'End' && activeSheet) {
          ev.preventDefault();
          const used = computeUsedRange(activeSheet);
          const r = used ? used.r2 : activeSheet.rowCount - 1;
          const c = used ? used.c2 : activeSheet.colCount - 1;
          if (ext) { setSel((s) => ({ sr: s.sr, sc: s.sc, er: r, ec: c })); setActive({ r, c }); }
          else setSelToCell(r, c);
          return;
        }
        // Ctrl+Arrow → jump to data edge
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault();
          const dr = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
          const dc = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
          const dest = findEdge(active.r, active.c, dr, dc);
          if (ext) { setSel((s) => ({ sr: s.sr, sc: s.sc, er: dest.r, ec: dest.c })); setActive(dest); }
          else setSelToCell(dest.r, dest.c);
          return;
        }
        // Ctrl+Shift+V → paste values only
        if (k === 'v' && ext) {
          ev.preventDefault();
          handlePasteValuesOnly();
          return;
        }
      }
      switch (ev.key) {
        case 'Home':
          // Home (no mod) → move to column A
          ev.preventDefault();
          if (ext) setSel((s) => ({ sr: s.sr, sc: 0, er: s.er, ec: s.ec }));
          else setSelToCell(active.r, 0);
          return;
        case 'PageDown':
          ev.preventDefault(); {
            const pageRows = Math.max(1, Math.floor((activeSheet?.rowCount ?? 50) / 4));
            const r = clamp(active.r + pageRows, 0, (activeSheet?.rowCount ?? 1) - 1);
            ext ? (setSel((s) => ({ ...s, er: r, ec: s.ec })), setActive({ r, c: active.c }))
                : setSelToCell(r, active.c);
          }
          return;
        case 'PageUp':
          ev.preventDefault(); {
            const pageRows = Math.max(1, Math.floor((activeSheet?.rowCount ?? 50) / 4));
            const r = clamp(active.r - pageRows, 0, (activeSheet?.rowCount ?? 1) - 1);
            ext ? (setSel((s) => ({ ...s, er: r, ec: s.ec })), setActive({ r, c: active.c }))
                : setSelToCell(r, active.c);
          }
          return;
        case 'ArrowUp':
          ev.preventDefault();
          moveActive(-1, 0, ext);
          return;
        case 'ArrowDown':
          ev.preventDefault();
          moveActive(1, 0, ext);
          return;
        case 'ArrowLeft':
          ev.preventDefault();
          moveActive(0, -1, ext);
          return;
        case 'ArrowRight':
          ev.preventDefault();
          moveActive(0, 1, ext);
          return;
        case 'Tab':
          ev.preventDefault();
          moveActive(0, ext ? -1 : 1);
          return;
        case 'Enter':
          ev.preventDefault();
          if (ev.altKey || ev.metaKey) return;
          startEdit(active.r, active.c);
          return;
        case 'F2':
          ev.preventDefault();
          startEdit(active.r, active.c);
          return;
        case 'Delete':
        case 'Backspace':
          ev.preventDefault();
          clearSelection();
          return;
        case 'Escape':
          clearClipboard();
          return;
      }
      // Printable character → start editing with that char
      if (
        ev.key.length === 1 &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey
      ) {
        ev.preventDefault();
        startEdit(active.r, active.c, ev.key);
      }
    },
    [
      editing,
      moveActive,
      startEdit,
      active,
      clearSelection,
      activeSheet,
      handleCopy,
      handlePaste,
      handlePasteValuesOnly,
      clearClipboard,
      undo,
      redo,
      toggleStyle,
      saveNow,
      findEdge,
    ],
  );

  // ---- Sheet name + workbook name + sheet add ----

  const handleNameChange = useCallback(
    (name: string) => {
      mutateWb((w) => ({ ...w, name }));
    },
    [mutateWb],
  );

  const handleSheetSelect = useCallback(
    (sheetId: string) => {
      mutateWb((w) => ({ ...w, activeSheetId: sheetId }));
    },
    [mutateWb],
  );

  const handleSheetAdd = useCallback(() => {
    mutateWb(
      (w) => {
        const newId = `sh_${Math.random().toString(36).slice(2, 8)}`;
        const nums = w.sheets
          .map((s) => {
            const m = s.name.match(/^Sheet(\d+)$/);
            return m ? parseInt(m[1], 10) : 0;
          })
          .filter((n) => n > 0);
        const next = nums.length ? Math.max(...nums) + 1 : 1;
        const maxIndex = w.sheets.reduce(
          (m, s) => Math.max(m, s.index ?? 0),
          -1,
        );
        return {
          ...w,
          sheets: [
            ...w.sheets,
            {
              id: newId,
              name: `Sheet${next}`,
              rowCount: 100,
              colCount: 26,
              cells: {},
              colWidths: {},
              rowHeights: {},
              frozen: { rows: 0, cols: 0 },
              hiddenRows: [],
              hiddenCols: [],
              merges: [],
              gridlines: true,
              color: null,
              hidden: false,
              index: maxIndex + 1,
              filter: null,
              condFmt: [],
              validations: [],
              charts: [],
            },
          ],
          activeSheetId: newId,
        };
      },
      'add sheet',
    );
  }, [mutateWb]);

  // ---- Status bar stats — must be above any early return (Rules of Hooks) ----
  const statusStats = useMemo(() => {
    if (!activeSheet) return null;
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    const isSingleCell = r.r1 === r.r2 && r.c1 === r.c2;
    const hiddenRows = new Set([
      ...(activeSheet.hiddenRows ?? []),
      ...filteredOutRows,
    ]);
    let count = 0;
    let numCount = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let row = r.r1; row <= r.r2; row++) {
      if (hiddenRows.has(row)) continue;
      for (let col = r.c1; col <= r.c2; col++) {
        const a1 = rcToA1(row, col);
        const cell = activeSheet.cells?.[a1];
        if (!cell) continue;
        const raw = cell.f ? computed[a1] : cell.v;
        if (raw == null || raw === '') continue;
        count++;
        const n = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
        if (!Number.isNaN(n) && Number.isFinite(n)) {
          numCount++;
          sum += n;
          if (n < min) min = n;
          if (n > max) max = n;
        }
      }
    }
    if (isSingleCell && count === 0) return null;
    const avg = numCount > 0 ? sum / numCount : null;
    return {
      count,
      numCount,
      sum: numCount > 0 ? sum : null,
      avg,
      min: numCount > 0 ? min : null,
      max: numCount > 0 ? max : null,
    };
  }, [activeSheet, sel, computed, filteredOutRows]);

  // ---- Render ----

  if (isLoading || !wb || !activeSheet) {
    return (
      <div className="-mx-6 -my-5 h-[calc(100vh-60px)] flex flex-col bg-bg-card overflow-hidden">
        {/* Title bar skeleton */}
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-b border-border">
          {onBack && <div className="w-9 h-9 rounded bg-bg-hover" />}
          <div className="w-9 h-9 rounded bg-bg-hover" />
          <div className="flex flex-col gap-1 flex-1">
            <div className="h-5 w-48 rounded bg-bg-hover animate-pulse" />
            <div className="flex gap-3 mt-0.5">
              {['File','Edit','View','Insert','Format','Data'].map((l) => (
                <div key={l} className="h-3.5 w-8 rounded bg-bg-hover animate-pulse" />
              ))}
            </div>
          </div>
          <div className="h-9 w-20 rounded-full bg-[var(--sh-header-bg-sel-strong)] animate-pulse" />
        </div>
        {/* Toolbar skeleton */}
        <div className="flex items-center gap-1 px-2 h-10 border-b border-border">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="w-7 h-7 rounded bg-bg-hover animate-pulse" />
          ))}
        </div>
        {/* Formula bar skeleton */}
        <div className="flex items-center gap-2 px-2 h-9 border-b border-border">
          <div className="w-16 h-6 rounded border border-border bg-[var(--sh-header-bg)] animate-pulse" />
          <div className="w-px h-5 bg-border" />
          <div className="flex-1 h-6 rounded bg-[var(--sh-header-bg)] animate-pulse" />
        </div>
        {/* Grid skeleton */}
        <div className="flex-1 overflow-hidden">
          {/* Column header row */}
          <div className="flex border-b border-border bg-[var(--sh-header-bg)]">
            <div className="w-10 h-6 border-r border-border flex-shrink-0" />
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="w-24 h-6 border-r border-border flex items-center justify-center">
                <div className="w-4 h-3 rounded bg-bg-hover animate-pulse" />
              </div>
            ))}
          </div>
          {/* Data rows */}
          {Array.from({ length: 18 }).map((_, row) => (
            <div key={row} className="flex border-b border-border">
              <div className="w-10 h-[25px] border-r border-border flex-shrink-0 bg-[var(--sh-header-bg)] flex items-center justify-center">
                <div className="w-5 h-3 rounded bg-bg-hover animate-pulse" />
              </div>
              {Array.from({ length: 10 }).map((_, col) => (
                <div key={col} className="w-24 h-[25px] border-r border-border px-2 flex items-center">
                  {(row + col) % 5 === 0 && (
                    <div
                      className="h-3 rounded bg-bg-hover animate-pulse"
                      style={{ width: `${40 + ((row * 7 + col * 13) % 50)}px` }}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Sheet tabs skeleton */}
        <div className="flex items-center gap-1 px-2 h-8 border-t border-border bg-[var(--sh-header-bg)]">
          <div className="w-7 h-6 rounded bg-bg-hover animate-pulse" />
          <div className="w-20 h-6 rounded bg-bg-hover animate-pulse" />
        </div>
      </div>
    );
  }

  // Smart name box: reflect whole-column, whole-row, or multi-cell range selections.
  const cellRef = (() => {
    const r = normalizeRange(sel.sr, sel.sc, sel.er, sel.ec);
    const isWholeCol =
      r.r1 === 0 && r.r2 === activeSheet.rowCount - 1 && r.c1 !== r.c2;
    const isWholeRow =
      r.c1 === 0 && r.c2 === activeSheet.colCount - 1 && r.r1 !== r.r2;
    const isRange = r.r1 !== r.r2 || r.c1 !== r.c2;
    if (isWholeCol) return `${colA1(r.c1)}:${colA1(r.c2)}`;
    if (isWholeRow) return `${r.r1 + 1}:${r.r2 + 1}`;
    if (isRange) return `${rcToA1(r.r1, r.c1)}:${rcToA1(r.r2, r.c2)}`;
    return rcToA1(active.r, active.c);
  })();
  const activeCellA1 = rcToA1(active.r, active.c);
  const activeCell = activeSheet.cells?.[activeCellA1];
  const activeCellDisplayText =
    activeCell?.v != null && activeCell.v !== ''
      ? String(activeCell.v)
      : '';
  const formulaValue = editing
    ? editing.value
    : activeCell?.f
      ? activeCell.f
      : activeCell?.v != null
        ? formatComputed(activeCell.v)
        : '';

  const menus: MenuDef[] = [
    {
      name: 'File',
      sections: [
        {
          items: [
            {
              label: 'Save',
              shortcut: 'Ctrl+S',
              onClick: saveNow,
            },
            {
              label: autoSave ? 'Auto-save: On' : 'Auto-save: Off',
              onClick: toggleAutoSave,
            },
          ],
        },
        {
          items: [
            { label: 'New', disabled: true },
            { label: 'Rename', onClick: () => $rename() },
            { label: 'Make a copy', onClick: () => copy.mutate(wb._id) },
          ],
        },
        {
          items: [
            { label: 'Import from CSV / Google Sheets…', onClick: () => setImporting(true) },
            'divider',
            { label: 'Download as CSV', onClick: () => $downloadCSV() },
            {
              label: 'Download as XLSX',
              onClick: () => $downloadXLSX(),
            },
            { label: 'Download as PDF…', onClick: () => setPrintOpen(true) },
            {
              label: 'Print…',
              shortcut: 'Ctrl+P',
              onClick: () => setPrintOpen(true),
            },
            { label: 'Page setup…', onClick: () => setPrintOpen(true) },
            'divider',
            { label: 'Set print area', onClick: () => setPrintArea() },
            {
              label: 'Clear print area',
              onClick: () => clearPrintArea(),
              disabled: !activeSheet?.printSetup?.printArea,
            },
          ],
        },
      ],
    },
    {
      name: 'Edit',
      sections: [
        {
          items: [
            {
              label: 'Undo',
              shortcut: 'Ctrl+Z',
              disabled: !canUndo,
              onClick: undo,
            },
            {
              label: 'Redo',
              shortcut: 'Ctrl+Y',
              disabled: !canRedo,
              onClick: redo,
            },
          ],
        },
        {
          items: [
            {
              label: 'Cut',
              shortcut: 'Ctrl+X',
              onClick: () => handleCopy('cut'),
            },
            {
              label: 'Copy',
              shortcut: 'Ctrl+C',
              onClick: () => handleCopy('copy'),
            },
            {
              label: 'Paste',
              shortcut: 'Ctrl+V',
              onClick: () => void handlePaste(),
            },
            {
              label: 'Paste values only',
              shortcut: 'Ctrl+Shift+V',
              onClick: () => void handlePasteValuesOnly(),
            },
          ],
        },
        {
          items: [
            {
              label: 'Delete values',
              shortcut: 'Del',
              onClick: () => clearSelection(),
            },
            {
              label: 'Delete row',
              onClick: handleDeleteRow,
              disabled: activeSheet.rowCount <= 1,
            },
            {
              label: 'Delete column',
              onClick: handleDeleteCol,
              disabled: activeSheet.colCount <= 1,
            },
            {
              label: 'Select all',
              shortcut: 'Ctrl+A',
              onClick: () =>
                setSel({
                  sr: 0,
                  sc: 0,
                  er: activeSheet.rowCount - 1,
                  ec: activeSheet.colCount - 1,
                }),
            },
            {
              label: 'Find',
              shortcut: 'Ctrl+F',
              onClick: () => setFindReplaceMode('find'),
            },
            {
              label: 'Find & replace',
              shortcut: 'Ctrl+H',
              onClick: () => setFindReplaceMode('replace'),
            },
          ],
        },
      ],
    },
    {
      name: 'View',
      sections: [
        {
          items: [
            {
              label: activeSheet.gridlines === false
                ? 'Show gridlines'
                : 'Hide gridlines',
              onClick: () =>
                mutateSheet(
                  (s) => ({ ...s, gridlines: !(s.gridlines !== false) }),
                  'toggle gridlines',
                ),
            },
            {
              label: pageBreakView
                ? 'Hide page breaks'
                : 'Page break preview',
              onClick: () => setPageBreakView((v) => !v),
            },
          ],
        },
        {
          items: [
            {
              label: 'No frozen rows',
              onClick: () => handleFreezeRows(0),
            },
            {
              label: '1 row',
              onClick: () => handleFreezeRows(1),
            },
            {
              label: '2 rows',
              onClick: () => handleFreezeRows(2),
            },
            {
              label: `Up to current row (${active.r + 1})`,
              onClick: () => handleFreezeRows(active.r + 1),
            },
          ],
        },
        {
          items: [
            {
              label: 'No frozen columns',
              onClick: () => handleFreezeCols(0),
            },
            {
              label: '1 column',
              onClick: () => handleFreezeCols(1),
            },
            {
              label: '2 columns',
              onClick: () => handleFreezeCols(2),
            },
            {
              label: `Up to current column (${colA1(active.c)})`,
              onClick: () => handleFreezeCols(active.c + 1),
            },
          ],
        },
      ],
    },
    {
      name: 'Insert',
      sections: [
        {
          items: [
            { label: 'New sheet', onClick: handleSheetAdd },
          ],
        },
        {
          items: [
            { label: 'Row above', onClick: handleInsertRowAbove },
            { label: 'Row below', onClick: handleInsertRowBelow },
            { label: 'Column left', onClick: handleInsertColLeft },
            { label: 'Column right', onClick: handleInsertColRight },
          ],
        },
        {
          items: [
            { label: 'Chart…', onClick: openInsertChart },
          ],
        },
        {
          items: [
            { label: 'Image in cell', onClick: handleInsertImage },
            {
              label: 'Crop image',
              onClick: openCropForActive,
              disabled: !activeCell?.img,
            },
            {
              label: 'Remove image',
              onClick: removeImage,
              disabled: !activeCell?.img,
            },
          ],
        },
        {
          items: [
            {
              label: activeCell?.note ? 'Edit note' : 'Insert note',
              onClick: openNoteEditor,
            },
            {
              label: 'Remove note',
              onClick: removeNote,
              disabled: !activeCell?.note,
            },
          ],
        },
        {
          items: [
            {
              label: 'Function…',
              shortcut: 'Shift+F3',
              onClick: () => setWizardProps({
                currentFormula: '',
                onInsert: (formula: string) => {
                  setEditing((cur) =>
                    cur
                      ? { ...cur, value: formula }
                      : { r: active.r, c: active.c, value: formula, source: 'formula-bar' },
                  );
                },
              }),
            },
            {
              label: 'Operators & Symbols reference',
              onClick: () => setSymbolsOpen(true),
            },
          ],
        },
      ],
    },
    {
      name: 'Format',
      sections: [
        {
          items: [
            {
              label: 'Bold',
              shortcut: 'Ctrl+B',
              onClick: () => toggleStyle('b'),
            },
            {
              label: 'Italic',
              shortcut: 'Ctrl+I',
              onClick: () => toggleStyle('i'),
            },
            {
              label: 'Underline',
              shortcut: 'Ctrl+U',
              onClick: () => toggleStyle('u'),
            },
            {
              label: 'Strikethrough',
              onClick: () => toggleStyle('s'),
            },
          ],
        },
        {
          items: [
            { label: 'Wrap text', onClick: () => toggleStyle('wrap') },
            { label: 'Align left', onClick: () => applyStyle({ ha: 'left' }) },
            { label: 'Align center', onClick: () => applyStyle({ ha: 'center' }) },
            { label: 'Align right', onClick: () => applyStyle({ ha: 'right' }) },
          ],
        },
        {
          items: hasMergeOverlap
            ? [{ label: 'Unmerge cells', onClick: handleUnmergeCells }]
            : [
                {
                  label: 'Merge cells',
                  onClick: handleMergeCells,
                  disabled: isRangeSingle,
                },
                {
                  label: 'Merge & center',
                  onClick: handleMergeAndCenter,
                  disabled: isRangeSingle,
                },
              ],
        },
        {
          items: [
            { label: 'Conditional formatting', onClick: openCondFmt },
            { label: 'Clear formatting', onClick: clearFormat },
          ],
        },
      ],
    },
    {
      name: 'Data',
      sections: [
        {
          items: [
            {
              label: `Sort sheet by column ${colA1(active.c)} (A → Z)`,
              onClick: () => handleSortSheet('asc'),
            },
            {
              label: `Sort sheet by column ${colA1(active.c)} (Z → A)`,
              onClick: () => handleSortSheet('desc'),
            },
          ],
        },
        {
          items: [
            {
              label: `Sort range by column ${colA1(active.c)} (A → Z)`,
              onClick: () => handleSortRange('asc'),
              disabled:
                sel.sr === sel.er && sel.sc === sel.ec,
            },
            {
              label: `Sort range by column ${colA1(active.c)} (Z → A)`,
              onClick: () => handleSortRange('desc'),
              disabled:
                sel.sr === sel.er && sel.sc === sel.ec,
            },
          ],
        },
        {
          items: [
            activeSheet.filter
              ? { label: 'Remove filter', onClick: handleRemoveFilter }
              : { label: 'Create a filter', onClick: handleCreateFilter },
          ],
        },
        {
          items: [
            { label: 'Data validation', onClick: openValidation },
          ],
        },
        {
          items: [
            { label: 'Named ranges', onClick: () => setNamedRangesOpen(true) },
          ],
        },
      ],
    },
    {
      name: 'Tools',
      sections: [{ items: [{ label: 'Coming soon', disabled: true }] }],
    },
    {
      name: 'Extensions',
      sections: [{ items: [{ label: 'Coming soon', disabled: true }] }],
    },
    {
      name: 'Help',
      sections: [
        {
          items: [
            {
              label: 'Keyboard shortcuts',
              shortcut: 'Ctrl+/',
              onClick: () => setShortcutsOpen(true),
            },
          ],
        },
      ],
    },
  ];

  const ctxMenuSections: CtxMenuSection[] = ctxMenu
    ? buildCtxMenu(ctxMenu, {
        handleCopy,
        handlePaste,
        handlePasteValuesOnly,
        handleInsertRowAbove,
        handleInsertRowBelow,
        handleInsertColLeft,
        handleInsertColRight,
        handleDeleteRow,
        handleDeleteCol,
        handleInsertImage,
        openCropForActive,
        removeImage,
        clearSelection,
        handleHideRows,
        handleHideCols,
        handleUnhideRows,
        handleUnhideCols,
        handleSortSheet,
        handleSortRange,
        handleCreateFilter,
        handleRemoveFilter,
        openCondFmt,
        openValidation,
        openLinkModal: () => setLinkModalOpen(true),
        removeLink: () => setCellLink(null),
        hasLink: !!activeCell?.link,
        openNote: openNoteEditor,
        removeNote,
        hasNote: !!activeCell?.note,
        openComment: openCommentsAtActive,
        canDeleteRow: activeSheet.rowCount > 1,
        canDeleteCol: activeSheet.colCount > 1,
        hasImage: !!activeCell?.img,
        hasFilter: !!activeSheet.filter,
        selHasHiddenRow,
        selHasHiddenCol,
        selIsRange: !(sel.sr === sel.er && sel.sc === sel.ec),
        sortColLabel: colA1(active.c),
      })
    : [];

  function $rename() {
    const input = document.querySelector<HTMLInputElement>(
      'input[data-wb-name]',
    );
    input?.focus();
    input?.select();
  }

  function $downloadXLSX() {
    api
      .get<Blob>(`/workbooks/${wb!._id}/export.xlsx`, {
        responseType: 'blob',
      })
      .then((res) => {
        const url = URL.createObjectURL(res.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${wb!.name || 'Untitled'}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  function $importCells({ cells, merges, colWidths, rowHeights }: ImportResult) {
    mutateSheet((s) => {
      const next: typeof s = {
        ...s,
        cells: { ...s.cells },
        merges: merges ? [...merges] : s.merges,
        colWidths: colWidths ? { ...s.colWidths, ...colWidths } : s.colWidths,
        rowHeights: rowHeights ? { ...s.rowHeights, ...rowHeights } : s.rowHeights,
      };
      cells.forEach((row, r) => {
        row.forEach((cell, c) => {
          const key = rcToA1(r, c);
          if (cell) next.cells[key] = cell as Cell;
          else delete next.cells[key];
        });
      });
      if (cells.length > next.rowCount) next.rowCount = cells.length;
      const maxCols = Math.max(0, ...cells.map((r) => r.length));
      if (maxCols > next.colCount) next.colCount = maxCols;
      return next;
    }, 'import');
    toast('Imported successfully', 'success');
  }

  function $downloadCSV() {
    const lines: string[] = [];
    const r1 = 0;
    const r2 = activeSheet!.rowCount - 1;
    const c1 = 0;
    const c2 = activeSheet!.colCount - 1;
    // Trim to last non-empty row/col
    let maxR = -1;
    let maxC = -1;
    for (const key in activeSheet!.cells) {
      const m = key.match(/^([A-Z]+)(\d+)$/);
      if (!m) continue;
      const r = parseInt(m[2], 10) - 1;
      let col = 0;
      for (let i = 0; i < m[1].length; i++)
        col = col * 26 + (m[1].charCodeAt(i) - 64);
      col -= 1;
      if (r > maxR) maxR = r;
      if (col > maxC) maxC = col;
    }
    if (maxR < 0) return;
    for (let r = r1; r <= Math.min(maxR, r2); r++) {
      const row: string[] = [];
      for (let c = c1; c <= Math.min(maxC, c2); c++) {
        const cell = activeSheet!.cells[rcToA1(r, c)];
        if (!cell) {
          row.push('');
          continue;
        }
        const raw = cell.f
          ? formatComputed(computed[rcToA1(r, c)])
          : cell.v ?? '';
        let text = String(raw);
        if (/[",\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
        row.push(text);
      }
      lines.push(row.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${wb!.name || 'Untitled'} - ${activeSheet!.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      data-sh-print
      className="-mx-6 -my-5 flex flex-col h-[calc(100vh-60px)] bg-bg-card text-text"
    >
      <div data-sh-no-print>
      <TitleBar
        name={wb.name}
        onNameChange={handleNameChange}
        menus={menus}
        canShare={canShare}
        readOnly={readOnly}
        onShare={() => setSharing(true)}
        onBack={onBack}
        saveStatus={autoSave && !readOnly ? saveStatus : null}
      />
      <Toolbar
        activeStyle={activeStyle}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onToggle={toggleStyle}
        onFontSize={bumpFontSize}
        onFontSizeExact={setFontSizeExact}
        onFont={setFont}
        onAlignH={cycleAlignH}
        onAlignV={cycleAlignV}
        onColor={setColor}
        onNumberFormat={setNumberFormat}
        onDecimalPlaces={bumpDecimalPlaces}
        onClearFormat={clearFormat}
        onInsertImage={handleInsertImage}
        onBorder={applyBorders}
        paintActive={!!paintStyle}
        onPaintFormat={togglePaintFormat}
        onMerge={hasMergeOverlap ? handleUnmergeCells : handleMergeCells}
        onMergeAndCenter={handleMergeAndCenter}
        onUnmerge={handleUnmergeCells}
        canMerge={!isRangeSingle}
        hasMerge={hasMergeOverlap}
        onInsertLink={() => setLinkModalOpen(true)}
        hasLink={!!activeCell?.link}
        onInsertComment={openCommentsAtActive}
        onInsertChart={openInsertChart}
        onPrint={() => setPrintOpen(true)}
      />
      <input
        ref={insertImageRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImageFile(f);
          e.target.value = '';
        }}
      />
      <FormulaBar
        ref={formulaBarRef}
        cellRef={cellRef}
        value={formulaValue}
        editing={!!editing}
        onFocus={startEditFromBar}
        onChange={(v, programmatic) => {
          // User manually typed in the formula bar — exit formula-point mode so
          // the next cell click inserts a fresh ref at the new cursor position
          // rather than replacing the old injected ref.
          if (!programmatic) {
            formulaPointRef.current = null;
            setFormulaPointRange(null);
          }
          setEditing((cur) =>
            cur
              ? { ...cur, value: v }
              : { r: active.r, c: active.c, value: v, source: 'formula-bar' },
          );
        }}
        onCommit={(dir) => commitEdit(dir)}
        onCancel={cancelEdit}
        onOpenWizard={(props) => setWizardProps(props)}
        onNavigate={(ref) => {
          const colonIdx = ref.indexOf(':');
          if (colonIdx !== -1) {
            const a = a1ToRC(ref.slice(0, colonIdx));
            const b = a1ToRC(ref.slice(colonIdx + 1));
            if (a && b) {
              setActive({ r: a.r, c: a.c });
              setSel({ sr: a.r, sc: a.c, er: b.r, ec: b.c });
            }
          } else {
            const rc = a1ToRC(ref);
            if (rc) {
              setActive(rc);
              setSel({ sr: rc.r, sc: rc.c, er: rc.r, ec: rc.c });
            }
          }
        }}
      />
      </div>
      <div className="relative flex-1 min-h-0 flex flex-col">
      {isSheetEmpty && !editing && !readOnly && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-[13px] text-text-muted select-none">
            Click a cell to start typing
          </span>
        </div>
      )}
      <Grid
        sheet={activeSheet}
        computed={computed}
        sel={sel}
        active={active}
        editing={editing}
        draggingSel={draggingSel}
        focusKey={focusKey}
        fillTarget={fillTarget}
        copyMarquee={
          clipboard && clipboard.sheetId === activeSheet.id
            ? clipboard.source
            : null
        }
        formulaPointMarquee={formulaPointRange}
        filteredOutRows={filteredOutRows}
        condFmtStyles={condFmtStyles}
        commentedCells={commentedCellsForActive}
        filterChips={
          activeSheet.filter
            ? Array.from(
                {
                  length:
                    activeSheet.filter.range.c2 -
                    activeSheet.filter.range.c1 +
                    1,
                },
                (_, i) => {
                  const col = activeSheet.filter!.range.c1 + i;
                  return {
                    col,
                    active:
                      !!activeSheet.filter!.criteria?.[String(col)],
                  };
                },
              )
            : []
        }
        filterRow={activeSheet.filter?.range.r1 ?? null}
        filterRangeOutline={activeSheet.filter?.range ?? null}
        pageBreaks={pageBreaks}
        onFilterChipClick={(col, x, y) => setFilterPopover({ col, x, y })}
        validationFor={(r, c) => ruleForCell(activeSheet, r, c)}
        onCheckboxToggle={toggleCheckboxCell}
        onListOpen={(r, c, values, current, x, y) =>
          setListPopover({ r, c, values, current, x, y })
        }
        onMouseDownCell={(r, c, shift) => {
          // Formula point mode: when editing a formula, click inserts the cell
          // reference at the cursor rather than committing the edit.
          if (editing?.value.startsWith('=')) {
            const ref = rcToA1(r, c);
            const fp = formulaPointRef.current;
            if (fp) {
              formulaBarRef.current?.replaceRange(fp.insertStart, fp.insertLen, ref);
              formulaPointRef.current = { anchor: { r, c }, insertStart: fp.insertStart, insertLen: ref.length };
            } else {
              const pos = formulaBarRef.current?.getCursorPos() ?? editing.value.length;
              // Guard commitEdit against the synchronous blur that el.focus() fires
              // inside injectAtCursor (inline editor's onBlur → onEditCommit(null)).
              formulaPointingRef.current = true;
              formulaBarRef.current?.injectAtCursor(ref);
              formulaPointingRef.current = false;
              formulaPointRef.current = { anchor: { r, c }, insertStart: pos, insertLen: ref.length };
            }
            setFormulaPointRange({ r1: r, c1: c, r2: r, c2: c });
            setDraggingSel(true);
            return;
          }
          if (editing) commitEdit(null);
          if (paintStyle) {
            // Paint-format mode: apply captured style across the current
            // selection (extended via shift) or the single clicked cell.
            const target = shift
              ? normalizeRange(sel.sr, sel.sc, r, c)
              : { r1: r, c1: c, r2: r, c2: c };
            consumePaint(target.r1, target.c1, target.r2, target.c2);
            setSel({
              sr: target.r1,
              sc: target.c1,
              er: target.r2,
              ec: target.c2,
            });
            setActive({ r, c });
            focusGrid();
            return;
          }
          if (shift) extendSelToCell(r, c);
          else setSelToCell(r, c);
          setDraggingSel(true);
          focusGrid();
        }}
        onMouseOverCell={(r, c) => {
          // Formula point drag: extend the range ref in the formula.
          const fp = formulaPointRef.current;
          if (fp && draggingSel) {
            const { anchor, insertStart, insertLen } = fp;
            const r1 = Math.min(anchor.r, r);
            const c1 = Math.min(anchor.c, c);
            const r2 = Math.max(anchor.r, r);
            const c2 = Math.max(anchor.c, c);
            const ref = r1 === r2 && c1 === c2
              ? rcToA1(r1, c1)
              : `${rcToA1(r1, c1)}:${rcToA1(r2, c2)}`;
            formulaBarRef.current?.replaceRange(insertStart, insertLen, ref);
            formulaPointRef.current = { ...fp, insertLen: ref.length };
            setFormulaPointRange({ r1, c1, r2, c2 });
            return;
          }
          if (fillSource) {
            setFillTarget(computeFillTarget(fillSource, r, c));
          } else if (draggingSel) {
            extendSelToCell(r, c);
          }
        }}
        onMouseUp={() => {
          if (formulaPointRef.current) {
            // End formula point drag — stop dragging but keep formulaPointRef so
            // the next cell click replaces the injected ref instead of appending.
            setDraggingSel(false);
            return;
          }
          if (fillSource) onFillEnd();
          setDraggingSel(false);
        }}
        onFillStart={onFillStart}
        onColResize={handleColResize}
        onRowResize={handleRowResize}
        onSelectAll={() => {
          setSel({ sr: 0, sc: 0, er: activeSheet.rowCount - 1, ec: activeSheet.colCount - 1 });
          setActive({ r: 0, c: 0 });
          focusGrid();
        }}
        onColHeaderClick={selectColumn}
        onRowHeaderClick={selectRow}
        onColHeaderContextMenu={openColCtxMenu}
        onRowHeaderContextMenu={openRowCtxMenu}
        onCellContextMenu={openCellCtxMenu}
        onDoubleClick={(r, c) => startEdit(r, c)}
        onKeyDown={onGridKeyDown}
        onEditChange={(v) =>
          setEditing((cur) => (cur ? { ...cur, value: v } : cur))
        }
        onEditCommit={commitEdit}
        onEditCancel={cancelEdit}
      />
      <ChartOverlay
        sheet={activeSheet}
        computed={computed}
        readOnly={readOnly}
        onEdit={(chart) => setChartModal({ chart, isNew: false })}
        onRemove={removeChart}
        onMove={moveChart}
      />
      </div>
      <div data-sh-no-print className="flex items-stretch border-t border-border bg-[var(--sh-header-bg)] select-none" style={{ minHeight: 28 }}>
        {/* Sheet tabs on the left */}
        <div className="flex-1 overflow-hidden">
          <SheetTabs
            wb={wb}
            onSelect={handleSheetSelect}
            onAdd={handleSheetAdd}
            onRename={handleSheetRename}
            onDelete={handleSheetDelete}
            onReorder={handleSheetReorder}
            onSetColor={handleSheetColor}
            onDuplicate={handleSheetDuplicate}
            onHide={handleSheetHide}
            onUnhide={handleSheetUnhide}
          />
        </div>
        {/* Status bar stats on the right */}
        {statusStats && (
          <div className="flex items-center gap-1 px-3 text-[11px] text-[var(--sh-header-text)] shrink-0 border-l border-border">
            {statusStats.count > 0 && (
              <button
                className="px-2 py-0.5 rounded hover:bg-[var(--sh-header-bg-sel)] hover:text-[var(--sh-accent-text)] transition-colors"
                title="Copy count"
                onClick={() => navigator.clipboard?.writeText(String(statusStats.count))}
              >
                Count: <span className="font-medium">{statusStats.count}</span>
              </button>
            )}
            {statusStats.numCount >= 2 && statusStats.sum !== null && (
              <>
                <button
                  className="px-2 py-0.5 rounded hover:bg-[var(--sh-header-bg-sel)] hover:text-[var(--sh-accent-text)] transition-colors"
                  title="Copy sum"
                  onClick={() => navigator.clipboard?.writeText(String(statusStats.sum))}
                >
                  Sum: <span className="font-medium">{formatStat(statusStats.sum!)}</span>
                </button>
                <button
                  className="px-2 py-0.5 rounded hover:bg-[var(--sh-header-bg-sel)] hover:text-[var(--sh-accent-text)] transition-colors"
                  title="Copy average"
                  onClick={() => navigator.clipboard?.writeText(String(statusStats.avg))}
                >
                  Avg: <span className="font-medium">{formatStat(statusStats.avg!)}</span>
                </button>
                <button
                  className="px-2 py-0.5 rounded hover:bg-[var(--sh-header-bg-sel)] hover:text-[var(--sh-accent-text)] transition-colors"
                  title="Copy min"
                  onClick={() => navigator.clipboard?.writeText(String(statusStats.min))}
                >
                  Min: <span className="font-medium">{formatStat(statusStats.min!)}</span>
                </button>
                <button
                  className="px-2 py-0.5 rounded hover:bg-[var(--sh-header-bg-sel)] hover:text-[var(--sh-accent-text)] transition-colors"
                  title="Copy max"
                  onClick={() => navigator.clipboard?.writeText(String(statusStats.max))}
                >
                  Max: <span className="font-medium">{formatStat(statusStats.max!)}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          sections={ctxMenuSections}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {cropTarget && (
        <ImageCropModal
          src={cropTarget.src}
          onApply={applyCrop}
          onClose={() => setCropTarget(null)}
        />
      )}

      <InsertLinkModal
        open={linkModalOpen}
        initial={activeCell?.link ?? null}
        defaultText={activeCellDisplayText}
        onClose={() => setLinkModalOpen(false)}
        onApply={setCellLink}
      />

      <CellNoteModal
        open={!!noteTarget}
        initial={noteTarget?.text ?? ''}
        onClose={() => setNoteTarget(null)}
        onApply={applyNote}
      />

      {findReplaceMode && activeSheet && (
        <FindReplaceModal
          mode={findReplaceMode}
          sheet={activeSheet}
          computed={computed}
          onClose={() => setFindReplaceMode(null)}
          onNavigate={(r, c) => setSelToCell(r, c)}
          onReplaceOne={handleReplaceOne}
          onReplaceAll={handleReplaceAll}
        />
      )}

      {commentPopover && (
        <CommentsPopover
          workbookId={wb._id}
          sheetId={commentPopover.sheetId}
          cellRef={commentPopover.cellRef}
          comments={commentsForPopover}
          x={commentPopover.x}
          y={commentPopover.y}
          onClose={() => setCommentPopover(null)}
        />
      )}

      {condFmtOpen && (
        <ConditionalFormatPanel
          sheet={activeSheet}
          initialRange={normalizeRange(sel.sr, sel.sc, sel.er, sel.ec)}
          onClose={closeCondFmt}
          onAdd={addCondFmtRule}
          onUpdate={updateCondFmtRule}
          onRemove={removeCondFmtRule}
        />
      )}

      {validationOpen && (
        <DataValidationPanel
          sheet={activeSheet}
          initialRange={normalizeRange(sel.sr, sel.sc, sel.er, sel.ec)}
          onClose={closeValidation}
          onAdd={addValidationRule}
          onUpdate={updateValidationRule}
          onRemove={removeValidationRule}
        />
      )}

      {namedRangesOpen && (
        <NamedRangesModal
          open={namedRangesOpen}
          namedRanges={wb.namedRanges ?? []}
          sheets={wb.sheets.map((s) => ({ id: s.id, name: s.name }))}
          activeSheetId={wb.activeSheetId}
          onClose={() => setNamedRangesOpen(false)}
          onAdd={addNamedRange}
          onRemove={removeNamedRange}
        />
      )}

      <ImportModal
        open={importing}
        onClose={() => setImporting(false)}
        onImport={$importCells}
      />

      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {printOpen && activeSheet && (
        <PrintPreviewModal
          open
          onClose={() => setPrintOpen(false)}
          activeSheet={activeSheet}
          allSheets={wb.sheets}
          namedRanges={wb.namedRanges ?? []}
          fileName={wb.name}
          selection={
            sel.sr === sel.er && sel.sc === sel.ec
              ? null
              : normalizeRange(sel.sr, sel.sc, sel.er, sel.ec)
          }
          readOnly={readOnly}
          onSaveSetup={savePrintSetup}
        />
      )}

      {chartModal && activeSheet && (
        <ChartConfigModal
          open
          chart={chartModal.chart}
          sheet={activeSheet}
          computed={computed}
          isNew={chartModal.isNew}
          onClose={() => setChartModal(null)}
          onSave={(chart) => saveChart(chart, chartModal.isNew)}
        />
      )}

      {listPopover && (
        <ValidationListPopover
          values={listPopover.values}
          current={listPopover.current}
          x={listPopover.x}
          y={listPopover.y}
          onPick={(v) => {
            writeCellFromString(listPopover.r, listPopover.c, v);
            setListPopover(null);
          }}
          onClose={() => setListPopover(null)}
        />
      )}

      {filterPopover && activeSheet.filter && (
        <FilterPopover
          sheet={activeSheet}
          col={filterPopover.col}
          x={filterPopover.x}
          y={filterPopover.y}
          onClose={() => setFilterPopover(null)}
          onSort={(dir) =>
            mutateSheet(
              (s) =>
                sortSheet(s, {
                  byCol: filterPopover.col,
                  dir,
                  range: s.filter?.range,
                  hasHeader: true,
                }),
              `sort by column ${colA1(filterPopover.col)}`,
            )
          }
          onSetCriterion={(crit) =>
            setFilterCriterion(filterPopover.col, crit)
          }
        />
      )}

      {wizardProps && (
        <FunctionWizard
          {...wizardProps}
          onClose={() => setWizardProps(null)}
        />
      )}

      {symbolsOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40" onClick={() => setSymbolsOpen(false)}>
          <div className="bg-bg-card rounded-lg shadow-xl w-[560px] max-h-[520px] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-[15px] font-semibold text-text">Operators &amp; Symbols Reference</h2>
              <button onClick={() => setSymbolsOpen(false)} className="text-text-muted hover:text-text text-lg leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-3 text-[13px]">
              <p className="text-text-muted mb-3">All formulas start with <code className="bg-bg-subtle px-1 rounded font-mono">=</code></p>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left text-[11px] text-text-muted uppercase tracking-wide">
                    <th className="pb-2 pr-4 font-semibold">Symbol</th>
                    <th className="pb-2 pr-4 font-semibold">Meaning</th>
                    <th className="pb-2 font-semibold">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['+', 'Addition', '=A1+B1'],
                    ['-', 'Subtraction', '=A1-B1'],
                    ['*', 'Multiplication', '=A1*B1'],
                    ['/', 'Division', '=A1/B1'],
                    ['^', 'Exponentiation (power)', '=2^10  →  1024'],
                    ['%', 'Percent (divides by 100)', '=50%  →  0.5'],
                    ['&', 'Text concatenation', '="Hello "&A1'],
                    ['=', 'Equal to (comparison)', '=A1=B1'],
                    ['<>', 'Not equal to', '=A1<>0'],
                    ['<', 'Less than', '=A1<10'],
                    ['>', 'Greater than', '=A1>10'],
                    ['<=', 'Less than or equal', '=A1<=10'],
                    ['>=', 'Greater than or equal', '=A1>=10'],
                    [':', 'Range separator', '=SUM(A1:A10)'],
                    [',', 'Argument separator', '=IF(A1>0, 1, 0)'],
                    ['$', 'Absolute reference', '=$A$1  (locked)'],
                    ['( )', 'Grouping / function call', '=(A1+B1)*C1'],
                    ['"…"', 'Text literal', '="Hello World"'],
                  ].map(([sym, meaning, example]) => (
                    <tr key={sym} className="border-t border-border">
                      <td className="py-1.5 pr-4 font-mono text-accent-700 font-semibold w-[60px]">{sym}</td>
                      <td className="py-1.5 pr-4 text-text-sub">{meaning}</td>
                      <td className="py-1.5 font-mono text-[12px] text-text-muted">{example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 p-3 bg-bg-subtle rounded border border-border">
                <p className="text-[12px] font-semibold text-text-sub mb-1">Error values</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                  {[
                    ['#DIV/0!', 'Division by zero'],
                    ['#VALUE!', 'Wrong argument type'],
                    ['#REF!', 'Invalid cell reference'],
                    ['#NAME?', 'Unknown function name'],
                    ['#N/A', 'Value not found (VLOOKUP etc.)'],
                    ['#ERROR!', 'Formula parse error'],
                    ['#CIRCULAR!', 'Circular reference detected'],
                  ].map(([code, desc]) => (
                    <div key={code} className="flex gap-2">
                      <span className="font-mono text-red-600 min-w-[80px]">{code}</span>
                      <span className="text-text-muted">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ShareWorkbookModal
        workbookId={wb._id}
        workbookName={wb.name}
        open={sharing}
        onClose={() => setSharing(false)}
      />

      <Confirm
        open={!!deletingSheetId}
        title="Delete sheet?"
        body={
          <>
            Delete <strong>{deletingSheetName}</strong>? This cannot be undone
            from outside the spreadsheet — you can still undo it with Ctrl+Z
            while this workbook is open.
          </>
        }
        danger
        onConfirm={confirmSheetDelete}
        onClose={() => setDeletingSheetId(null)}
      />

      <Modal
        open={!!leaveDialog}
        onClose={() => setLeaveDialog(null)}
        size="sm"
        title="Unsaved changes"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLeaveDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                wbDirtyRef.current = false;
                router.push(leaveDialog!.href);
                setLeaveDialog(null);
              }}
            >
              Leave anyway
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const href = leaveDialog!.href;
                setLeaveDialog(null);
                saveAndNavigate(href);
              }}
            >
              Save &amp; leave
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-text-sub leading-[1.6]">
          You have unsaved changes. Do you want to save before leaving this page?
        </p>
      </Modal>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

interface CtxBuildArgs {
  handleCopy: (kind: 'copy' | 'cut') => void;
  handlePaste: () => void | Promise<void>;
  handlePasteValuesOnly: () => void;
  handleInsertRowAbove: () => void;
  handleInsertRowBelow: () => void;
  handleInsertColLeft: () => void;
  handleInsertColRight: () => void;
  handleDeleteRow: () => void;
  handleDeleteCol: () => void;
  handleInsertImage: () => void;
  openCropForActive: () => void;
  removeImage: () => void;
  clearSelection: () => void;
  handleHideRows: () => void;
  handleHideCols: () => void;
  handleUnhideRows: () => void;
  handleUnhideCols: () => void;
  handleSortSheet: (dir: SortDir) => void;
  handleSortRange: (dir: SortDir) => void;
  handleCreateFilter: () => void;
  handleRemoveFilter: () => void;
  openCondFmt: () => void;
  openValidation: () => void;
  openLinkModal: () => void;
  removeLink: () => void;
  hasLink: boolean;
  openNote: () => void;
  removeNote: () => void;
  hasNote: boolean;
  openComment: () => void;
  canDeleteRow: boolean;
  canDeleteCol: boolean;
  hasImage: boolean;
  hasFilter: boolean;
  selHasHiddenRow: boolean;
  selHasHiddenCol: boolean;
  selIsRange: boolean;
  sortColLabel: string;
}

function buildCtxMenu(
  ctx: { kind: 'cell' | 'col' | 'row' },
  a: CtxBuildArgs,
): CtxMenuSection[] {
  const cut = {
    label: 'Cut',
    shortcut: 'Ctrl+X',
    onClick: () => a.handleCopy('cut'),
  };
  const copy = {
    label: 'Copy',
    shortcut: 'Ctrl+C',
    onClick: () => a.handleCopy('copy'),
  };
  const paste = {
    label: 'Paste',
    shortcut: 'Ctrl+V',
    onClick: () => void a.handlePaste(),
  };
  const pasteValuesOnly = {
    label: 'Paste values only',
    shortcut: 'Ctrl+Shift+V',
    onClick: () => a.handlePasteValuesOnly(),
  };

  if (ctx.kind === 'col') {
    return [
      { items: [cut, copy, paste, pasteValuesOnly] },
      {
        items: [
          { label: 'Insert 1 column to the left', onClick: a.handleInsertColLeft },
          { label: 'Insert 1 column to the right', onClick: a.handleInsertColRight },
          {
            label: 'Delete column',
            onClick: a.handleDeleteCol,
            disabled: !a.canDeleteCol,
          },
          { label: 'Clear column', onClick: a.clearSelection },
        ],
      },
      {
        items: [
          { label: 'Hide column', onClick: a.handleHideCols },
          ...(a.selHasHiddenCol
            ? [{ label: 'Unhide column', onClick: a.handleUnhideCols }]
            : []),
          { label: 'Resize column', disabled: true },
        ],
      },
      {
        items: [
          a.hasFilter
            ? { label: 'Remove filter', onClick: a.handleRemoveFilter }
            : { label: 'Create a filter', onClick: a.handleCreateFilter },
          {
            label: `Sort sheet A → Z by ${a.sortColLabel}`,
            onClick: () => a.handleSortSheet('asc'),
          },
          {
            label: `Sort sheet Z → A by ${a.sortColLabel}`,
            onClick: () => a.handleSortSheet('desc'),
          },
        ],
      },
      {
        items: [
          { label: 'Conditional formatting', onClick: a.openCondFmt },
          { label: 'Data validation', onClick: a.openValidation },
          { label: 'Column stats', disabled: true },
        ],
      },
    ];
  }

  if (ctx.kind === 'row') {
    return [
      { items: [cut, copy, paste, pasteValuesOnly] },
      {
        items: [
          { label: 'Insert 1 row above', onClick: a.handleInsertRowAbove },
          { label: 'Insert 1 row below', onClick: a.handleInsertRowBelow },
          {
            label: 'Delete row',
            onClick: a.handleDeleteRow,
            disabled: !a.canDeleteRow,
          },
          { label: 'Clear row', onClick: a.clearSelection },
        ],
      },
      {
        items: [
          { label: 'Hide row', onClick: a.handleHideRows },
          ...(a.selHasHiddenRow
            ? [{ label: 'Unhide row', onClick: a.handleUnhideRows }]
            : []),
          { label: 'Resize row', disabled: true },
        ],
      },
      {
        items: [
          { label: 'Conditional formatting', onClick: a.openCondFmt },
          { label: 'Data validation', onClick: a.openValidation },
        ],
      },
    ];
  }

  // cell
  return [
    { items: [cut, copy, paste, pasteValuesOnly] },
    {
      items: [
        { label: 'Insert row above', onClick: a.handleInsertRowAbove },
        { label: 'Insert column left', onClick: a.handleInsertColLeft },
      ],
    },
    {
      items: [
        {
          label: 'Delete row',
          onClick: a.handleDeleteRow,
          disabled: !a.canDeleteRow,
        },
        {
          label: 'Delete column',
          onClick: a.handleDeleteCol,
          disabled: !a.canDeleteCol,
        },
        { label: 'Clear contents', shortcut: 'Del', onClick: a.clearSelection },
      ],
    },
    {
      items: [
        { label: 'Insert image in cell', onClick: a.handleInsertImage },
        {
          label: 'Crop image',
          onClick: a.openCropForActive,
          disabled: !a.hasImage,
        },
        {
          label: 'Remove image',
          onClick: a.removeImage,
          disabled: !a.hasImage,
        },
      ],
    },
    {
      items: [
        {
          label: a.selIsRange
            ? `Sort range A → Z by ${a.sortColLabel}`
            : `Sort sheet A → Z by ${a.sortColLabel}`,
          onClick: () =>
            a.selIsRange
              ? a.handleSortRange('asc')
              : a.handleSortSheet('asc'),
        },
        {
          label: a.selIsRange
            ? `Sort range Z → A by ${a.sortColLabel}`
            : `Sort sheet Z → A by ${a.sortColLabel}`,
          onClick: () =>
            a.selIsRange
              ? a.handleSortRange('desc')
              : a.handleSortSheet('desc'),
        },
      ],
    },
    {
      items: [
        a.hasLink
          ? { label: 'Edit link', onClick: a.openLinkModal }
          : { label: 'Insert link', onClick: a.openLinkModal },
        ...(a.hasLink
          ? [{ label: 'Remove link', onClick: a.removeLink }]
          : []),
      ],
    },
    {
      items: [
        a.hasNote
          ? { label: 'Edit note', onClick: a.openNote }
          : { label: 'Insert note', onClick: a.openNote },
        ...(a.hasNote ? [{ label: 'Remove note', onClick: a.removeNote }] : []),
      ],
    },
    {
      items: [
        { label: 'Conditional formatting', onClick: a.openCondFmt },
        { label: 'Data validation', onClick: a.openValidation },
        { label: 'Comment', onClick: a.openComment },
      ],
    },
  ];
}

/**
 * Ensure every sheet has the maps the UI expects. Mongoose can return
 * `undefined` for empty embedded Object/Map props depending on how the
 * document was created, so we normalize here once on adoption.
 */
function normalizeWorkbook(wb: Workbook): Workbook {
  return {
    ...wb,
    namedRanges: wb.namedRanges ?? [],
    version: wb.version ?? 0,
    sheets: (wb.sheets ?? []).map((s, i) => ({
      ...s,
      rowCount: s.rowCount ?? 100,
      colCount: s.colCount ?? 26,
      cells: s.cells ?? {},
      colWidths: s.colWidths ?? {},
      rowHeights: s.rowHeights ?? {},
      frozen: s.frozen ?? { rows: 0, cols: 0 },
      hiddenRows: s.hiddenRows ?? [],
      hiddenCols: s.hiddenCols ?? [],
      merges: s.merges ?? [],
      gridlines: s.gridlines ?? true,
      color: s.color ?? null,
      hidden: s.hidden ?? false,
      index: s.index ?? i,
      filter: s.filter ?? null,
      condFmt: s.condFmt ?? [],
      validations: s.validations ?? [],
      charts: s.charts ?? [],
    })),
  };
}

function isCellEmpty(c: Cell): boolean {
  if (c.f) return false;
  if (c.v != null && c.v !== '') return false;
  if (c.s && Object.keys(c.s).length > 0) return false;
  if (c.img || c.link || c.note) return false;
  if (c.b1 || c.b2 || c.b3 || c.b4) return false;
  return true;
}

function defaultDp(_cell: Cell, _style: CellStyle): number {
  // Sheets/Excel UX: first increment shows one more decimal, first decrement
  // shows one fewer. Anchoring to 2 makes both directions feel responsive.
  return 2;
}

interface RangeLike {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
function rangesOverlap(a: RangeLike, b: RangeLike): boolean {
  return !(a.r2 < b.r1 || b.r2 < a.r1 || a.c2 < b.c1 || b.c2 < a.c1);
}
