'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import type { HFSection, ReportElement, ReportGroup, ReportPage, ReportTemplate } from '@/schemas/report';
import { PAGE_CANVAS_SIZES } from '@/schemas/report';
import { useReportWidgetData } from '@/hooks/use-reports';
import { useReportController } from '@/hooks/use-report-controller';
import { api } from '@/lib/api';
import { extractArrayAtPath } from '@/hooks/use-report-datasource';
import type { StoredDatasource } from './data-source-panel';
import { WidgetDataContext } from './widget-data-context';
import { ELEMENTS } from './elements-sidebar';
import { LayoutPanel } from './layout-panel';
import { PropertiesPanel } from './properties-panel';
import { CanvasContextMenu, type ContextAction } from './canvas-context-menu';
import { ElementText } from './element-text';
import { ElementHeading } from './element-heading';
import { ElementImage } from './element-image';
import { ElementShape } from './element-shape';
import { ElementDivider } from './element-divider';
import { ElementTable } from './element-table';
import { ElementGroupedTable } from './element-grouped-table';
import { ElementDataWidget } from './element-data-widget';
import { ElementChart } from './element-chart';
import { ElementProgressBar } from './element-progress-bar';
import { DEFAULT_FOOTER, DEFAULT_HEADER, DEFAULT_MARGINS, PageSetupPanel } from './page-setup-panel';
import { autoLayoutSig, computeAutoLayout, pageOverflowSig, computePageOverflow } from '@/lib/reports/auto-layout';
import { SetupGuideDrawer } from './setup-guide-drawer';
import {
  BookOpen,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  ClipboardCopy,
  ClipboardPaste,
  CopyPlus,
  Grid3x3,
  Keyboard,
  Layers,
  Lock,
  MoreHorizontal,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Plus,
  Redo2,
  RefreshCw,
  Settings2,
  Trash2,
  Ungroup,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const uid = () => Math.random().toString(36).slice(2, 9);

/**
 * Scale size-related props (fontSize, strokeWidth, padding, etc.) when a group
 * is proportionally resized. Uses the geometric mean so a 2×-wide / 1×-tall
 * scale gives ~1.41× font rather than 2× or 1×.
 */
function scaleGroupMemberProps(
  _type: string,
  props: Record<string, unknown>,
  scaleX: number,
  scaleY: number,
): Record<string, unknown> {
  const s = Math.sqrt(scaleX * scaleY); // geometric mean
  const p: Record<string, unknown> = { ...props };
  if (typeof p.fontSize    === 'number') p.fontSize    = Math.max(6,   Math.round(p.fontSize    * s));
  if (typeof p.strokeWidth === 'number') p.strokeWidth = Math.max(0.5, Math.round(p.strokeWidth * s * 10) / 10);
  if (typeof p.thickness   === 'number') p.thickness   = Math.max(0.5, Math.round(p.thickness   * s * 10) / 10);
  if (typeof p.borderWidth === 'number') p.borderWidth = Math.max(0.5, Math.round(p.borderWidth * s * 10) / 10);
  if (typeof p.borderRadius === 'number') p.borderRadius = Math.max(0, Math.round(p.borderRadius * s));
  if (typeof p.paddingX    === 'number') p.paddingX    = Math.max(0,   Math.round(p.paddingX    * scaleX));
  if (typeof p.paddingY    === 'number') p.paddingY    = Math.max(0,   Math.round(p.paddingY    * scaleY));
  return p;
}

type CtxMenu = { x: number; y: number; elementId: string | null } | null;

interface Props {
  template: ReportTemplate;
  onChange: (patch: Partial<ReportTemplate>) => void;
  /** Filled with refreshDatasources() so parents can call it before PDF preview */
  refreshDatasourcesRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  /**
   * Filled with prepareForExport(): fetches fresh datasource rows, runs
   * computeAutoLayout, then calls onChange — all before saving/previewing.
   * Resolves when the template state is fully up to date.
   */
  prepareForExportRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  /**
   * Returns the most current template state (reads localRef.current in the parent),
   * bypassing React render lag so prepareForExport never works from a stale snapshot.
   */
  getLatestTemplate?: () => ReportTemplate;
}

// ── Keyboard shortcut cheatsheet ──────────────────────────────────────────────

const SHORTCUTS = [
  { keys: ['Ctrl', '+', 'Z'],             desc: 'Undo' },
  { keys: ['Ctrl', '+', 'Shift', '+', 'Z'], desc: 'Redo' },
  { keys: ['Arrow', 'keys'],              desc: 'Nudge 1px' },
  { keys: ['Shift', '+', 'Arrow'],        desc: 'Nudge 10px' },
  { keys: ['Ctrl', '+', 'C'],            desc: 'Copy element' },
  { keys: ['Ctrl', '+', 'V'],            desc: 'Paste element' },
  { keys: ['Ctrl', '+', 'D'],            desc: 'Duplicate element' },
  { keys: ['Delete'],                    desc: 'Delete element' },
  { keys: ['Escape'],                    desc: 'Deselect / close' },
  { keys: ['Ctrl', '+', '='],            desc: 'Zoom in' },
  { keys: ['Ctrl', '+', '-'],            desc: 'Zoom out' },
  { keys: ['Ctrl', '+', '0'],            desc: 'Reset zoom' },
  { keys: ['?'],                         desc: 'Toggle this panel' },
];

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-sm animate-fade-in">
      <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-80 p-5 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-accent-600" />
            <span className="font-semibold text-sm">Keyboard Shortcuts</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover transition-colors">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <span className="text-xs text-text-sub">{s.desc}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                {s.keys.map((k, ki) => (
                  k === '+' || k === 'keys'
                    ? <span key={ki} className="text-[10px] text-text-muted">{k}</span>
                    : <kbd key={ki} className="text-[10px] font-mono px-1.5 py-0.5 bg-bg-subtle border border-border rounded shadow-sm">{k}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-text-muted mt-4 text-center">Press <kbd className="px-1 border border-border rounded">?</kbd> to toggle</p>
      </div>
    </div>
  );
}

// ── Position / size floating bar ──────────────────────────────────────────────

function PositionBar({
  el,
  onUpdate,
  canvasRef,
}: {
  el: ReportElement;
  onUpdate: (patch: Partial<ReportElement>) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const fields: { label: string; key: keyof Pick<ReportElement, 'x' | 'y' | 'w' | 'h'>; min?: number }[] = [
    { label: 'X', key: 'x' },
    { label: 'Y', key: 'y' },
    { label: 'W', key: 'w', min: 10 },
    { label: 'H', key: 'h', min: 10 },
  ];

  const returnFocus = () => canvasRef.current?.focus({ preventScroll: true });

  return (
    <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
      <div ref={barRef} className="flex items-center gap-1 bg-bg-card border border-border shadow-lg rounded-xl px-3 py-1.5">
        {fields.map((f) => (
          <label key={f.key} className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-text-muted w-4 text-center">{f.label}</span>
            <input
              type="number"
              value={Math.round(el[f.key] as number)}
              min={f.min ?? 0}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) onUpdate({ [f.key]: Math.max(f.min ?? 0, v) });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); returnFocus(); }
              }}
              onBlur={(e) => {
                // Return focus to canvas only when focus leaves the whole bar
                // (not just moving between the four inputs via Tab).
                if (!barRef.current?.contains(e.relatedTarget as Node | null)) returnFocus();
              }}
              className="w-14 text-[11px] font-mono text-center bg-bg-subtle border border-border rounded-md px-1 py-0.5 focus:outline-none focus:border-accent-400 transition-colors"
            />
          </label>
        ))}
        <span className="text-[10px] text-text-muted ml-1">px</span>
        <span className="hidden sm:block text-[9px] text-text-muted ml-2 pl-2 border-l border-border opacity-60 whitespace-nowrap">
          Enter · Esc
        </span>
      </div>
    </div>
  );
}

// ── Selection toolbar ─────────────────────────────────────────────────────────

type AlignDir = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';
type LayerDir = 'front' | 'forward' | 'backward' | 'back';

interface STBProps {
  selected:      ReportElement;
  groups:        ReportGroup[];
  pinned:        boolean;
  onTogglePin:   () => void;
  onAlign:       (dir: AlignDir) => void;
  onLayer:       (dir: LayerDir) => void;
  onToggleLock:  () => void;
  onDuplicate:   () => void;
  onDelete:      () => void;
  onMoveToGroup: (groupId: string | null) => void;
  onCreateGroup: () => void;
  onDuplicateGroup: () => void;
  onUngroup: () => void;
}

function ToolbarSep() {
  return <div className="w-px h-5 bg-border mx-1 flex-shrink-0" />;
}

/** Empty toolbar strip shown when pinned but no element is selected */
function SelectionToolbarEmpty({ onTogglePin }: { onTogglePin: () => void }) {
  return (
    <div className="bg-bg-card border-b border-border flex items-center px-3 h-9 flex-shrink-0 gap-2 animate-fade-in">
      <MousePointer2 className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
      <span className="text-[11px] text-text-muted italic">
        Select an element to see actions
      </span>
      <div className="ml-auto">
        <button
          onClick={onTogglePin}
          title="Unpin toolbar"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-accent-600 bg-accent-100 hover:bg-accent-200 dark:bg-accent-900/30 dark:hover:bg-accent-900/50 transition-colors"
        >
          <PinOff className="w-3.5 h-3.5" />
          Unpin
        </button>
      </div>
    </div>
  );
}

// ── Multi-select toolbar ──────────────────────────────────────────────────────

interface MSToolbarProps {
  count:              number;
  onGroupSelected:    () => void;
  onAlignSelected:    (dir: AlignDir) => void;
  onDeleteSelected:   () => void;
  onDuplicateSelected:() => void;
  onClear:            () => void;
}

function MultiSelectToolbar({
  count,
  onGroupSelected,
  onAlignSelected,
  onDeleteSelected,
  onDuplicateSelected,
  onClear,
}: MSToolbarProps) {
  const ALIGN_BTNS: { icon: React.ReactNode; title: string; dir: AlignDir }[] = [
    { icon: <AlignStartHorizontal  className="w-3.5 h-3.5" />, title: 'Align left',         dir: 'left'    },
    { icon: <AlignCenterHorizontal className="w-3.5 h-3.5" />, title: 'Center horizontally', dir: 'centerH' },
    { icon: <AlignEndHorizontal    className="w-3.5 h-3.5" />, title: 'Align right',         dir: 'right'   },
    { icon: <AlignStartVertical    className="w-3.5 h-3.5" />, title: 'Align top',           dir: 'top'     },
    { icon: <AlignCenterVertical   className="w-3.5 h-3.5" />, title: 'Center vertically',   dir: 'centerV' },
    { icon: <AlignEndVertical      className="w-3.5 h-3.5" />, title: 'Align bottom',        dir: 'bottom'  },
  ];

  return (
    <div
      className="sticky top-0 z-40 bg-accent-50 dark:bg-accent-950/20 border-b border-accent-200 dark:border-accent-800 flex items-center gap-0.5 px-3 h-9 flex-shrink-0 overflow-x-auto animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Count badge */}
      <div className="flex items-center gap-1.5 pr-3 mr-1 border-r border-accent-200 dark:border-accent-700 flex-shrink-0">
        <span className="text-[11px] font-semibold text-accent-700 dark:text-accent-300 bg-accent-100 dark:bg-accent-900/40 px-2 py-0.5 rounded-full">
          {count} selected
        </span>
      </div>

      {/* Group selected */}
      <button
        onClick={onGroupSelected}
        title="Group selected elements (Ctrl+G)"
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-text-muted hover:text-text hover:bg-bg-hover transition-colors flex-shrink-0"
      >
        <Layers className="w-3.5 h-3.5" />
        Group
      </button>

      <ToolbarSep />

      {/* Align buttons */}
      {ALIGN_BTNS.map(({ icon, title, dir }) => (
        <button
          key={dir}
          onClick={() => onAlignSelected(dir)}
          title={title}
          className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-accent-600 flex-shrink-0"
        >
          {icon}
        </button>
      ))}

      <ToolbarSep />

      {/* Duplicate all */}
      <button
        onClick={onDuplicateSelected}
        title="Duplicate all selected (Ctrl+D)"
        className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text flex-shrink-0"
      >
        <CopyPlus className="w-3.5 h-3.5" />
      </button>

      {/* Delete all */}
      <button
        onClick={onDeleteSelected}
        title="Delete all selected (Del)"
        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors text-text-muted hover:text-red-500 flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {/* Clear selection */}
      <div className="ml-auto flex-shrink-0 pl-2 border-l border-accent-200 dark:border-accent-700">
        <button
          onClick={onClear}
          title="Deselect all (Escape)"
          className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function SelectionToolbar({
  selected,
  groups,
  pinned,
  onTogglePin,
  onAlign,
  onLayer,
  onToggleLock,
  onDuplicate,
  onDelete,
  onMoveToGroup,
  onCreateGroup,
  onDuplicateGroup,
  onUngroup,
}: STBProps) {
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  // Close group dropdown on outside click
  useEffect(() => {
    if (!groupOpen) return;
    const handler = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setGroupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [groupOpen]);

  const isLocked     = !!selected.props?.locked;
  const currentGroup = groups.find((g) => g.id === selected.groupId);
  const elDef        = ELEMENTS.find((d) => d.type === selected.type);

  const ALIGN_BTNS: { icon: React.ReactNode; title: string; dir: AlignDir }[] = [
    { icon: <AlignStartHorizontal  className="w-3.5 h-3.5" />, title: 'Align left',         dir: 'left'    },
    { icon: <AlignCenterHorizontal className="w-3.5 h-3.5" />, title: 'Center horizontally', dir: 'centerH' },
    { icon: <AlignEndHorizontal    className="w-3.5 h-3.5" />, title: 'Align right',         dir: 'right'   },
    { icon: <AlignStartVertical    className="w-3.5 h-3.5" />, title: 'Align top',           dir: 'top'     },
    { icon: <AlignCenterVertical   className="w-3.5 h-3.5" />, title: 'Center vertically',   dir: 'centerV' },
    { icon: <AlignEndVertical      className="w-3.5 h-3.5" />, title: 'Align bottom',        dir: 'bottom'  },
  ];

  return (
    <div
      className="sticky top-0 z-40 bg-bg-card border-b border-border flex items-center gap-0.5 px-3 h-9 flex-shrink-0 overflow-x-auto animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* ── Element type badge ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 pr-3 mr-1 border-r border-border flex-shrink-0 min-w-0">
        <span className="text-accent-600 flex-shrink-0">{elDef?.icon}</span>
        <span className="text-[11px] font-semibold text-text-sub capitalize truncate max-w-[80px]">
          {(selected.props as Record<string, unknown>)?._name as string ?? elDef?.label ?? selected.type}
        </span>
      </div>

      {/* ── Group dropdown ──────────────────────────────────────────────── */}
      <div className="relative flex-shrink-0" ref={groupRef}>
        <button
          onClick={() => setGroupOpen((v) => !v)}
          title="Group options"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors',
            currentGroup
              ? 'text-accent-700 bg-accent-100 dark:bg-accent-900/30 dark:text-accent-400'
              : 'text-text-muted hover:text-text hover:bg-bg-hover',
          )}
        >
          <Layers className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="max-w-[60px] truncate">{currentGroup?.name ?? 'Group'}</span>
          <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', groupOpen && 'rotate-180')} />
        </button>

        {groupOpen && (
          <div className="absolute top-full left-0 mt-1 w-52 bg-bg-card border border-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
            {/* Current group info + group actions */}
            {currentGroup && (
              <>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-accent-500 flex-shrink-0" />
                  <span className="text-[11px] font-semibold text-text truncate">{currentGroup.name}</span>
                  <span className="ml-auto text-[10px] text-accent-600 bg-accent-100 px-1.5 rounded-full">active</span>
                </div>
                <button
                  onClick={() => { onDuplicateGroup(); setGroupOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-sub hover:bg-bg-hover transition-colors"
                >
                  <CopyPlus className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
                  Duplicate group
                </button>
                <button
                  onClick={() => { onUngroup(); setGroupOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-sub hover:bg-bg-hover transition-colors"
                >
                  <Ungroup className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
                  Ungroup
                </button>
                <button
                  onClick={() => { onMoveToGroup(null); setGroupOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                >
                  <X className="w-3.5 h-3.5 flex-shrink-0" />
                  Remove from group
                </button>
                <div className="h-px bg-border my-1 mx-2" />
              </>
            )}

            {/* Move to another group */}
            {groups.filter((g) => g.id !== selected.groupId).length > 0 && (
              <>
                <p className="px-3 pb-0.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                  Move to group
                </p>
                {groups
                  .filter((g) => g.id !== selected.groupId)
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() => { onMoveToGroup(g.id); setGroupOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-sub hover:bg-bg-hover transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5 text-accent-400 flex-shrink-0" />
                      <span className="truncate">{g.name}</span>
                    </button>
                  ))}
                <div className="h-px bg-border my-1 mx-2" />
              </>
            )}

            {/* Create new group */}
            <button
              onClick={() => { onCreateGroup(); setGroupOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              New group
            </button>
          </div>
        )}
      </div>

      <ToolbarSep />

      {/* ── Align buttons ────────────────────────────────────────────────── */}
      {ALIGN_BTNS.map(({ icon, title, dir }) => (
        <button
          key={dir}
          onClick={() => onAlign(dir)}
          title={title}
          disabled={isLocked}
          className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-accent-600 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {icon}
        </button>
      ))}

      <ToolbarSep />

      {/* ── Layer order ──────────────────────────────────────────────────── */}
      <button
        onClick={() => onLayer('front')}
        title="Bring to front"
        disabled={isLocked}
        className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text disabled:opacity-30"
      >
        <ChevronsUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onLayer('forward')}
        title="Bring forward"
        disabled={isLocked}
        className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text disabled:opacity-30"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onLayer('backward')}
        title="Send backward"
        disabled={isLocked}
        className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text disabled:opacity-30"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onLayer('back')}
        title="Send to back"
        disabled={isLocked}
        className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text disabled:opacity-30"
      >
        <ChevronsDown className="w-3.5 h-3.5" />
      </button>

      <ToolbarSep />

      {/* ── Lock / unlock ────────────────────────────────────────────────── */}
      <button
        onClick={onToggleLock}
        title={isLocked ? 'Unlock element' : 'Lock element'}
        className={cn(
          'p-1.5 rounded transition-colors',
          isLocked
            ? 'text-amber-500 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20'
            : 'text-text-muted hover:text-text hover:bg-bg-hover',
        )}
      >
        {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
      </button>

      {/* ── Duplicate ────────────────────────────────────────────────────── */}
      <button
        onClick={onDuplicate}
        title="Duplicate (Ctrl+D)"
        className="p-1.5 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text"
      >
        <CopyPlus className="w-3.5 h-3.5" />
      </button>

      {/* ── Delete ───────────────────────────────────────────────────────── */}
      <button
        onClick={onDelete}
        title="Delete (Del)"
        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors text-text-muted hover:text-red-500"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {/* ── Pin toolbar ──────────────────────────────────────────────────── */}
      <div className="ml-auto flex-shrink-0 pl-2 border-l border-border">
        <button
          onClick={onTogglePin}
          title={pinned ? 'Unpin toolbar (hides when no element selected)' : 'Pin toolbar (stays visible)'}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors',
            pinned
              ? 'text-accent-700 bg-accent-100 hover:bg-accent-200 dark:bg-accent-900/30 dark:hover:bg-accent-900/50 dark:text-accent-400'
              : 'text-text-muted hover:text-text hover:bg-bg-hover',
          )}
        >
          {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
          <span>{pinned ? 'Pinned' : 'Pin'}</span>
        </button>
      </div>
    </div>
  );
}

// ── Page tabs bar ─────────────────────────────────────────────────────────────

function PageTabs({
  pages,
  currentPage,
  templateBackground,
  onSelect,
  onAdd,
  onDelete,
  onDuplicate,
  onMoveLeft,
  onMoveRight,
}: {
  pages: ReportPage[];
  currentPage: number;
  templateBackground: string;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onDelete: (i: number) => void;
  onDuplicate: (i: number) => void;
  onMoveLeft: (i: number) => void;
  onMoveRight: (i: number) => void;
}) {
  const [ctxIdx, setCtxIdx] = useState<number | null>(null);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });

  const openCtx = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxIdx(i);
    setCtxPos({ x: e.clientX, y: e.clientY - 12 });
  };

  return (
    <div className="flex-1 h-10 flex items-center px-3 gap-1.5 overflow-x-auto min-w-0">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex-shrink-0 pr-2 border-r border-border mr-1">
        Pages
      </span>
      {pages.map((page, i) => {
        const isAutoPage = !!(page as ReportPage & { sourceTableId?: string }).sourceTableId;
        return (
          <div
            key={page.id}
            onClick={() => onSelect(i)}
            onContextMenu={(e) => openCtx(e, i)}
            className={cn(
              'relative flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-all select-none group flex-shrink-0',
              i === currentPage
                ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                : 'border-border hover:border-accent-300 hover:bg-bg-hover text-text-sub',
            )}
          >
            <div
              className="w-3.5 h-3.5 rounded-sm border border-black/10 flex-shrink-0"
              style={{ background: page.background ?? templateBackground }}
            />
            <span>{isAutoPage ? `↩ ${i + 1}` : `Page ${i + 1}`}</span>
            <button
              onClick={(e) => openCtx(e, i)}
              className={cn(
                'p-0.5 rounded transition-all hover:bg-accent-100 dark:hover:bg-accent-900/30',
                'opacity-0 group-hover:opacity-100',
                i === currentPage && 'opacity-60 hover:opacity-100',
              )}
            >
              <MoreHorizontal className="w-3 h-3" />
            </button>
          </div>
        );
      })}

      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text border border-dashed border-border hover:border-accent-400 hover:bg-bg-hover rounded-lg transition-all flex-shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
        Add page
      </button>

      {ctxIdx !== null && (() => {
        const isAutoCtxPage = !!(pages[ctxIdx] as ReportPage & { sourceTableId?: string })?.sourceTableId;
        return (
          <CanvasContextMenu
            x={ctxPos.x}
            y={ctxPos.y}
            onClose={() => setCtxIdx(null)}
            actions={[
              {
                id: 'dup',
                label: 'Duplicate page',
                icon: <CopyPlus />,
                disabled: isAutoCtxPage,
                onClick: () => { onDuplicate(ctxIdx!); setCtxIdx(null); },
              },
              {
                id: 'ml',
                label: 'Move left',
                icon: <ChevronLeft />,
                disabled: ctxIdx === 0 || isAutoCtxPage,
                separator: true,
                onClick: () => { onMoveLeft(ctxIdx!); setCtxIdx(null); },
              },
              {
                id: 'mr',
                label: 'Move right',
                icon: <ChevronRight />,
                disabled: ctxIdx === pages.length - 1 || isAutoCtxPage,
                onClick: () => { onMoveRight(ctxIdx!); setCtxIdx(null); },
              },
              {
                id: 'del',
                label: isAutoCtxPage ? 'Turn off auto-pagination' : 'Delete page',
                icon: <Trash2 />,
                danger: true,
                disabled: pages.length <= 1 && !isAutoCtxPage,
                separator: true,
                onClick: () => { onDelete(ctxIdx!); setCtxIdx(null); },
              },
            ]}
          />
        );
      })()}
    </div>
  );
}

// ── Header / Footer section renderer ─────────────────────────────────────────

function resolvePageNumberText(section: HFSection, pgIdx: number, totalPages: number): string {
  if (section.pageNumberTemplate) {
    return section.pageNumberTemplate
      .replace(/\{n\}/g, String(pgIdx + 1))
      .replace(/\{total\}/g, String(totalPages));
  }
  const fmt = section.pageNumberFormat ?? 'x-of-y';
  return fmt === 'page-x' ? `Page ${pgIdx + 1}`
    : fmt === 'x-of-y'   ? `${pgIdx + 1} / ${totalPages}`
    : String(pgIdx + 1);
}

function renderHFSection(
  section: HFSection | undefined,
  pgIdx: number,
  totalPages: number,
): React.ReactNode {
  if (!section || section.type === 'empty') return null;

  const textStyle: React.CSSProperties = {
    fontSize:        section.fontSize ?? 12,
    fontWeight:      section.bold      ? 700 : 400,
    fontStyle:       section.italic    ? 'italic' : 'normal',
    textDecoration:  section.underline ? 'underline' : 'none',
    color:           section.color ?? '#111111',
    whiteSpace:      'nowrap',
    overflow:        'hidden',
    textOverflow:    'ellipsis',
  };

  if (section.type === 'text') {
    return <span style={textStyle}>{section.text ?? ''}</span>;
  }

  if (section.type === 'image' && section.imageUrl) {
    return (
      <img
        src={section.imageUrl}
        alt=""
        style={{
          height:    section.imageHeight ?? 32,
          maxWidth:  '100%',
          objectFit: (section.imageFit ?? 'contain') as React.CSSProperties['objectFit'],
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  if (section.type === 'page-number') {
    return <span style={textStyle}>{resolvePageNumberText(section, pgIdx, totalPages)}</span>;
  }

  if (section.type === 'date') {
    const fmt = section.dateFormat ?? 'full';
    const now = new Date();
    const text =
      fmt === 'full'         ? now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : fmt === 'short'      ? now.toLocaleDateString()
      : fmt === 'month-year' ? now.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
      : now.getFullYear().toString();
    return <span style={textStyle}>{text}</span>;
  }

  return null;
}

// Helpers to decide whether to use the new section layout or the legacy flat fields.
// Sections mode is active when at least one column has an explicit section object set.
function headerUsesSections(h: { left?: HFSection; center?: HFSection; right?: HFSection }): boolean {
  return !!(h.left || h.center || h.right);
}

// Returns true when the header/footer should be rendered on the given page index.
function shouldShowHF(hf: { showOn?: string; skipPages?: number[] }, pgIdx: number): boolean {
  if (hf.showOn === 'except-first') return pgIdx > 0;
  if (hf.showOn === 'custom')       return !(hf.skipPages ?? []).includes(pgIdx);
  return true; // 'all' or undefined
}

// ── Main editor ───────────────────────────────────────────────────────────────

export function CanvasEditor({ template, onChange, refreshDatasourcesRef, prepareForExportRef, getLatestTemplate }: Props) {
  const [currentPage, setCurrentPage] = useState(0);
  const [leftTab, setLeftTab]   = useState<'add' | 'layout' | 'page'>('add');
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [rightWide, setRightWide] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('rpt:rightWide') === '1',
  );
  const toggleRightWide = () => setRightWide((v) => {
    const next = !v;
    try { localStorage.setItem('rpt:rightWide', next ? '1' : '0'); } catch { /* quota */ }
    return next;
  });
  const [showGuide, setShowGuide] = useState(false);
  const [ctxMenu, setCtxMenu]   = useState<CtxMenu>(null);
  const [canvasFocused, setCanvasFocused] = useState(false);

  // Persist pin state across sessions
  const [toolbarPinned, setToolbarPinnedRaw] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('rpt:pinned') === '1',
  );
  const setToolbarPinned = (updater: boolean | ((prev: boolean) => boolean)) => {
    setToolbarPinnedRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { localStorage.setItem('rpt:pinned', next ? '1' : '0'); } catch { /* quota */ }
      return next;
    });
  };

  const targetRef        = useRef<Map<string, HTMLElement>>(new Map());
  // Used to reclaim keyboard focus after clicking a canvas element so arrow
  // keys nudge elements instead of scrolling or changing a properties-panel input.
  const canvasWrapRef    = useRef<HTMLDivElement>(null);

  // Tracks group-drag state: initial positions of all group members at the
  // moment a drag begins, so we can move them in lockstep with the selection.
  type GroupDragState = {
    originX: number;
    originY: number;
    members: Array<{ id: string; x: number; y: number }>;
  };
  const groupDragRef = useRef<GroupDragState | null>(null);

  // Tracks group-resize state: captures the group bounding box + each member's
  // normalized position at resize-start so all members scale proportionally.
  type GroupResizeState = {
    gOrigX: number; gOrigY: number; gOrigW: number; gOrigH: number;
    selW: number; selH: number;       // selected element original size
    selRelX: number; selRelY: number; // selected element origin within group (0–1)
    members: Array<{ id: string; x: number; y: number; w: number; h: number; rotation: number }>;
  };
  const groupResizeRef = useRef<GroupResizeState | null>(null);
  const pageOverflowSigRef = useRef('');
  const templateRef        = useRef(template);
  templateRef.current = template;

  // ── Marquee (lasso) selection ────────────────────────────────────────────
  const pageCanvasRefs    = useRef<Map<number, HTMLDivElement>>(new Map());
  const marqueeDraggedRef = useRef(false);
  const marqueeRef        = useRef<{
    startX: number; startY: number;
    curX: number;   curY: number;
    pageIdx: number; dragging: boolean;
  } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number; top: number; width: number; height: number;
  } | null>(null);

  const { data: liveWidgetData } = useReportWidgetData();

  // Derived canvas dimensions
  const ps      = PAGE_CANVAS_SIZES[template.pageSize] ?? PAGE_CANVAS_SIZES.A4;
  const canvasW = template.orientation === 'landscape' ? ps.h : ps.w;
  const canvasH = template.orientation === 'landscape' ? ps.w : ps.h;

  // ── Controller hook ──────────────────────────────────────────────────────
  const ctrl = useReportController({ template, onChange, canvasW, canvasH, currentPage });
  // Always-current scale — read by the stable marquee window listener.
  const scaleRef = useRef(ctrl.scale);
  scaleRef.current = ctrl.scale;

  // Keep a stable ref to setScale and canvasW so fitToWidth doesn't need them in deps.
  const setScaleRef = useRef(ctrl.setScale);
  setScaleRef.current = ctrl.setScale;
  const canvasWRef = useRef(canvasW);
  canvasWRef.current = canvasW;

  // Fit the canvas to the available container width (leaves 80px margin for padding).
  // Called on mount so the initial view matches PDF proportions, and exposed via a button.
  const fitToWidth = useCallback(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const available = el.clientWidth - 80;
    if (available <= 0) return;
    setScaleRef.current(Math.max(0.25, Math.min(1, available / canvasWRef.current)));
  }, []);

  // Canvas starts at 100% (1:1 with the PDF) so what you design matches the preview.
  // Users can press "Fit" to zoom out if the page is wider than their screen.

  // ── Reclaim focus after selection ────────────────────────────────────────
  // Moveable mounts drag/resize handles (some with tabIndex) after an element
  // is selected, which can steal keyboard focus away from canvasWrapRef and
  // silently break arrow-key nudging. A RAF reclaim ensures focus stays on the
  // canvas wrapper after each selection change.
  useEffect(() => {
    if (!ctrl.selectedId) return;
    const raf = requestAnimationFrame(() => {
      canvasWrapRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [ctrl.selectedId]);

  // ── Auto-layout: re-run whenever table rows/height/margins change ────────
  useEffect(() => {
    const mt  = template.margins?.top    ?? 0;
    const mb  = template.margins?.bottom ?? 0;
    const sig = autoLayoutSig(template.elements ?? [], canvasH, mt, mb);
    if (!sig || sig === ctrl.autoLayoutSigRef.current) return;
    ctrl.autoLayoutSigRef.current = sig;
    const result = computeAutoLayout(template, ctrl.actualFitHintsRef.current);
    if (result) onChange({ pages: result.pages, elements: result.elements });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.elements, template.pageSize, template.orientation, template.margins]);

  // ── Page-overflow: push elements that fall below the page bottom ─────────
  useEffect(() => {
    const sig = pageOverflowSig(template.elements ?? [], template);
    if (sig === pageOverflowSigRef.current) return;
    pageOverflowSigRef.current = sig;
    if (!sig) return;
    const result = computePageOverflow(template);
    if (result) onChange({ pages: result.pages, elements: result.elements });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.elements, template.pageSize, template.orientation]);

  // ── Orphan-page cleanup ───────────────────────────────────────────────────
  // Removes system-generated empty pages:
  //   • of-pg-* — old page-overflow pages whose element was later re-claimed
  //               by auto-layout (autoMovedFromTableId tracking)
  //   • al-*    — auto-layout continuation/separator pages with no elements
  //               (can appear when table config changes between mounts)
  //   • pages with sourceTableId and no elements (same category, any id)
  // Uses a sig so it fires exactly once per distinct orphan set.
  const orphanCleanupSigRef = useRef('');
  useEffect(() => {
    const pages = template.pages ?? [];
    if (pages.length <= 1) return;
    const elementPages = new Set((template.elements ?? []).map((el) => el.page ?? 0));
    const orphanIdxs = pages
      .map((pg, i) => {
        if (i === 0) return -1; // never remove the first page
        if (elementPages.has(i)) return -1; // page has elements, keep it
        const id = typeof pg.id === 'string' ? pg.id : '';
        const pge = pg as ReportPage & { sourceTableId?: string };
        const isSystem = id.startsWith('of-pg-') || id.startsWith('al-') || !!pge.sourceTableId;
        return isSystem ? i : -1;
      })
      .filter((i) => i >= 0);
    const sig = orphanIdxs.join(',');
    if (!sig || sig === orphanCleanupSigRef.current) return;
    orphanCleanupSigRef.current = sig;
    const keepIdxs = pages.map((_, i) => i).filter((i) => !orphanIdxs.includes(i));
    const oldToNew = new Map(keepIdxs.map((oldI, newI) => [oldI, newI]));
    onChange({
      pages:    pages.filter((_, i) => !orphanIdxs.includes(i)),
      elements: (template.elements ?? []).map((el) => ({
        ...el,
        page: oldToNew.get(el.page ?? 0) ?? (el.page ?? 0),
      })),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.pages, template.elements]);

  // ── Marquee window listeners (registered once — reads state via refs) ────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const m = marqueeRef.current;
      if (!m) return;
      m.curX = e.clientX;
      m.curY = e.clientY;
      const dx = m.curX - m.startX;
      const dy = m.curY - m.startY;
      if (!m.dragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) m.dragging = true;
      if (m.dragging) {
        setMarqueeBox({
          left:   Math.min(m.startX, m.curX),
          top:    Math.min(m.startY, m.curY),
          width:  Math.abs(dx),
          height: Math.abs(dy),
        });
      }
    };

    const onUp = () => {
      const m = marqueeRef.current;
      marqueeRef.current = null;
      setMarqueeBox(null);
      if (!m?.dragging) return;

      // Re-measure page canvas rect at release time (scroll may have moved it).
      const pageEl = pageCanvasRefs.current.get(m.pageIdx);
      if (!pageEl) return;
      const pr = pageEl.getBoundingClientRect();
      const s  = scaleRef.current;
      const marL = Math.min(m.startX, m.curX);
      const marT = Math.min(m.startY, m.curY);
      const marR = Math.max(m.startX, m.curX);
      const marB = Math.max(m.startY, m.curY);

      const hit = (templateRef.current.elements ?? [])
        .filter((el) => {
          if ((el.page ?? 0) !== m.pageIdx) return false;
          if ((el.props as Record<string, unknown>)?.autoGenerated) return false;
          const elL = pr.left + el.x * s;
          const elT = pr.top  + el.y * s;
          return elL < marR && (elL + el.w * s) > marL && elT < marB && (elT + el.h * s) > marT;
        })
        .map((el) => el.id);

      if (hit.length > 0) {
        marqueeDraggedRef.current = true;
        ctrl.setSelectedIds(hit);
        setCurrentPage(m.pageIdx);
        canvasWrapRef.current?.focus({ preventScroll: true });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — all mutable values read via refs

  // ── Derived ──────────────────────────────────────────────────────────────

  const pages: ReportPage[] = template.pages?.length ? template.pages : [{ id: 'page-0' }];
  const clampPage = (idx: number) => Math.min(idx, pages.length - 1);
  const allElements = template.elements ?? [];
  const elements    = allElements.filter((e) => (e.page ?? 0) === currentPage);
  const selected    = elements.find((e) => e.id === ctrl.selectedId) ?? null;

  // Clamp currentPage whenever pages shrink (e.g. auto-layout or page-overflow
  // removes pages after a save/refresh).
  useEffect(() => {
    if (currentPage >= pages.length) {
      setCurrentPage(Math.max(0, pages.length - 1));
    }
  }, [pages.length, currentPage]);

  // ── autoHeight: resize table + push/pull elements below ─────────────────
  // For autoHeight tables, also shifts every element on the same page that
  // sits below the table bottom by the same delta, preserving the gap.
  // For auto-paginated (autoPageBreak) tables, just update el.h as before.
  const handleAutoHeightChange = useCallback((id: string, newH: number) => {
    const el = (template.elements ?? []).find((e) => e.id === id);
    if (!el) return;
    const p = el.props as Record<string, unknown>;

    if (!p.autoHeight) {
      // For any auto-layout table (source OR continuation): also reposition
      // auto-moved elements on the same page using the actual DOM-measured height.
      // The formula in computeAutoLayout can't account for text wrapping or the
      // URL badge being hidden in PDF output, so the stored Y of moved elements
      // may not match the real table bottom.
      const isCont   = !!(p.isContinuation);
      const sourceId = isCont ? (p.sourceTableId as string) : id;
      const elPage   = el.page ?? 0;
      const movedEls = (template.elements ?? []).filter((e) => {
        const ep = e.props as Record<string, unknown>;
        return ep.autoMovedFromTableId === sourceId && (e.page ?? 0) === elPage;
      });
      if (movedEls.length > 0) {
        const sorted = [...movedEls].sort((a, b) => {
          const ay = ((a.props as Record<string, unknown>).autoMovedOriginalY as number) ?? a.y;
          const by = ((b.props as Record<string, unknown>).autoMovedOriginalY as number) ?? b.y;
          return ay - by;
        });
        const firstOrigY = ((sorted[0].props as Record<string, unknown>).autoMovedOriginalY as number) ?? sorted[0].y;
        const tableBottom = el.y + newH;
        ctrl.updateElementBatch([
          { id, patch: { h: newH } },
          ...sorted.map((e) => {
            const origY = ((e.props as Record<string, unknown>).autoMovedOriginalY as number) ?? e.y;
            return { id: e.id, patch: { y: tableBottom + 8 + Math.max(0, origY - firstOrigY) } };
          }),
        ]);
        return;
      }
      // No moved elements — just resize
      ctrl.updateElement(id, { h: newH });
      return;
    }

    const oldH  = el.h;
    const delta = Math.round(newH - oldH);
    if (Math.abs(delta) < 1) return;

    const page      = el.page ?? 0;
    const oldBottom = el.y + oldH;

    const below = (template.elements ?? []).filter((e) =>
      e.id !== id &&
      (e.page ?? 0) === page &&
      e.y >= oldBottom - 1,   // 1px tolerance for float imprecision
    );

    if (below.length === 0) {
      ctrl.updateElement(id, { h: newH });
    } else {
      ctrl.updateElementBatch([
        { id, patch: { h: newH } },
        ...below.map((e) => ({ id: e.id, patch: { y: Math.max(0, e.y + delta) } })),
      ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.elements, ctrl.updateElement, ctrl.updateElementBatch]);

  // ── URL datasource refresh ────────────────────────────────────────────────
  // Fetches live data from every table element that has a dataSource URL.

  const [refreshing, setRefreshing] = useState(false);

  // Internal helper: fetch fresh rows and return updated elements array.
  // Does NOT call onChange — callers decide what to do with the result.
  const fetchFreshElements = useCallback(async (elements: ReportElement[]): Promise<ReportElement[]> => {
    const sourceTables = elements.filter((el) => {
      if (el.type !== 'table') return false;
      const p = el.props as Record<string, unknown>;
      if (p.autoGenerated || p.isContinuation) return false;
      return !!(p.dataSource as StoredDatasource | undefined)?.url;
    });

    // grouped-table elements with a dataUrl
    const groupedTables = elements.filter((el) => {
      if (el.type !== 'grouped-table') return false;
      return !!(el.props as Record<string, unknown>).dataUrl;
    });

    if (sourceTables.length === 0 && groupedTables.length === 0) return elements;

    const results = await Promise.all(
      sourceTables.map(async (el) => {
        const p  = el.props as Record<string, unknown>;
        const ds = p.dataSource as StoredDatasource;
        try {
          const { data: result } = await api.post<{ data: unknown }>('/reports/fetch-datasource', {
            url: ds.url, method: ds.method ?? 'GET', headers: ds.headers ?? {},
          });
          const rawRows = extractArrayAtPath(result.data, ds.dataPath ?? '');
          const rows = rawRows.slice(0, 500).map((row) => {
            const mapped: Record<string, string> = {};
            (ds.columnDefs ?? []).forEach(({ key, label, prefix, suffix }) => {
              const v = (row as Record<string, unknown>)[key];
              const raw = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
              mapped[label] = `${prefix ?? ''}${raw}${suffix ?? ''}`;
            });
            return mapped;
          });
          return { id: el.id, rows };
        } catch {
          return null;
        }
      }),
    );

    const updates = results.filter(Boolean) as { id: string; rows: Record<string, string>[] }[];

    // Fetch grouped-table raw data
    const groupedResults = await Promise.all(
      groupedTables.map(async (el) => {
        const gp = el.props as Record<string, unknown>;
        try {
          let headers: Record<string, string> = {};
          if (gp.dataHeaders) {
            try { headers = JSON.parse(gp.dataHeaders as string); } catch { /* ignore */ }
          }
          const { data: result } = await api.post<{ data: unknown }>('/reports/fetch-datasource', {
            url: gp.dataUrl, method: gp.dataMethod ?? 'GET', headers,
          });
          const rawData = extractArrayAtPath(result.data, (gp.dataPath as string) ?? '');
          return { id: el.id, rawData };
        } catch {
          return null;
        }
      }),
    );
    const groupedUpdates = groupedResults.filter(Boolean) as { id: string; rawData: Record<string, unknown>[] }[];

    if (updates.length === 0 && groupedUpdates.length === 0) return elements;

    const freshMap        = new Map(updates.map((u) => [u.id, u.rows]));
    const groupedFreshMap = new Map(groupedUpdates.map((u) => [u.id, u.rawData]));

    return elements.map((el) => {
      const p = el.props as Record<string, unknown>;
      if (freshMap.has(el.id)) return { ...el, props: { ...p, rows: freshMap.get(el.id) } };
      const srcId = p.sourceTableId as string | undefined;
      if (p.autoGenerated && srcId && freshMap.has(srcId)) {
        return { ...el, props: { ...p, rows: freshMap.get(srcId) } };
      }
      if (groupedFreshMap.has(el.id)) return { ...el, props: { ...p, rawData: groupedFreshMap.get(el.id) } };
      return el;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Simple refresh: fetch → onChange (used by the toolbar button and auto-refresh on mount)
  const refreshDatasources = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchFreshElements(allElements);
      if (next !== allElements) onChange({ elements: next });
    } finally {
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allElements, fetchFreshElements, onChange]);

  // Full prepare: fetch fresh rows + run computeAutoLayout → single onChange.
  // Used by Preview and Run so the saved template always has current data + correct layout.
  // Uses getLatestTemplate() (reads localRef.current in the parent) so it always starts
  // from the most current state, not a potentially-stale React render snapshot.
  const prepareForExport = useCallback(async () => {
    setRefreshing(true);
    try {
      // Always read the absolute latest template — localRef.current in the parent
      // is updated synchronously inside setLocal(), bypassing React render lag.
      const currentTemplate = getLatestTemplate ? getLatestTemplate() : templateRef.current;
      const nextElements    = await fetchFreshElements(currentTemplate.elements ?? []);
      const freshTemplate   = { ...currentTemplate, elements: nextElements };
      const layoutResult    = computeAutoLayout(freshTemplate, ctrl.actualFitHintsRef.current);
      if (layoutResult) {
        onChange({ elements: layoutResult.elements, pages: layoutResult.pages });
      } else if (nextElements !== (currentTemplate.elements ?? [])) {
        onChange({ elements: nextElements });
      }
    } finally {
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFreshElements, getLatestTemplate, onChange, ctrl.actualFitHintsRef]);

  // Expose both functions to parent via refs
  useEffect(() => {
    if (refreshDatasourcesRef) refreshDatasourcesRef.current = refreshDatasources;
  }, [refreshDatasources, refreshDatasourcesRef]);
  useEffect(() => {
    if (prepareForExportRef) prepareForExportRef.current = prepareForExport;
  }, [prepareForExport, prepareForExportRef]);

  // Auto-refresh once on mount so the table always shows current API data.
  const didAutoRefreshRef = useRef(false);
  useEffect(() => {
    if (didAutoRefreshRef.current) return;
    didAutoRefreshRef.current = true;
    refreshDatasources();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Page management ──────────────────────────────────────────────────────

  const addPage = () => {
    const newPage: ReportPage = { id: uid() };
    const newPages = [...pages, newPage];
    ctrl.onChangeTracked({ pages: newPages });
    setCurrentPage(newPages.length - 1);
    ctrl.setSelectedId(null);
  };

  const deletePage = useCallback((idx: number) => {
    if (pages.length <= 1) return;
    const pg = pages[idx] as (ReportPage & { sourceTableId?: string }) | undefined;
    if (!pg) return;
    if (pg.sourceTableId) {
      const tableId = pg.sourceTableId;
      let nextElements = allElements.map((e) => {
        const p = e.props as Record<string, unknown>;
        if (p.autoMovedFromTableId !== tableId) return e;
        const { autoMovedFromPage, autoMovedFromTableId, autoMovedOriginalY, ...restProps } = p;
        return { ...e, page: autoMovedFromPage as number, y: autoMovedOriginalY !== undefined ? (autoMovedOriginalY as number) : e.y, props: restProps };
      });
      nextElements = nextElements.filter((e) => {
        const p = e.props as Record<string, unknown>;
        return !(p.autoGenerated && p.sourceTableId === tableId);
      });
      nextElements = nextElements.map((e) => {
        if (e.id !== tableId) return e;
        const p = e.props as Record<string, unknown>;
        const { autoOriginalH, endRow: _e, ...restProps } = p;
        return { ...e, h: autoOriginalH !== undefined ? (autoOriginalH as number) : e.h, props: { ...restProps, autoPageBreak: false } };
      });
      const autoPageIdxs = new Set<number>();
      pages.forEach((p, i) => { if ((p as typeof pg).sourceTableId === tableId) autoPageIdxs.add(i); });
      const keptIdxs = pages.map((_, i) => i).filter((i) => !autoPageIdxs.has(i));
      const oldToNew = new Map(keptIdxs.map((oldI, newI) => [oldI, newI]));
      const newPages = pages.filter((_, i) => !autoPageIdxs.has(i));
      nextElements = nextElements.map((e) => ({ ...e, page: oldToNew.get(e.page ?? 0) ?? (e.page ?? 0) }));
      ctrl.resetLayoutSigs();
      ctrl.onChangeTracked({ pages: newPages as ReportPage[], elements: nextElements });
      setCurrentPage((prev) => Math.min(prev, newPages.length - 1));
      ctrl.setSelectedId(null);
      return;
    }
    const newElements = allElements
      .filter((e) => (e.page ?? 0) !== idx)
      .map((e) => { const p = e.page ?? 0; return p > idx ? { ...e, page: p - 1 } : e; });
    const newPages = pages.filter((_, i) => i !== idx);
    ctrl.onChangeTracked({ pages: newPages, elements: newElements });
    setCurrentPage((prev) => clampPage(prev >= idx ? Math.max(0, prev - 1) : prev));
    ctrl.setSelectedId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, allElements]);

  const duplicatePage = useCallback((idx: number) => {
    const pageEls = allElements.filter((e) => (e.page ?? 0) === idx);
    const newPage: ReportPage = { id: uid(), background: pages[idx]?.background };
    const newEls = pageEls.map((e) => ({ ...e, id: uid(), page: pages.length }));
    ctrl.onChangeTracked({ pages: [...pages, newPage], elements: [...allElements, ...newEls] });
    setCurrentPage(pages.length);
    ctrl.setSelectedId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, allElements]);

  const movePage = useCallback((idx: number, dir: 'left' | 'right') => {
    const target = dir === 'left' ? idx - 1 : idx + 1;
    if (target < 0 || target >= pages.length) return;
    const newPages = [...pages];
    [newPages[idx], newPages[target]] = [newPages[target], newPages[idx]];
    const newElements = allElements.map((e) => {
      const p = e.page ?? 0;
      if (p === idx)    return { ...e, page: target };
      if (p === target) return { ...e, page: idx };
      return e;
    });
    ctrl.onChangeTracked({ pages: newPages, elements: newElements });
    setCurrentPage(target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, allElements, ctrl.onChangeTracked]);

  const switchPage = (idx: number) => {
    setCurrentPage(idx);
    ctrl.setSelectedId(null);
    ctrl.setEditingId(null);
  };

  // ── Context menu actions ─────────────────────────────────────────────────

  const buildActions = (elId: string | null): ContextAction[] => {
    const el       = elId ? allElements.find((e) => e.id === elId) : null;
    const isLocked = !!el?.props?.locked;
    const sortedZ  = [...elements].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const elIdx    = elId ? sortedZ.findIndex((e) => e.id === elId) : -1;
    const isTop    = elIdx === sortedZ.length - 1;
    const isBottom = elIdx === 0;
    const actions: ContextAction[] = [];

    if (el) {
      actions.push({ id: 'copy', label: 'Copy', icon: <ClipboardCopy />, shortcut: 'Ctrl+C', onClick: () => ctrl.copyElement(elId!) });
    }
    actions.push({ id: 'paste', label: 'Paste', icon: <ClipboardPaste />, shortcut: 'Ctrl+V', disabled: !ctrl.hasClipboard, onClick: ctrl.pasteElement });
    if (el) {
      actions.push({ id: 'duplicate', label: 'Duplicate', icon: <CopyPlus />, shortcut: 'Ctrl+D', onClick: () => ctrl.duplicateElement(elId!) });
      if (el.groupId) {
        const gid = el.groupId;
        actions.push({
          id: 'group-ops', label: 'Group', icon: <Layers />, separator: true,
          submenu: [
            { id: 'group-dup',     label: 'Duplicate group', icon: <CopyPlus />, onClick: () => ctrl.duplicateGroup(gid) },
            { id: 'group-ungroup', label: 'Ungroup',         icon: <Ungroup />,  onClick: () => ctrl.ungroupGroup(gid) },
          ],
        });
      }
      actions.push({
        id: 'align', label: 'Align to page', icon: <AlignCenterHorizontal />, separator: true,
        submenu: [
          { id: 'al-l',  label: 'Align left',          icon: <AlignStartHorizontal />,  onClick: () => ctrl.alignElement(elId!, 'left') },
          { id: 'al-ch', label: 'Center horizontally', icon: <AlignCenterHorizontal />, onClick: () => ctrl.alignElement(elId!, 'centerH') },
          { id: 'al-r',  label: 'Align right',         icon: <AlignEndHorizontal />,    onClick: () => ctrl.alignElement(elId!, 'right') },
          { id: 'al-t',  label: 'Align top',           icon: <AlignStartVertical />,    separator: true, onClick: () => ctrl.alignElement(elId!, 'top') },
          { id: 'al-cv', label: 'Center vertically',   icon: <AlignCenterVertical />,   onClick: () => ctrl.alignElement(elId!, 'centerV') },
          { id: 'al-b',  label: 'Align bottom',        icon: <AlignEndVertical />,      onClick: () => ctrl.alignElement(elId!, 'bottom') },
        ],
      });
      actions.push({
        id: 'layer', label: 'Layer order', icon: <ChevronsUp />, separator: true,
        submenu: [
          { id: 'l-front',    label: 'Bring to front', icon: <ChevronsUp />,   shortcut: '⇧⌘]', disabled: isTop,    onClick: () => ctrl.reorderElement(elId!, 'front') },
          { id: 'l-forward',  label: 'Bring forward',  icon: <ChevronUp />,    shortcut: '⌘]',   disabled: isTop,    onClick: () => ctrl.reorderElement(elId!, 'forward') },
          { id: 'l-backward', label: 'Send backward',  icon: <ChevronDown />,  shortcut: '⌘[',   disabled: isBottom, onClick: () => ctrl.reorderElement(elId!, 'backward') },
          { id: 'l-back',     label: 'Send to back',   icon: <ChevronsDown />, shortcut: '⇧⌘[',  disabled: isBottom, onClick: () => ctrl.reorderElement(elId!, 'back') },
        ],
      });
      actions.push({ id: 'lock', label: isLocked ? 'Unlock element' : 'Lock element', icon: isLocked ? <Unlock /> : <Lock />, separator: true, onClick: () => ctrl.toggleLock(elId!) });
      actions.push({ id: 'delete', label: 'Delete', icon: <Trash2 />, shortcut: 'Del', danger: true, separator: true, onClick: () => ctrl.deleteElement(elId!) });
    }
    return actions;
  };

  const margins = template.margins ?? DEFAULT_MARGINS;
  const header  = template.header  ?? DEFAULT_HEADER;
  const footer  = template.footer  ?? DEFAULT_FOOTER;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <WidgetDataContext.Provider value={liveWidgetData ?? null}>
    <div className="flex flex-col flex-1 overflow-hidden" onContextMenu={(e) => e.preventDefault()}>
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left panel: collapsible ─────────────────────────────────────── */}
        <div
          className={cn(
            'bg-bg-card border-r border-border flex flex-col flex-shrink-0 overflow-hidden transition-[width] duration-300',
            showLeft ? (leftTab === 'page' ? 'w-[240px]' : 'w-[200px]') : 'w-0',
          )}
          onMouseDown={(e) => {
            // Prevent left panel buttons/tabs from stealing canvas focus,
            // but allow inputs in Page Setup to focus normally.
            const tag = (e.target as HTMLElement).tagName;
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement).isContentEditable) {
              e.preventDefault();
            }
          }}
        >
          {/* Tab bar */}
          <div className={cn('flex border-b border-border flex-shrink-0', leftTab === 'page' ? 'min-w-[240px]' : 'min-w-[200px]')}>
            <button
              onClick={() => setLeftTab('add')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold transition-colors border-b-2',
                leftTab === 'add' ? 'border-accent-600 text-accent-600' : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
            <button
              onClick={() => setLeftTab('layout')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold transition-colors border-b-2',
                leftTab === 'layout' ? 'border-accent-600 text-accent-600' : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              Layout
            </button>
            <button
              onClick={() => setLeftTab('page')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold transition-colors border-b-2',
                leftTab === 'page' ? 'border-accent-600 text-accent-600' : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Page
            </button>
          </div>

          {/* Add tab */}
          {leftTab === 'add' && (
            <div className="flex-1 overflow-y-auto scroll-smooth py-2 px-2 grid grid-cols-2 gap-1 content-start auto-rows-min min-w-[200px]">
              {ELEMENTS.map((def) => (
                <button
                  key={def.type}
                  onClick={() => {
                    ctrl.addElement(def);
                    canvasWrapRef.current?.focus({ preventScroll: true });
                  }}
                  className="flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-lg text-text-muted hover:bg-accent-100 hover:text-accent-700 active:scale-95 transition-all duration-100"
                  title={def.label}
                >
                  {def.icon}
                  <span className="text-[10px] font-medium leading-none">{def.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Layout tab */}
          {leftTab === 'layout' && (
            <div className="min-w-[200px] flex flex-col flex-1 overflow-hidden">
              <LayoutPanel
                elements={elements}
                groups={template.groups?.filter((g) => g.page === currentPage) ?? []}
                selectedId={ctrl.selectedId}
                onSelect={(id) => { ctrl.setSelectedId(id); ctrl.setEditingId(null); }}
                onReorder={ctrl.reorderLayout}
                onReorderInGroup={ctrl.reorderInGroup}
                onToggleLock={ctrl.toggleLock}
                onCopy={ctrl.duplicateElement}
                onDelete={ctrl.deleteElement}
                onRename={ctrl.renameElement}
                onMoveToGroup={ctrl.moveToGroup}
                onCreateGroup={ctrl.createGroup}
                onDeleteGroup={ctrl.deleteGroup}
                onRenameGroup={ctrl.renameGroup}
                onToggleGroupCollapse={ctrl.toggleGroupCollapse}
                onMoveGroupUp={(id) => ctrl.moveGroupInLayout(id, 'up')}
                onMoveGroupDown={(id) => ctrl.moveGroupInLayout(id, 'down')}
                onDuplicateGroup={ctrl.duplicateGroup}
                onUngroupGroup={ctrl.ungroupGroup}
              />
            </div>
          )}

          {/* Page setup tab */}
          {leftTab === 'page' && (
            <div className="min-w-[240px] flex-1 overflow-y-auto scroll-smooth">
              <PageSetupPanel template={template} onChange={ctrl.onChangeTracked} />
            </div>
          )}
        </div>

        {/* Left panel toggle strip */}
        <button
          onClick={() => setShowLeft((v) => !v)}
          title={showLeft ? 'Hide elements panel' : 'Show elements panel'}
          className="flex-shrink-0 w-3.5 bg-bg-subtle border-r border-border hover:bg-bg-hover transition-colors flex items-center justify-center group"
        >
          {showLeft
            ? <ChevronLeft className="w-2.5 h-2.5 text-text-muted group-hover:text-text" />
            : <ChevronRight className="w-2.5 h-2.5 text-text-muted group-hover:text-text" />}
        </button>

        {/* ── Canvas area ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">

          {/* ── Toolbar — multi-select / single-select / pinned-empty ───── */}
          {ctrl.selectedIds.length > 1 ? (
            <MultiSelectToolbar
              count={ctrl.selectedIds.length}
              onGroupSelected={() => ctrl.groupSelected(ctrl.selectedIds)}
              onAlignSelected={(dir) => ctrl.alignSelected(ctrl.selectedIds, dir)}
              onDeleteSelected={() => ctrl.deleteSelected(ctrl.selectedIds)}
              onDuplicateSelected={() => ctrl.duplicateSelected(ctrl.selectedIds)}
              onClear={() => ctrl.setSelectedId(null)}
            />
          ) : ctrl.selectedIds.length === 1 && selected ? (
            <SelectionToolbar
              selected={selected}
              groups={template.groups?.filter((g) => g.page === currentPage) ?? []}
              pinned={toolbarPinned}
              onTogglePin={() => setToolbarPinned((v) => !v)}
              onAlign={(dir) => ctrl.alignElement(ctrl.selectedId!, dir)}
              onLayer={(dir) => ctrl.reorderElement(ctrl.selectedId!, dir)}
              onToggleLock={() => ctrl.toggleLock(ctrl.selectedId!)}
              onDuplicate={() => ctrl.duplicateElement(ctrl.selectedId!)}
              onDelete={() => ctrl.deleteElement(ctrl.selectedId!)}
              onMoveToGroup={(gid) => ctrl.moveToGroup(ctrl.selectedId!, gid)}
              onCreateGroup={ctrl.createGroup}
              onDuplicateGroup={() => selected.groupId && ctrl.duplicateGroup(selected.groupId)}
              onUngroup={() => selected.groupId && ctrl.ungroupGroup(selected.groupId)}
            />
          ) : toolbarPinned ? (
            <SelectionToolbarEmpty onTogglePin={() => setToolbarPinned((v) => !v)} />
          ) : null}

          {/* ── Scrollable canvas surface ────────────────────────────────── */}
          <div
            ref={canvasWrapRef}
            tabIndex={-1}
            className="flex-1 overflow-auto scroll-smooth relative min-h-0 focus:outline-none"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              backgroundImage: ctrl.snapGrid
                ? 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)'
                : 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
              backgroundSize: ctrl.snapGrid ? '8px 8px' : '20px 20px',
            }}
            onFocus={() => setCanvasFocused(true)}
            onBlur={() => setCanvasFocused(false)}
            onKeyDown={() => {
              // Arrow-key nudge is handled in the capture-phase listener in
              // useReportController (fires before Moveable). Nothing to do here.
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                ctrl.setSelectedId(null);
                ctrl.setEditingId(null);
                canvasWrapRef.current?.focus({ preventScroll: true });
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (e.target === e.currentTarget) setCtxMenu({ x: e.clientX, y: e.clientY, elementId: null });
            }}
          >
          {/* Floating position/size bar — shown when element selected & not locked */}
          {ctrl.selectedId && selected && !selected.props?.locked && (
            <PositionBar
              el={selected}
              onUpdate={(patch) => ctrl.updateElement(ctrl.selectedId!, patch)}
              canvasRef={canvasWrapRef}
            />
          )}

          {/* Zoom-out warning banner */}
          {ctrl.scale < 1 && (
            <div
              style={{
                position: 'sticky', top: 0, zIndex: 9999,
                background: 'rgba(245,158,11,0.12)', borderBottom: '1px solid rgba(245,158,11,0.3)',
                padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: '#b45309', userSelect: 'none',
              }}
            >
              <span style={{ fontWeight: 600 }}>បង្រួមទៅ {Math.round(ctrl.scale * 100)}%</span>
              <span style={{ opacity: 0.8 }}>— ធាតុនឹងបង្ហាញតូចជាង PDF ពិតប្រាកដ។ Design នៅ 100% ដើម្បីឱ្យត្រូវគ្នា។</span>
              <button
                onClick={() => ctrl.setScale(1)}
                style={{
                  marginLeft: 6, padding: '1px 8px', borderRadius: 4,
                  border: '1px solid rgba(180,83,9,0.4)', background: 'transparent',
                  fontSize: 10, fontWeight: 600, color: '#b45309', cursor: 'pointer',
                }}
              >
                មើលនៅ 100%
              </button>
            </div>
          )}

          {/* Centering wrapper — all pages stacked vertically */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 40,
              gap: 32,
              boxSizing: 'border-box',
              minWidth: canvasW * ctrl.scale + 80,
              minHeight: pages.length * (canvasH * ctrl.scale + 32) + 80,
            }}
          >
            {pages.map((pg, pgIdx) => {
              const pageBg      = pg.background ?? template.background ?? '#ffffff';
              const isActive    = pgIdx === currentPage;
              const pageElements = allElements
                .filter((e) => (e.page ?? 0) === pgIdx)
                .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

              return (
                <div key={pg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {/* Page label */}
                  <div style={{
                    fontSize: 10, fontWeight: 600,
                    color: isActive ? '#6366f1' : 'var(--text-muted)',
                    letterSpacing: '0.05em', textTransform: 'uppercase', userSelect: 'none',
                  }}>
                    Page {pgIdx + 1}
                  </div>

                  {/* Outer spacer — coordinate space for Moveable */}
                  <div style={{ position: 'relative', width: canvasW * ctrl.scale, height: canvasH * ctrl.scale, flexShrink: 0 }}>

                    {/* Page canvas — CSS-scaled */}
                    <div
                      ref={(node) => {
                        if (node) pageCanvasRefs.current.set(pgIdx, node);
                        else       pageCanvasRefs.current.delete(pgIdx);
                      }}
                      className="shadow-2xl overflow-hidden"
                      style={{
                        position: 'absolute', top: 0, left: 0,
                        width: canvasW, height: canvasH,
                        background: pageBg,
                        transform: `scale(${ctrl.scale})`,
                        transformOrigin: 'top left',
                        outline: isActive ? '1.5px solid rgba(99,102,241,0.55)' : '1px solid rgba(0,0,0,0.08)',
                        outlineOffset: isActive ? 2 : 0,
                        cursor: marqueeBox ? 'crosshair' : undefined,
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0 || e.target !== e.currentTarget) return;
                        e.preventDefault(); // prevent text-selection during drag
                        marqueeRef.current = {
                          startX: e.clientX, startY: e.clientY,
                          curX:   e.clientX, curY:   e.clientY,
                          pageIdx: pgIdx, dragging: false,
                        };
                      }}
                      onClick={(e) => {
                        // Suppress deselect click that fires right after a marquee drag ends.
                        if (marqueeDraggedRef.current) { marqueeDraggedRef.current = false; return; }
                        if (e.target === e.currentTarget) {
                          setCurrentPage(pgIdx);
                          ctrl.setSelectedId(null);
                          ctrl.setEditingId(null);
                          canvasWrapRef.current?.focus({ preventScroll: true });
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCurrentPage(pgIdx);
                        if (e.target === e.currentTarget) setCtxMenu({ x: e.clientX, y: e.clientY, elementId: null });
                      }}
                    >
                      {pageElements.map((el) => {
                        const isLocked  = !!el.props?.locked;
                        const isAutoGen = !!(el.props as Record<string, unknown>)?.autoGenerated;
                        return (
                          <div
                            key={el.id}
                            ref={(node) => {
                              if (node) targetRef.current.set(el.id, node);
                              else targetRef.current.delete(el.id);
                            }}
                            style={{
                              position: 'absolute', left: el.x, top: el.y,
                              width: el.w, height: el.h,
                              transform: `rotate(${el.rotation}deg)`,
                              zIndex: el.zIndex,
                              outline: ctrl.selectedIds.includes(el.id) ? '1px solid rgba(99,102,241,0.6)' : 'none',
                              outlineOffset: 1,
                              cursor: isAutoGen ? 'default' : isLocked ? 'default' : 'pointer',
                              pointerEvents: isAutoGen ? 'none' : undefined,
                            }}
                            onClick={(e) => {
                              if (isAutoGen) return;
                              e.stopPropagation();
                              setCurrentPage(pgIdx);
                              // Always restore keyboard focus to the canvas so
                              // arrow keys nudge elements. Also exit editing mode
                              // on single-click so text/heading don't stay
                              // content-editable and block arrow nudge.
                              canvasWrapRef.current?.focus({ preventScroll: true });
                              if (ctrl.editingId === el.id) ctrl.setEditingId(null);
                              if (e.shiftKey) {
                                ctrl.toggleSelectId(el.id);
                              } else {
                                ctrl.setSelectedId(el.id);
                              }
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (!isLocked && !isAutoGen) {
                                setCurrentPage(pgIdx);
                                ctrl.setSelectedId(el.id);
                                ctrl.setEditingId(el.id);
                              }
                            }}
                            onContextMenu={(e) => {
                              if (isAutoGen) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setCurrentPage(pgIdx);
                              ctrl.setSelectedId(el.id);
                              setCtxMenu({ x: e.clientX, y: e.clientY, elementId: el.id });
                            }}
                          >
                            {isLocked && ctrl.selectedId === el.id && (
                              <div className="absolute -top-6 left-0 flex items-center gap-1 text-[10px] text-text-muted bg-bg-card border border-border rounded px-1.5 py-0.5 shadow-sm pointer-events-none z-10">
                                <Lock className="w-2.5 h-2.5" /> Locked
                              </div>
                            )}
                            {renderElement(
                              el,
                              el.id === ctrl.editingId,
                              () => ctrl.setEditingId(el.id),
                              (props) => ctrl.updateElement(el.id, { props }),
                              () => ctrl.handleAutoPaginate(el.id),
                              (fit) => ctrl.handleActualFit(el.id, fit),
                              // Source auto-paginated tables must stay at their stretched height
                              // (canvasH - el.y) so handleActualFit can measure the correct
                              // row count. Passing onHeightChange would shrink the source table
                              // to content height, then the handleActualFit RAF would re-stretch
                              // it, causing an infinite flicker loop.
                              // Only continuation/autoHeight tables get onHeightChange.
                              (() => {
                                const ep = el.props as Record<string, unknown>;
                                const isSourceAutoTable =
                                  el.type === 'table' &&
                                  !!ep.autoPageBreak &&
                                  !ep.isContinuation &&
                                  !ep.autoGenerated;
                                return isSourceAutoTable
                                  ? undefined
                                  : (h: number) => handleAutoHeightChange(el.id, h);
                              })(),
                            )}
                          </div>
                        );
                      })}

                      {/* Margin guides */}
                      {(margins.top > 0 || margins.bottom > 0 || margins.left > 0 || margins.right > 0) && (
                        <div style={{
                          position: 'absolute',
                          top: margins.top, left: margins.left,
                          width: canvasW - margins.left - margins.right,
                          height: canvasH - margins.top - margins.bottom,
                          border: '1px dashed rgba(99,102,241,0.45)',
                          pointerEvents: 'none', zIndex: 9990,
                        }} />
                      )}

                      {/* Header overlay */}
                      {header.enabled && shouldShowHF(header, pgIdx) && (
                        <div style={{
                          position: 'absolute', top: 0, left: 0, width: '100%', height: header.height,
                          background: header.background,
                          borderBottom: header.borderBottom
                            ? `${header.borderWidth ?? 1}px solid ${header.borderColor ?? '#e5e7eb'}`
                            : '1px dashed rgba(99,102,241,0.5)',
                          display: 'flex', alignItems: 'center',
                          padding: `0 ${header.padding ?? 12}px`,
                          pointerEvents: 'none', zIndex: 9991, overflow: 'hidden', gap: 8,
                        }}>
                          {headerUsesSections(header) ? (
                            <>
                              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', overflow: 'hidden', minWidth: 0 }}>
                                {renderHFSection(header.left, pgIdx, pages.length)}
                              </div>
                              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden', minWidth: 0 }}>
                                {renderHFSection(header.center, pgIdx, pages.length)}
                              </div>
                              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden', minWidth: 0 }}>
                                {renderHFSection(header.right, pgIdx, pages.length)}
                              </div>
                            </>
                          ) : (
                            <span style={{
                              width: '100%', fontSize: header.fontSize ?? 12,
                              fontWeight: header.bold ? 700 : 400, color: header.color ?? '#111111',
                              textAlign: header.align ?? 'left', whiteSpace: 'pre-wrap', overflow: 'hidden',
                            }}>
                              {header.content || <span style={{ opacity: 0.35, fontStyle: 'italic' }}>Header</span>}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Footer overlay */}
                      {footer.enabled && shouldShowHF(footer, pgIdx) && (
                        <div style={{
                          position: 'absolute', bottom: 0, left: 0, width: '100%', height: footer.height,
                          background: footer.background,
                          borderTop: footer.borderTop
                            ? `${footer.borderWidth ?? 1}px solid ${footer.borderColor ?? '#e5e7eb'}`
                            : '1px dashed rgba(99,102,241,0.5)',
                          display: 'flex', alignItems: 'center',
                          padding: `0 ${footer.padding ?? 12}px`,
                          pointerEvents: 'none', zIndex: 9991, overflow: 'hidden', gap: 8,
                        }}>
                          {headerUsesSections(footer) ? (
                            <>
                              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start', overflow: 'hidden', minWidth: 0 }}>
                                {renderHFSection(footer.left, pgIdx, pages.length)}
                              </div>
                              <div style={{ flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden', minWidth: 0 }}>
                                {renderHFSection(footer.center, pgIdx, pages.length)}
                              </div>
                              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden', minWidth: 0 }}>
                                {renderHFSection(footer.right, pgIdx, pages.length)}
                              </div>
                            </>
                          ) : (
                            <>
                              <span style={{
                                flex: 1, fontSize: footer.fontSize ?? 11, fontWeight: footer.bold ? 700 : 400,
                                color: footer.color ?? '#6b7280', textAlign: footer.align ?? 'left',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {footer.content || (!footer.showPageNumber && <span style={{ opacity: 0.35, fontStyle: 'italic' }}>Footer</span>)}
                              </span>
                              {footer.showPageNumber && (
                                <span style={{ fontSize: footer.fontSize ?? 11, color: footer.color ?? '#6b7280', whiteSpace: 'nowrap', flex: 'none' }}>
                                  {footer.pageNumberFormat === 'page-x' && `Page ${pgIdx + 1}`}
                                  {footer.pageNumberFormat === 'x-of-y' && `${pgIdx + 1} of ${pages.length}`}
                                  {footer.pageNumberFormat === 'x' && String(pgIdx + 1)}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Single-select Moveable ──────────────────────── */}
                    {ctrl.selectedIds.length === 1 &&
                      ctrl.selectedId && !selected?.props?.locked &&
                      (selected?.page ?? 0) === pgIdx &&
                      targetRef.current.get(ctrl.selectedId) && (
                      <Moveable
                        ref={ctrl.moveableRef as React.RefObject<Moveable>}
                        target={targetRef.current.get(ctrl.selectedId)}
                        draggable resizable rotatable snappable snapThreshold={5}
                        zoom={1 / ctrl.scale}
                        elementGuidelines={
                          pageElements
                            .filter((e) => e.id !== ctrl.selectedId)
                            .map((e) => targetRef.current.get(e.id))
                            .filter(Boolean) as HTMLElement[]
                        }
                        onDragStart={() => {
                          // Capture initial positions of all other unlocked group members.
                          groupDragRef.current = null;
                          if (!selected?.groupId) return;
                          const groupId = selected.groupId;
                          const members = elements
                            .filter((e) => e.groupId === groupId && e.id !== ctrl.selectedId && !e.props?.locked)
                            .map((e) => ({ id: e.id, x: e.x, y: e.y }));
                          if (members.length === 0) return;
                          groupDragRef.current = { originX: selected.x, originY: selected.y, members };
                        }}
                        onDrag={({ target, left, top }) => {
                          const l = Math.max(0, Math.min(left, canvasW - 10));
                          const t = Math.max(0, Math.min(top,  canvasH - 10));
                          target.style.left = `${l}px`;
                          target.style.top  = `${t}px`;
                          // Move other group members by the same delta.
                          const g = groupDragRef.current;
                          if (g) {
                            const dx = l - g.originX;
                            const dy = t - g.originY;
                            g.members.forEach(({ id, x, y }) => {
                              const node = targetRef.current.get(id);
                              if (node) {
                                node.style.left = `${Math.max(0, x + dx)}px`;
                                node.style.top  = `${Math.max(0, y + dy)}px`;
                              }
                            });
                          }
                        }}
                        onDragEnd={({ target }) => {
                          let x = parseFloat(target.style.left);
                          let y = parseFloat(target.style.top);
                          if (ctrl.snapGrid) {
                            x = Math.round(x / 8) * 8;
                            y = Math.round(y / 8) * 8;
                            target.style.left = `${x}px`;
                            target.style.top  = `${y}px`;
                          }
                          const g = groupDragRef.current;
                          if (g) {
                            // Save final position of the dragged element + all members.
                            const dx = x - g.originX;
                            const dy = y - g.originY;
                            ctrl.updateElementBatch([
                              { id: ctrl.selectedId!, patch: { x, y } },
                              ...g.members.map(({ id, x: ox, y: oy }) => {
                                let nx = ox + dx;
                                let ny = oy + dy;
                                if (ctrl.snapGrid) {
                                  nx = Math.round(nx / 8) * 8;
                                  ny = Math.round(ny / 8) * 8;
                                  const node = targetRef.current.get(id);
                                  if (node) {
                                    node.style.left = `${nx}px`;
                                    node.style.top  = `${ny}px`;
                                  }
                                }
                                return { id, patch: { x: nx, y: ny } };
                              }),
                            ]);
                            groupDragRef.current = null;
                          } else {
                            ctrl.updateElement(ctrl.selectedId!, { x, y });
                          }
                        }}
                        onResizeStart={() => {
                          groupResizeRef.current = null;
                          if (!selected?.groupId) return;
                          const groupId = selected.groupId;
                          const gMembers = elements.filter(
                            (e) => e.groupId === groupId && !e.props?.locked,
                          );
                          if (gMembers.length < 2) return;
                          const gMinX = Math.min(...gMembers.map((e) => e.x));
                          const gMinY = Math.min(...gMembers.map((e) => e.y));
                          const gMaxX = Math.max(...gMembers.map((e) => e.x + e.w));
                          const gMaxY = Math.max(...gMembers.map((e) => e.y + e.h));
                          const gW = gMaxX - gMinX;
                          const gH = gMaxY - gMinY;
                          if (gW <= 0 || gH <= 0) return;
                          groupResizeRef.current = {
                            gOrigX: gMinX, gOrigY: gMinY, gOrigW: gW, gOrigH: gH,
                            selW: selected.w, selH: selected.h,
                            selRelX: (selected.x - gMinX) / gW,
                            selRelY: (selected.y - gMinY) / gH,
                            members: gMembers
                              .filter((e) => e.id !== ctrl.selectedId)
                              .map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, rotation: e.rotation })),
                          };
                        }}
                        onResize={({ target, width, height, drag }) => {
                          const newW = Math.max(10, width);
                          const newH = Math.max(10, height);
                          const newX = drag.left;
                          const newY = drag.top;
                          target.style.width  = `${newW}px`;
                          target.style.height = `${newH}px`;
                          target.style.left   = `${newX}px`;
                          target.style.top    = `${newY}px`;
                          // Scale other group members live
                          const g = groupResizeRef.current;
                          if (!g || g.members.length === 0) return;
                          const scaleX = newW / g.selW;
                          const scaleY = newH / g.selH;
                          const newGW  = g.gOrigW * scaleX;
                          const newGH  = g.gOrigH * scaleY;
                          const newGX  = newX - g.selRelX * newGW;
                          const newGY  = newY - g.selRelY * newGH;
                          g.members.forEach(({ id, x, y, w, h }) => {
                            const node = targetRef.current.get(id);
                            if (!node) return;
                            node.style.left   = `${newGX + ((x - g.gOrigX) / g.gOrigW) * newGW}px`;
                            node.style.top    = `${newGY + ((y - g.gOrigY) / g.gOrigH) * newGH}px`;
                            node.style.width  = `${Math.max(5, w * scaleX)}px`;
                            node.style.height = `${Math.max(5, h * scaleY)}px`;
                          });
                        }}
                        onResizeEnd={({ target }) => {
                          const newW = parseFloat(target.style.width);
                          const newH = parseFloat(target.style.height);
                          const newX = parseFloat(target.style.left);
                          const newY = parseFloat(target.style.top);
                          const patch: Partial<ReportElement> = { w: newW, h: newH, x: newX, y: newY };
                          const selEl = allElements.find((e) => e.id === ctrl.selectedId);
                          const g = groupResizeRef.current;

                          if (g && g.members.length > 0) {
                            // ── Group resize: scale dimensions + props for all members ──
                            const scaleX = newW / g.selW;
                            const scaleY = newH / g.selH;
                            const newGW  = g.gOrigW * scaleX;
                            const newGH  = g.gOrigH * scaleY;
                            const newGX  = newX - g.selRelX * newGW;
                            const newGY  = newY - g.selRelY * newGH;

                            // Scale selected element's props (table cleanup first, then scale)
                            if (selEl) {
                              let base = selEl.props as Record<string, unknown>;
                              if (selEl.type === 'table' && base.autoPageBreak !== false &&
                                  !base.isContinuation && !base.autoGenerated &&
                                  base.autoOriginalH !== undefined) {
                                const { autoOriginalH: _ah, ...clean } = base;
                                base = clean;
                                ctrl.autoLayoutSigRef.current = '';
                              }
                              patch.props = scaleGroupMemberProps(selEl.type, base, scaleX, scaleY);
                            }

                            ctrl.updateElementBatch([
                              { id: ctrl.selectedId!, patch },
                              ...g.members.map(({ id, x, y, w, h, rotation }) => {
                                const el = allElements.find((e) => e.id === id);
                                // Restore DOM transform (may have been overwritten during live drag)
                                const node = targetRef.current.get(id);
                                if (node) node.style.transform = `rotate(${rotation}deg)`;
                                const nx = newGX + ((x - g.gOrigX) / g.gOrigW) * newGW;
                                const ny = newGY + ((y - g.gOrigY) / g.gOrigH) * newGH;
                                const nw = Math.max(5, w * scaleX);
                                const nh = Math.max(5, h * scaleY);
                                const scaledProps = el
                                  ? scaleGroupMemberProps(el.type, el.props as Record<string, unknown>, scaleX, scaleY)
                                  : undefined;
                                return {
                                  id,
                                  patch: { x: nx, y: ny, w: nw, h: nh, ...(scaledProps ? { props: scaledProps } : {}) } as Partial<ReportElement>,
                                };
                              }),
                            ]);
                            groupResizeRef.current = null;
                          } else {
                            // ── Single element resize (no group) ──
                            if (selEl) {
                              const sp = selEl.props as Record<string, unknown>;
                              if (selEl.type === 'table' && sp.autoPageBreak !== false && !sp.isContinuation && !sp.autoGenerated && sp.autoOriginalH !== undefined) {
                                const { autoOriginalH: _, ...cleanProps } = sp;
                                patch.props = cleanProps;
                                ctrl.autoLayoutSigRef.current = '';
                              }
                            }
                            ctrl.updateElement(ctrl.selectedId!, patch);
                          }
                        }}
                        onRotate={({ target, rotation }) => {
                          target.style.transform = `rotate(${rotation}deg)`;
                        }}
                        onRotateEnd={({ target }) => {
                          const m = target.style.transform.match(/rotate\(([^)]+)deg\)/);
                          if (m) ctrl.updateElement(ctrl.selectedId!, { rotation: parseFloat(m[1]) });
                        }}
                      />
                    )}

                    {/* ── Multi-select Moveable (drag group together) ─── */}
                    {(() => {
                      if (ctrl.selectedIds.length < 2) return null;
                      // Only include unlocked elements on this page
                      const pageSelIds = ctrl.selectedIds.filter((id) => {
                        const el = allElements.find((e) => e.id === id);
                        return el && (el.page ?? 0) === pgIdx && !el.props?.locked;
                      });
                      const multiTargets = pageSelIds
                        .map((id) => targetRef.current.get(id))
                        .filter(Boolean) as HTMLElement[];
                      if (multiTargets.length < 2) return null;
                      return (
                        <Moveable
                          key={`multi-${pgIdx}`}
                          targets={multiTargets}
                          draggable
                          zoom={1 / ctrl.scale}
                          onDragGroup={({ events }) => {
                            events.forEach(({ target, left, top }) => {
                              target.style.left = `${Math.max(0, left)}px`;
                              target.style.top  = `${Math.max(0, top)}px`;
                            });
                          }}
                          onDragGroupEnd={() => {
                            const updates: Array<{ id: string; patch: Partial<ReportElement> }> = [];
                            pageSelIds.forEach((id) => {
                              const node = targetRef.current.get(id);
                              if (!node) return;
                              let x = parseFloat(node.style.left);
                              let y = parseFloat(node.style.top);
                              if (ctrl.snapGrid) {
                                x = Math.round(x / 8) * 8;
                                y = Math.round(y / 8) * 8;
                                node.style.left = `${x}px`;
                                node.style.top  = `${y}px`;
                              }
                              updates.push({ id, patch: { x, y } });
                            });
                            ctrl.updateElementBatch(updates);
                          }}
                        />
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
          </div>{/* end inner scroll */}
        </div>{/* end canvas flex-col wrapper */}

        {/* Right panel toggle strip */}
        <button
          onClick={() => setShowRight((v) => !v)}
          title={showRight ? 'Hide properties panel' : 'Show properties panel'}
          className="flex-shrink-0 w-3.5 bg-bg-subtle border-l border-border hover:bg-bg-hover transition-colors flex items-center justify-center group"
        >
          {showRight
            ? <ChevronRight className="w-2.5 h-2.5 text-text-muted group-hover:text-text" />
            : <ChevronLeft className="w-2.5 h-2.5 text-text-muted group-hover:text-text" />}
        </button>

        {/* ── Right panel: collapsible ─────────────────────────────────────── */}
        <div
          className={cn(
            'flex-shrink-0 overflow-hidden transition-[width] duration-300 h-full',
            showRight ? (rightWide ? 'w-[360px]' : 'w-64') : 'w-0',
          )}
        >
          <PropertiesPanel
            selected={selected}
            template={template}
            onElementChange={ctrl.onPropsChange}
            onTemplateChange={ctrl.onChangeTracked}
            wide={rightWide}
            onToggleWide={toggleRightWide}
          />
        </div>

        {/* ── Setup Guide drawer ───────────────────────────────────────────── */}
        {showGuide && (
          <SetupGuideDrawer
            template={template}
            onClose={() => setShowGuide(false)}
          />
        )}
      </div>

      {/* ── Bottom bar: Undo/Redo + Zoom + Snap + Shortcuts + Page tabs ─── */}
      <div className="flex-shrink-0 flex border-t-2 border-border bg-bg-subtle" onMouseDown={(e) => e.preventDefault()}>

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 px-2 border-r border-border flex-shrink-0 h-10">
          <button
            onClick={ctrl.undo}
            disabled={!ctrl.canUndo}
            title="Undo (Ctrl + Z)"
            className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={ctrl.redo}
            disabled={!ctrl.canRedo}
            title="Redo (Ctrl + Shift + Z)"
            className="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 px-2 border-r border-border flex-shrink-0 h-10">
          <button
            onClick={ctrl.zoomOut}
            disabled={ctrl.scale <= 0.25}
            title="Zoom out (Ctrl + −)"
            className="w-6 h-6 flex items-center justify-center rounded text-sm font-bold text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            −
          </button>
          <button
            onClick={() => ctrl.setScale(1)}
            title={ctrl.scale < 1 ? `បច្ចុប្បន្ននៅ ${Math.round(ctrl.scale * 100)}% — ចុចដើម្បីមើលនៅ 100% (ទំហំ PDF ពិតប្រាកដ)` : 'កំណត់ zoom ឡើងវិញទៅ 100% (Ctrl + 0)'}
            className={cn(
              'px-1.5 h-6 text-[10px] font-semibold rounded transition-colors min-w-[44px] text-center',
              ctrl.scale < 1
                ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                : 'text-text-muted hover:text-text hover:bg-bg-hover',
            )}
          >
            {Math.round(ctrl.scale * 100)}%
          </button>
          <button
            onClick={ctrl.zoomIn}
            disabled={ctrl.scale >= 3}
            title="Zoom in (Ctrl + =)"
            className="w-6 h-6 flex items-center justify-center rounded text-sm font-bold text-text-muted hover:text-text hover:bg-bg-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            +
          </button>
          <button
            onClick={fitToWidth}
            title="Fit page to window width"
            className="px-1.5 h-6 text-[10px] font-semibold text-text-muted hover:text-text hover:bg-bg-hover rounded transition-colors border border-border"
          >
            Fit
          </button>
          <button
            onClick={refreshDatasources}
            disabled={refreshing}
            title="Refresh all URL datasources"
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent-600 hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors border border-border"
          >
            <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
          </button>
        </div>

        {/* Snap-to-grid toggle */}
        <div className="flex items-center px-2 border-r border-border flex-shrink-0 h-10">
          <button
            onClick={() => ctrl.setSnapGrid(!ctrl.snapGrid)}
            title={ctrl.snapGrid ? 'Snap to grid ON — click to disable' : 'Snap to grid OFF — click to enable'}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors',
              ctrl.snapGrid
                ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400'
                : 'text-text-muted hover:text-text hover:bg-bg-hover',
            )}
          >
            <Grid3x3 className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>
        </div>

        {/* Keyboard shortcuts button */}
        <div className="flex items-center px-2 border-r border-border flex-shrink-0 h-10">
          <button
            onClick={() => ctrl.setShowShortcuts(!ctrl.showShortcuts)}
            title="Keyboard shortcuts (?)"
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors',
              ctrl.showShortcuts
                ? 'bg-accent-100 text-accent-700'
                : 'text-text-muted hover:text-text hover:bg-bg-hover',
            )}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>?</span>
          </button>
        </div>

        {/* Setup guide button */}
        <div className="flex items-center px-2 border-r border-border flex-shrink-0 h-10">
          <button
            onClick={() => setShowGuide((v) => !v)}
            title="Setup guide — step-by-step"
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors',
              showGuide
                ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/30 dark:text-accent-400'
                : 'text-text-muted hover:text-text hover:bg-bg-hover',
            )}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Guide</span>
          </button>
        </div>

        {/* Canvas focus status */}
        <div className="flex items-center px-2 border-r border-border flex-shrink-0 h-10 gap-1.5">
          {ctrl.selectedId ? (
            canvasFocused ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600 dark:text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                ← → ↑ ↓ nudge
              </span>
            ) : (
              <span
                className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer hover:text-text transition-colors"
                title="Click the canvas to enable arrow-key nudging"
                onClick={() => canvasWrapRef.current?.focus({ preventScroll: true })}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted opacity-40" />
                click canvas to nudge
              </span>
            )
          ) : (
            <span className="text-[10px] text-text-muted opacity-50">no selection</span>
          )}
        </div>

        {/* Page tabs */}
        <PageTabs
          pages={pages}
          currentPage={currentPage}
          templateBackground={template.background ?? '#ffffff'}
          onSelect={switchPage}
          onAdd={addPage}
          onDelete={deletePage}
          onDuplicate={duplicatePage}
          onMoveLeft={(i) => movePage(i, 'left')}
          onMoveRight={(i) => movePage(i, 'right')}
        />
      </div>

      {/* Marquee selection rectangle */}
      {marqueeBox && (
        <div
          style={{
            position: 'fixed',
            left:   marqueeBox.left,
            top:    marqueeBox.top,
            width:  marqueeBox.width,
            height: marqueeBox.height,
            border: '1.5px solid rgba(99,102,241,0.65)',
            background: 'rgba(99,102,241,0.08)',
            pointerEvents: 'none',
            zIndex: 9997,
          }}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          actions={buildActions(ctxMenu.elementId)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Keyboard shortcut cheatsheet */}
      {ctrl.showShortcuts && (
        <ShortcutsModal onClose={() => ctrl.setShowShortcuts(false)} />
      )}
    </div>
    </WidgetDataContext.Provider>
  );
}

// ── Element renderer ──────────────────────────────────────────────────────────

function renderElement(
  el: ReportElement,
  isEditing: boolean,
  onStartEdit: () => void,
  onChange: (props: Record<string, unknown>) => void,
  onAutoPaginate: () => void,
  onActualFit?: (rowsFit: number) => void,
  onHeightChange?: (h: number) => void,
) {
  switch (el.type) {
    case 'text':         return <ElementText element={el} isEditing={isEditing} onStartEdit={onStartEdit} onChange={onChange} />;
    case 'heading':      return <ElementHeading element={el} isEditing={isEditing} onStartEdit={onStartEdit} onChange={onChange} />;
    case 'image':        return <ElementImage element={el} />;
    case 'shape':        return <ElementShape element={el} />;
    case 'divider':      return <ElementDivider element={el} />;
    case 'table':        return <ElementTable element={el} onAutoPaginate={onAutoPaginate} onActualFit={onActualFit} onHeightChange={onHeightChange} />;
    case 'grouped-table': return <ElementGroupedTable element={el} />;
    case 'data-widget':  return <ElementDataWidget element={el} />;
    case 'chart':        return <ElementChart element={el} />;
    case 'progress-bar': return <ElementProgressBar element={el} />;
    case 'page-number': {
      const pp = (el.props ?? {}) as { fontSize?: number; color?: string; format?: string; align?: string };
      const pn  = (el.page ?? 0) + 1;
      const fmt = pp.format ?? 'page';
      const txt = fmt === 'slash' ? `${pn} / —` : fmt === 'number' ? String(pn) : `Page ${pn}`;
      const justify = pp.align === 'left' ? 'flex-start' : pp.align === 'right' ? 'flex-end' : 'center';
      return (
        <div className="w-full h-full flex items-center select-none"
          style={{ fontSize: pp.fontSize ?? 11, color: pp.color ?? '#9ca3af', justifyContent: justify }}>
          {txt}
        </div>
      );
    }
    default: return null;
  }
}
