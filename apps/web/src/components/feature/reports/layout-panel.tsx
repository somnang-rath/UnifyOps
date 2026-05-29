'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart2,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Ungroup,
  GaugeCircle,
  GripVertical,
  Hash,
  Heading1,
  ImageIcon,
  Lock,
  Minus,
  Pencil,
  Square,
  Table2,
  Trash2,
  TrendingUp,
  Type,
  Unlock,
} from 'lucide-react';
import type { ReportElement, ReportGroup } from '@/schemas/report';
import { cn } from '@/lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

const LONG_PRESS_MS = 260;

const TYPE_ICONS: Record<string, React.ReactNode> = {
  text:           <Type className="w-3.5 h-3.5" />,
  heading:        <Heading1 className="w-3.5 h-3.5" />,
  image:          <ImageIcon className="w-3.5 h-3.5" />,
  table:          <Table2 className="w-3.5 h-3.5" />,
  shape:          <Square className="w-3.5 h-3.5" />,
  'data-widget':  <BarChart2 className="w-3.5 h-3.5" />,
  chart:          <TrendingUp className="w-3.5 h-3.5" />,
  'progress-bar': <GaugeCircle className="w-3.5 h-3.5" />,
  divider:        <Minus className="w-3.5 h-3.5" />,
  'page-number':  <Hash className="w-3.5 h-3.5" />,
};

const TYPE_LABELS: Record<string, string> = {
  text:           'Text',
  heading:        'Heading',
  image:          'Image',
  table:          'Table',
  shape:          'Shape',
  'data-widget':  'Widget',
  chart:          'Chart',
  'progress-bar': 'Progress',
  divider:        'Divider',
  'page-number':  'Page No.',
};

function elementLabel(el: ReportElement): string {
  const custom = el.props?._name as string | undefined;
  if (custom) return custom;
  const base = TYPE_LABELS[el.type] ?? el.type;
  const content = (el.props?.content as string | undefined)?.replace(/<[^>]+>/g, '').trim();
  if (content) return `${base} — ${content.slice(0, 20)}`;
  const kpiLabel = el.props?.kpiLabel as string | undefined;
  if (kpiLabel) return `${base} — ${kpiLabel}`;
  return base;
}

// ── Display list builder ──────────────────────────────────────────────────────

type DisplayItem =
  | { kind: 'group'; group: ReportGroup; elements: ReportElement[]; yAnchor: number }
  | { kind: 'element'; element: ReportElement; yAnchor: number };

function buildDisplayList(elements: ReportElement[], groups: ReportGroup[]): DisplayItem[] {
  const byGroup: Record<string, ReportElement[]> = {};
  const ungrouped: ReportElement[] = [];

  for (const el of elements) {
    const gId = el.groupId;
    if (gId && groups.some((g) => g.id === gId)) {
      if (!byGroup[gId]) byGroup[gId] = [];
      byGroup[gId].push(el);
    } else {
      ungrouped.push(el);
    }
  }

  for (const gId in byGroup) {
    byGroup[gId].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  }
  ungrouped.sort((a, b) => (a.y ?? 0) - (b.y ?? 0));

  const items: DisplayItem[] = [
    ...groups.map((g) => {
      const els = byGroup[g.id] ?? [];
      return {
        kind: 'group' as const,
        group: g,
        elements: els,
        yAnchor: els.length ? Math.min(...els.map((e) => e.y ?? 0)) : 9999,
      };
    }),
    ...ungrouped.map((el) => ({ kind: 'element' as const, element: el, yAnchor: el.y ?? 0 })),
  ];

  return items.sort((a, b) => a.yAnchor - b.yAnchor);
}

// ── Context menu type ─────────────────────────────────────────────────────────

type CtxTarget = { kind: 'element'; id: string } | { kind: 'group'; id: string };

interface CtxMenu {
  x: number;
  y: number;
  target: CtxTarget;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  elements: ReportElement[];
  groups: ReportGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Reorder ungrouped elements by their y-sorted index */
  onReorder: (fromIdx: number, toIdx: number) => void;
  /** Reorder elements within a group by their y-sorted index */
  onReorderInGroup: (groupId: string, fromIdx: number, toIdx: number) => void;
  onToggleLock: (id: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onMoveToGroup: (elementId: string, groupId: string | null) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (id: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onToggleGroupCollapse: (id: string) => void;
  onMoveGroupUp: (id: string) => void;
  onMoveGroupDown: (id: string) => void;
  onDuplicateGroup: (id: string) => void;
  onUngroupGroup: (id: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LayoutPanel({
  elements,
  groups,
  selectedId,
  onSelect,
  onReorder,
  onReorderInGroup,
  onToggleLock,
  onCopy,
  onDelete,
  onRename,
  onMoveToGroup,
  onCreateGroup,
  onDeleteGroup,
  onRenameGroup,
  onToggleGroupCollapse,
  onMoveGroupUp,
  onMoveGroupDown,
  onDuplicateGroup,
  onUngroupGroup,
}: Props) {
  const displayItems = buildDisplayList(elements, groups);

  // Ungrouped elements for drag indexing
  const ungrouped = elements.filter((e) => !e.groupId).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));

  // ── Drag state (ungrouped only) ────────────────────────────────────────────
  const [dragId,  setDragId]  = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const longPressRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragActiveRef = useRef(false);

  // ── Context menu ────────────────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [ctxPos, setCtxPos]   = useState({ left: 0, top: 0 });
  const ctxRef = useRef<HTMLDivElement>(null);

  // useLayoutEffect fires before the browser paints — measure the rendered menu
  // and flip it up/left so it never overflows the viewport.
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = ctxRef.current;
    const left = ctxMenu.x + w > window.innerWidth  ? ctxMenu.x - w : ctxMenu.x;
    const top  = ctxMenu.y + h > window.innerHeight ? ctxMenu.y - h : ctxMenu.y;
    setCtxPos({ left: Math.max(0, left), top: Math.max(0, top) });
  }, [ctxMenu]);

  // ── Rename state ────────────────────────────────────────────────────────────
  // kind 'element' → uses onRename; kind 'group' → uses onRenameGroup
  const [renaming, setRenaming]    = useState<{ kind: 'element' | 'group'; id: string } | null>(null);
  const [renameVal, setRenameVal]  = useState('');
  const renameInputRef             = useRef<HTMLInputElement>(null);

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  // Global mouseup ends drag
  const handleGlobalMouseUp = useCallback(() => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    if (dragActiveRef.current && dragId !== null && dropIdx !== null) {
      const fromIdx = ungrouped.findIndex((e) => e.id === dragId);
      const clampedTo = Math.max(0, Math.min(dropIdx, ungrouped.length - 1));
      if (fromIdx !== -1 && fromIdx !== clampedTo) onReorder(fromIdx, clampedTo);
    }
    dragActiveRef.current = false;
    setDragId(null);
    setDropIdx(null);
  }, [dragId, dropIdx, ungrouped, onReorder]);

  useEffect(() => {
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseUp]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const startDrag = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    longPressRef.current = setTimeout(() => {
      dragActiveRef.current = true;
      setDragId(id);
    }, LONG_PRESS_MS);
  };

  const commitRename = () => {
    if (!renaming) return;
    const trimmed = renameVal.trim();
    if (renaming.kind === 'element') onRename(renaming.id, trimmed);
    else onRenameGroup(renaming.id, trimmed);
    setRenaming(null);
  };

  const openRenameElement = (id: string) => {
    const el = elements.find((e) => e.id === id);
    if (!el) return;
    setCtxMenu(null);
    setRenaming({ kind: 'element', id });
    setRenameVal((el.props?._name as string | undefined) ?? elementLabel(el));
  };

  const openRenameGroup = (id: string) => {
    const g = groups.find((g) => g.id === id);
    if (!g) return;
    setCtxMenu(null);
    setRenaming({ kind: 'group', id });
    setRenameVal(g.name);
  };

  // ── Render helpers ───────────────────────────────────────────────────────────

  const elementContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'element', id } });
  };

  const groupContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'group', id } });
  };

  // ── Empty state ─────────────────────────────────────────────────────────────

  const isEmpty = elements.length === 0 && groups.length === 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* New Group button */}
      <div className="px-2 pt-2 pb-1.5 border-b border-border flex-shrink-0">
        <button
          onClick={onCreateGroup}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-semibold text-text-muted hover:text-accent-600 hover:bg-accent-50 dark:hover:bg-accent-950/30 border border-dashed border-border hover:border-accent-400 rounded-lg transition-all"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          New Group
        </button>
      </div>

      {/* Item list */}
      <div
        className="flex-1 overflow-y-auto scroll-smooth py-1.5 px-1.5 flex flex-col gap-0.5"
        style={{ cursor: dragId ? 'grabbing' : undefined }}
      >
        {isEmpty && (
          <div className="flex flex-col items-center justify-center text-center px-4 py-8 gap-2">
            <div className="w-8 h-8 rounded-lg bg-bg-subtle flex items-center justify-center">
              <Square className="w-4 h-4 text-text-muted" />
            </div>
            <p className="text-[11px] text-text-muted leading-snug">
              No elements yet.<br />Add some from the <strong>Add</strong> tab.
            </p>
          </div>
        )}

        {displayItems.map((item, topIdx) => {
          const isFirst = topIdx === 0;
          const isLast  = topIdx === displayItems.length - 1;

          // ── Group row ────────────────────────────────────────────────────
          if (item.kind === 'group') {
            const g          = item.group;
            const isCollapsed = !!g.collapsed;
            const isEmpty     = item.elements.length === 0;
            const isRenaming  = renaming?.kind === 'group' && renaming.id === g.id;
            const canMove     = !isEmpty; // empty groups have no y anchor

            return (
              <div key={g.id}>
                {/* Group header */}
                <div
                  onContextMenu={(e) => groupContextMenu(e, g.id)}
                  className="group flex items-center gap-1 px-1.5 py-1.5 rounded-lg hover:bg-bg-hover cursor-default select-none"
                >
                  {/* Collapse toggle */}
                  <button
                    onClick={() => onToggleGroupCollapse(g.id)}
                    className="flex-shrink-0 p-0.5 rounded text-text-muted hover:text-text transition-colors"
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-3.5 h-3.5" />
                      : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {/* Folder icon */}
                  <span className="flex-shrink-0 text-accent-500 w-4 flex justify-center">
                    {isCollapsed ? <Folder className="w-3.5 h-3.5" /> : <FolderOpen className="w-3.5 h-3.5" />}
                  </span>

                  {/* Name / rename input */}
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')  commitRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="flex-1 text-[11px] font-semibold bg-bg-input border border-accent-400 rounded px-1.5 py-0.5 outline-none min-w-0"
                    />
                  ) : (
                    <span
                      className="flex-1 truncate text-[11px] font-semibold text-text leading-none"
                      onDoubleClick={() => openRenameGroup(g.id)}
                      title="Double-click to rename"
                    >
                      {g.name}
                      {isEmpty && (
                        <span className="ml-1 text-[10px] font-normal text-text-muted">(empty)</span>
                      )}
                    </span>
                  )}

                  {/* Count badge */}
                  {!isEmpty && (
                    <span className="flex-shrink-0 text-[9px] font-medium text-text-muted bg-bg-subtle border border-border rounded-full px-1.5 py-0.5 leading-none">
                      {item.elements.length}
                    </span>
                  )}

                  {/* Up / Down buttons */}
                  <div className={cn('flex items-center gap-0.5 flex-shrink-0 transition-opacity opacity-0 group-hover:opacity-100')}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onMoveGroupUp(g.id); }}
                      disabled={isFirst || !canMove}
                      title="Move group up"
                      className="p-1 rounded-md text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onMoveGroupDown(g.id); }}
                      disabled={isLast || !canMove}
                      title="Move group down"
                      className="p-1 rounded-md text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Group children */}
                {!isCollapsed && (
                  <div className="ml-4 flex flex-col gap-0.5 border-l-2 border-border pl-1.5 mb-0.5">
                    {item.elements.length === 0 && (
                      <p className="text-[10px] text-text-muted px-2 py-1 italic">Drop elements here via right-click</p>
                    )}
                    {item.elements.map((el, elIdx) => {
                      const isFirst    = elIdx === 0;
                      const isLast     = elIdx === item.elements.length - 1;
                      const isLocked   = !!el.props?.locked;
                      const isSelected = el.id === selectedId;
                      const isRenaming = renaming?.kind === 'element' && renaming.id === el.id;

                      return (
                        <div
                          key={el.id}
                          onClick={() => onSelect(el.id)}
                          onContextMenu={(e) => elementContextMenu(e, el.id)}
                          className={cn(
                            'group flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg cursor-default transition-colors select-none',
                            isSelected
                              ? 'bg-accent-100 text-accent-700 dark:bg-accent-950/40 dark:text-accent-400'
                              : 'hover:bg-bg-hover text-text-sub',
                          )}
                        >
                          <span className={cn('flex-shrink-0 w-4 flex justify-center', isSelected ? 'text-accent-600' : 'text-text-muted')}>
                            {TYPE_ICONS[el.type] ?? <Square className="w-3.5 h-3.5" />}
                          </span>

                          {isRenaming ? (
                            <input
                              ref={renameInputRef}
                              value={renameVal}
                              onChange={(e) => setRenameVal(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')  commitRename();
                                if (e.key === 'Escape') setRenaming(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="flex-1 text-[11px] font-medium bg-bg-input border border-accent-400 rounded px-1.5 py-0.5 outline-none min-w-0"
                            />
                          ) : (
                            <span
                              className="flex-1 truncate text-[11px] font-medium leading-none"
                              onDoubleClick={(e) => { e.stopPropagation(); openRenameElement(el.id); }}
                            >
                              {elementLabel(el)}
                            </span>
                          )}

                          <div className={cn('flex items-center gap-0.5 flex-shrink-0 transition-opacity', isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleLock(el.id); }}
                              title={isLocked ? 'Unlock' : 'Lock'}
                              className={cn('p-1 rounded-md transition-colors', isLocked ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20' : 'text-text-muted hover:bg-bg-subtle')}
                            >
                              {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onReorderInGroup(g.id, elIdx, elIdx - 1); }}
                              disabled={isFirst}
                              title="Move up"
                              className="p-1 rounded-md text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onReorderInGroup(g.id, elIdx, elIdx + 1); }}
                              disabled={isLast}
                              title="Move down"
                              className="p-1 rounded-md text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          // ── Ungrouped element row ────────────────────────────────────────
          const el         = item.element;
          const uIdx       = ungrouped.findIndex((e) => e.id === el.id);
          const isUFirst   = uIdx === 0;
          const isULast    = uIdx === ungrouped.length - 1;
          const isLocked   = !!el.props?.locked;
          const isSelected = el.id === selectedId;
          const isDragged  = el.id === dragId;
          const showDrop   = dragId !== null && dropIdx === uIdx && !isDragged;
          const isRenaming = renaming?.kind === 'element' && renaming.id === el.id;

          return (
            <div key={el.id}>
              {showDrop && <div className="h-0.5 bg-accent-500 rounded-full mx-2 my-0.5" />}
              <div
                onMouseDown={(e) => startDrag(e, el.id)}
                onMouseEnter={() => { if (dragActiveRef.current) setDropIdx(uIdx); }}
                onClick={() => { if (!dragActiveRef.current) onSelect(el.id); }}
                onContextMenu={(e) => elementContextMenu(e, el.id)}
                className={cn(
                  'group flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg transition-colors select-none',
                  dragId ? 'cursor-grabbing' : 'cursor-default',
                  isDragged && 'opacity-40 ring-2 ring-accent-400 ring-inset',
                  isSelected && !isDragged
                    ? 'bg-accent-100 text-accent-700 dark:bg-accent-950/40 dark:text-accent-400'
                    : !isDragged && 'hover:bg-bg-hover text-text-sub',
                )}
              >
                <span
                  className="flex-shrink-0 text-text-muted opacity-0 group-hover:opacity-50 transition-opacity cursor-grab"
                  title="Hold to drag"
                >
                  <GripVertical className="w-3 h-3" />
                </span>

                <span className={cn('flex-shrink-0 w-4 flex justify-center', isSelected ? 'text-accent-600' : 'text-text-muted')}>
                  {TYPE_ICONS[el.type] ?? <Square className="w-3.5 h-3.5" />}
                </span>

                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')  commitRename();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="flex-1 text-[11px] font-medium bg-bg-input border border-accent-400 rounded px-1.5 py-0.5 outline-none min-w-0"
                  />
                ) : (
                  <span
                    className="flex-1 truncate text-[11px] font-medium leading-none"
                    onDoubleClick={(e) => { e.stopPropagation(); openRenameElement(el.id); }}
                    title="Double-click to rename"
                  >
                    {elementLabel(el)}
                  </span>
                )}

                <div className={cn('flex items-center gap-0.5 flex-shrink-0 transition-opacity', isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleLock(el.id); }}
                    title={isLocked ? 'Unlock' : 'Lock'}
                    className={cn('p-1 rounded-md transition-colors', isLocked ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20' : 'text-text-muted hover:bg-bg-subtle')}
                  >
                    {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onReorder(uIdx, uIdx - 1); }}
                    disabled={isUFirst}
                    title="Move up"
                    className="p-1 rounded-md text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onReorder(uIdx, uIdx + 1); }}
                    disabled={isULast}
                    title="Move down"
                    className="p-1 rounded-md text-text-muted hover:bg-bg-subtle hover:text-text disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Drop zone after the last ungrouped element */}
        {dragId !== null && (
          <>
            {dropIdx === ungrouped.length && (
              <div className="h-0.5 bg-accent-500 rounded-full mx-2 my-0.5" />
            )}
            <div
              className="h-4 w-full"
              onMouseEnter={() => setDropIdx(ungrouped.length)}
            />
          </>
        )}
      </div>

      {/* ── Context menu ──────────────────────────────────────────────────── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{ position: 'fixed', left: ctxPos.left, top: ctxPos.top, zIndex: 9999 }}
          className="bg-bg-card border border-border rounded-lg shadow-lg py-1 min-w-[168px] max-h-[calc(100vh-16px)] overflow-y-auto animate-fade-in"
        >
          {ctxMenu.target.kind === 'element' && (() => {
            const id = ctxMenu.target.id;
            const el = elements.find((e) => e.id === id);
            const inGroup = !!el?.groupId;
            return (
              <>
                <button onClick={() => openRenameElement(id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors">
                  <Pencil className="w-3.5 h-3.5 text-text-muted" /> Rename
                </button>
                <button onClick={() => { onCopy(id); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors">
                  <Copy className="w-3.5 h-3.5 text-text-muted" /> Copy
                </button>

                {/* Move to group sub-section */}
                {groups.length > 0 && (
                  <>
                    <div className="my-1 border-t border-border" />
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      Move to group
                    </p>
                    {groups.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => { onMoveToGroup(id, g.id); setCtxMenu(null); }}
                        disabled={el?.groupId === g.id}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-bg-hover disabled:opacity-40 disabled:cursor-default transition-colors"
                      >
                        <Folder className="w-3.5 h-3.5 text-accent-500" />
                        {g.name}
                      </button>
                    ))}
                    {inGroup && (
                      <button onClick={() => { onMoveToGroup(id, null); setCtxMenu(null); }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-muted hover:bg-bg-hover transition-colors">
                        <Unlock className="w-3.5 h-3.5" /> Remove from group
                      </button>
                    )}
                  </>
                )}

                <div className="my-1 border-t border-border" />
                <button onClick={() => { onDelete(id); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </>
            );
          })()}

          {ctxMenu.target.kind === 'group' && (() => {
            const id = ctxMenu.target.id;
            return (
              <>
                <button onClick={() => openRenameGroup(id)}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors">
                  <Pencil className="w-3.5 h-3.5 text-text-muted" /> Rename group
                </button>
                <button onClick={() => { onDuplicateGroup(id); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors">
                  <Copy className="w-3.5 h-3.5 text-text-muted" /> Duplicate group
                </button>
                <div className="my-1 border-t border-border" />
                <button onClick={() => { onUngroupGroup(id); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text hover:bg-bg-hover transition-colors">
                  <Ungroup className="w-3.5 h-3.5 text-text-muted" /> Ungroup
                  <span className="ml-auto text-[10px] text-text-muted">keeps elements</span>
                </button>
                <div className="my-1 border-t border-border" />
                <button onClick={() => { onDeleteGroup(id); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> Delete group
                  <span className="ml-auto text-[10px] text-red-400">removes elements</span>
                </button>
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}
