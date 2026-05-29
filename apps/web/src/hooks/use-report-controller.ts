/**
 * useReportController
 *
 * Centralized hook that owns all element-level operations for the canvas editor:
 * selection, clipboard, mutations, group management, keyboard shortcuts, zoom,
 * snap-to-grid, and the new arrow-key nudge.
 *
 * Designed to be dropped into CanvasEditor (or any future canvas surface) so
 * that the component itself stays a thin render shell.
 *
 * Usage:
 *   const ctrl = useReportController({ template, onChange, canvasW, canvasH, currentPage });
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type Moveable from 'react-moveable';
import type { ReportElement, ReportGroup, ReportPage, ReportTemplate } from '@/schemas/report';
import { autoLayoutSig, computeAutoLayout } from '@/lib/reports/auto-layout';
import type { ElementDef } from '@/components/feature/reports/elements-sidebar';

// ── helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
const SNAP_GRID_PX = 8;

function snapToGrid(v: number): number {
  return Math.round(v / SNAP_GRID_PX) * SNAP_GRID_PX;
}

// ── types ────────────────────────────────────────────────────────────────────

export interface ReportControllerParams {
  template: ReportTemplate;
  onChange: (patch: Partial<ReportTemplate>) => void;
  canvasW: number;
  canvasH: number;
  currentPage: number;
}

export interface ReportControllerResult {
  // Selection
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** All currently-selected element IDs (1 = single-select, 2+ = multi-select) */
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  /** Shift+click: adds/removes an element from the multi-selection */
  toggleSelectId: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;

  // Clipboard
  hasClipboard: boolean;

  // Refs that CanvasEditor must attach
  moveableRef: React.RefObject<Moveable | null>;
  /** Auto-layout signature ref — expose so CanvasEditor's useEffect & deletePage can reset it */
  autoLayoutSigRef: React.MutableRefObject<string>;
  /** Fit hints ref — expose so CanvasEditor's useEffect & deletePage can reset it */
  actualFitHintsRef: React.MutableRefObject<Record<string, number>>;
  /** Reset both layout refs at once (used by deletePage when disabling auto-pagination) */
  resetLayoutSigs: () => void;

  // Zoom
  scale: number;
  setScale: (s: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;

  // Snap to grid
  snapGrid: boolean;
  setSnapGrid: (v: boolean) => void;

  // Keyboard shortcut panel
  showShortcuts: boolean;
  setShowShortcuts: (v: boolean) => void;

  // Element mutations
  updateElement: (id: string, patch: Partial<ReportElement>) => void;
  deleteElement: (id: string) => void;
  copyElement: (id: string) => void;
  pasteElement: () => void;
  duplicateElement: (id: string) => void;
  alignElement: (id: string, align: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
  reorderElement: (id: string, dir: 'front' | 'forward' | 'backward' | 'back') => void;
  toggleLock: (id: string) => void;
  /** Nudge selected element by (dx, dy) pixels. Shift = 10px step; respects snap-to-grid. */
  nudgeElement: (id: string, dx: number, dy: number) => void;
  /** Batch-update multiple elements in one call — used for group drag-end. */
  updateElementBatch: (updates: Array<{ id: string; patch: Partial<ReportElement> }>) => void;
  /** Duplicate every element in the group, create a new group with the copies, and select them. */
  duplicateGroup: (groupId: string) => void;
  /** Remove groupId from all elements in the group and delete the group. Elements stay on canvas. */
  ungroupGroup: (groupId: string) => void;

  // Multi-element operations (work on selectedIds batch)
  deleteSelected: (ids: string[]) => void;
  duplicateSelected: (ids: string[]) => void;
  alignSelected: (ids: string[], dir: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => void;
  groupSelected: (ids: string[]) => void;

  // Groups
  createGroup: () => void;
  deleteGroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  toggleGroupCollapse: (groupId: string) => void;
  moveToGroup: (elementId: string, groupId: string | null) => void;
  moveGroupInLayout: (groupId: string, dir: 'up' | 'down') => void;

  // Layout reordering
  reorderLayout: (fromIdx: number, toIdx: number) => void;
  reorderInGroup: (groupId: string, fromIdx: number, toIdx: number) => void;
  renameElement: (id: string, name: string) => void;

  // Table auto-pagination
  handleAutoPaginate: (elementId: string) => void;
  handleActualFit: (elementId: string, fitEnd: number) => void;

  // Add element (needs current page context)
  addElement: (def: ElementDef) => void;

  // Props change proxy (maps _x/_y/_w/_h/_rotation → element fields)
  onPropsChange: (props: Record<string, unknown>) => void;
}

// ── hook ─────────────────────────────────────────────────────────────────────

export function useReportController({
  template,
  onChange,
  canvasW,
  canvasH,
  currentPage,
}: ReportControllerParams): ReportControllerResult {
  // ── raw state ────────────────────────────────────────────────────────────
  const [selectedId,  setSelectedIdRaw]  = useState<string | null>(null);
  const [selectedIds, setSelectedIdsRaw] = useState<string[]>([]);
  const [editingId, setEditingId]        = useState<string | null>(null);
  const [hasClipboard, setHasClipboard]  = useState(false);
  const [scale, setScale]                = useState(1);
  const [snapGrid, setSnapGridRaw]       = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('rpt:snap') === '1',
  );
  const [showShortcuts, setShowShortcuts] = useState(false);

  // ── wrapped setters ──────────────────────────────────────────────────────

  /** Set single selection — clears any multi-select */
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdRaw(id);
    setSelectedIdsRaw(id ? [id] : []);
  }, []);

  /** Set multi-selection — last ID becomes the primary selectedId */
  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedIdsRaw(ids);
    setSelectedIdRaw(ids.length > 0 ? ids[ids.length - 1] : null);
  }, []);

  /** Shift+click: toggle an element in/out of the multi-selection */
  const toggleSelectId = useCallback((id: string) => {
    setSelectedIdsRaw((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
      setSelectedIdRaw(next.length > 0 ? next[next.length - 1] : null);
      return next;
    });
  }, []);

  /** Persist snap-grid toggle */
  const setSnapGrid = useCallback((v: boolean) => {
    setSnapGridRaw(v);
    try { localStorage.setItem('rpt:snap', v ? '1' : '0'); } catch { /* quota */ }
  }, []);

  // ── refs ─────────────────────────────────────────────────────────────────
  const moveableRef        = useRef<Moveable | null>(null);
  const clipboardRef       = useRef<ReportElement | null>(null);
  const autoLayoutSigRef   = useRef('');
  const actualFitHintsRef  = useRef<Record<string, number>>({});
  const templateRef        = useRef(template);
  templateRef.current = template;

  const snapGridRef    = useRef(snapGrid);
  snapGridRef.current  = snapGrid;

  /** Always-current copy of selectedIds — safe to read inside stable callbacks */
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  // ── derived ─────────────────────────────────────────────────────────────

  const allElements = template.elements ?? [];
  const allGroups: ReportGroup[] = template.groups ?? [];
  const currentGroups = allGroups.filter((g) => g.page === currentPage);

  const setAllElements = useCallback(
    (els: ReportElement[]) => onChange({ elements: els }),
    [onChange],
  );

  // ── zoom ────────────────────────────────────────────────────────────────

  const zoomIn  = useCallback(() => setScale((s) => ZOOM_STEPS.find((z) => z > s + 0.001) ?? 3), []);
  const zoomOut = useCallback(() => setScale((s) => [...ZOOM_STEPS].reverse().find((z) => z < s - 0.001) ?? 0.25), []);

  // ── reset helpers ────────────────────────────────────────────────────────

  const resetLayoutSigs = useCallback(() => {
    autoLayoutSigRef.current = '';
    actualFitHintsRef.current = {};
  }, []);

  // ── element mutations ────────────────────────────────────────────────────

  const updateElement = useCallback(
    (id: string, patch: Partial<ReportElement>) =>
      setAllElements(allElements.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    [allElements, setAllElements],
  );

  const deleteElement = useCallback(
    (id: string) => {
      const el = allElements.find((e) => e.id === id);
      const isSourceAutoTable =
        el?.type === 'table' &&
        !!(el.props as Record<string, unknown>)?.autoPageBreak &&
        !(el.props as Record<string, unknown>)?.isContinuation &&
        !(el.props as Record<string, unknown>)?.autoGenerated;

      let nextElements = allElements;

      if (isSourceAutoTable) {
        nextElements = nextElements.map((e) => {
          const p = e.props as Record<string, unknown>;
          if (p.autoMovedFromTableId !== id) return e;
          const { autoMovedFromPage, autoMovedFromTableId, autoMovedOriginalY, ...restProps } = p;
          return {
            ...e,
            page: autoMovedFromPage as number,
            y: autoMovedOriginalY !== undefined ? (autoMovedOriginalY as number) : e.y,
            props: restProps,
          };
        });
        nextElements = nextElements.filter((e) => {
          if (e.id === id) return false;
          const p = e.props as Record<string, unknown>;
          return !(p.autoGenerated && p.sourceTableId === id);
        });
        const allPages = template.pages?.length ? template.pages : [{ id: 'page-0' }];
        const autoPageIdxs = new Set<number>();
        (allPages as unknown as { sourceTableId?: string }[]).forEach((pg, i) => {
          if (pg.sourceTableId === id) autoPageIdxs.add(i);
        });
        if (autoPageIdxs.size > 0) {
          const keptIdxs = allPages.map((_, i) => i).filter((i) => !autoPageIdxs.has(i));
          const oldToNew = new Map(keptIdxs.map((oldI, newI) => [oldI, newI]));
          const newPages = allPages.filter((_, i) => !autoPageIdxs.has(i));
          nextElements = nextElements.map((e) => ({ ...e, page: oldToNew.get(e.page ?? 0) ?? (e.page ?? 0) }));
          autoLayoutSigRef.current = '';
          onChange({ pages: newPages as ReportPage[], elements: nextElements });
          if (selectedId === id) setSelectedId(null);
          return;
        }
        autoLayoutSigRef.current = '';
      } else {
        nextElements = nextElements.filter((e) => e.id !== id);
      }

      setAllElements(nextElements);
      if (selectedId === id) setSelectedId(null);
    },
    [allElements, selectedId, template.pages, onChange, setAllElements],
  );

  const copyElement = useCallback((id: string) => {
    const el = allElements.find((e) => e.id === id);
    if (el) { clipboardRef.current = el; setHasClipboard(true); }
  }, [allElements]);

  const pasteElement = useCallback(() => {
    const el = clipboardRef.current;
    if (!el) return;
    const newEl: ReportElement = {
      ...el, id: uid(), x: el.x + 20, y: el.y + 20,
      zIndex: allElements.length, page: currentPage,
    };
    setAllElements([...allElements, newEl]);
    setSelectedId(newEl.id);
  }, [allElements, currentPage, setAllElements]);

  const duplicateElement = useCallback((id: string) => {
    const el = allElements.find((e) => e.id === id);
    if (!el) return;
    const newEl: ReportElement = {
      ...el, id: uid(), x: el.x + 20, y: el.y + 20,
      zIndex: allElements.length, page: currentPage,
    };
    setAllElements([...allElements, newEl]);
    setSelectedId(newEl.id);
  }, [allElements, currentPage, setAllElements]);

  const alignElement = useCallback(
    (id: string, align: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
      const el = allElements.find((e) => e.id === id);
      if (!el) return;
      const patch: Partial<ReportElement> = {};
      if (align === 'left')    patch.x = 0;
      if (align === 'centerH') patch.x = Math.round((canvasW - el.w) / 2);
      if (align === 'right')   patch.x = canvasW - el.w;
      if (align === 'top')     patch.y = 0;
      if (align === 'centerV') patch.y = Math.round((canvasH - el.h) / 2);
      if (align === 'bottom')  patch.y = canvasH - el.h;
      updateElement(id, patch);
    },
    [allElements, canvasW, canvasH, updateElement],
  );

  const reorderElement = useCallback((id: string, dir: 'front' | 'forward' | 'backward' | 'back') => {
    const el = allElements.find((e) => e.id === id);
    if (!el) return;
    if (dir === 'front') {
      const max = allElements.length ? Math.max(...allElements.map((e) => e.zIndex ?? 0)) : 0;
      updateElement(id, { zIndex: max + 1 });
    } else if (dir === 'back') {
      const min = allElements.length ? Math.min(...allElements.map((e) => e.zIndex ?? 0)) : 0;
      updateElement(id, { zIndex: min - 1 });
    } else if (dir === 'forward') {
      updateElement(id, { zIndex: (el.zIndex ?? 0) + 1 });
    } else {
      updateElement(id, { zIndex: (el.zIndex ?? 0) - 1 });
    }
  }, [allElements, updateElement]);

  const toggleLock = useCallback((id: string) => {
    const el = allElements.find((e) => e.id === id);
    if (!el) return;
    updateElement(id, { props: { ...el.props, locked: !el.props?.locked } });
  }, [allElements, updateElement]);

  /**
   * Nudge one element by (dx, dy) canvas-pixels.
   * When snap-to-grid is on the final position is rounded to the 8px grid.
   * Calls Moveable.updateRect() so handles stay aligned.
   */
  const nudgeElement = useCallback((id: string, dx: number, dy: number) => {
    const el = allElements.find((e) => e.id === id);
    if (!el || el.props?.locked) return;

    let newX = Math.max(0, Math.min(canvasW - el.w, el.x + dx));
    let newY = Math.max(0, Math.min(canvasH - el.h, el.y + dy));

    if (snapGridRef.current) {
      newX = snapToGrid(newX);
      newY = snapToGrid(newY);
    }

    updateElement(id, { x: newX, y: newY });
    requestAnimationFrame(() => moveableRef.current?.updateRect());
  }, [allElements, canvasW, canvasH, updateElement]);

  const duplicateGroup = useCallback((groupId: string) => {
    const group = allGroups.find((g) => g.id === groupId);
    if (!group) return;
    const groupEls = allElements.filter((e) => e.groupId === groupId);
    if (groupEls.length === 0) return;
    const newGroupId = uid();
    const newGroup: ReportGroup = { ...group, id: newGroupId, name: `${group.name} copy` };
    const newEls = groupEls.map((e, i) => ({
      ...e, id: uid(), x: e.x + 20, y: e.y + 20,
      groupId: newGroupId, zIndex: allElements.length + i,
    }));
    onChange({ groups: [...allGroups, newGroup], elements: [...allElements, ...newEls] });
    setSelectedIds(newEls.map((e) => e.id));
  }, [allElements, allGroups, onChange, setSelectedIds]);

  const ungroupGroup = useCallback((groupId: string) => {
    onChange({
      groups: allGroups.filter((g) => g.id !== groupId),
      elements: allElements.map((e) =>
        e.groupId === groupId ? { ...e, groupId: undefined } : e,
      ),
    });
  }, [allElements, allGroups, onChange]);

  /** Apply a patch to multiple elements atomically — used for group drag-end. */
  const updateElementBatch = useCallback(
    (updates: Array<{ id: string; patch: Partial<ReportElement> }>) => {
      if (updates.length === 0) return;
      const patchMap = new Map(updates.map((u) => [u.id, u.patch]));
      setAllElements(
        allElements.map((e) => {
          const patch = patchMap.get(e.id);
          return patch ? { ...e, ...patch } : e;
        }),
      );
    },
    [allElements, setAllElements],
  );

  /**
   * Nudge all elements in ids by (dx, dy) — used for Arrow-key multi-select.
   * Uses templateRef so this callback is stable and never closed over stale allElements.
   */
  const nudgeSelected = useCallback((ids: string[], dx: number, dy: number) => {
    if (ids.length === 0) return;
    const elems = templateRef.current.elements ?? [];
    const updated = elems.map((el) => {
      if (!ids.includes(el.id) || el.props?.locked) return el;
      let newX = Math.max(0, Math.min(canvasW - el.w, el.x + dx));
      let newY = Math.max(0, Math.min(canvasH - el.h, el.y + dy));
      if (snapGridRef.current) { newX = snapToGrid(newX); newY = snapToGrid(newY); }
      return { ...el, x: newX, y: newY };
    });
    setAllElements(updated);
    requestAnimationFrame(() => moveableRef.current?.updateRect());
  }, [canvasW, canvasH, setAllElements]);

  // ── multi-element operations ─────────────────────────────────────────────

  /** Delete all elements in ids (handles auto-pagination tables individually) */
  const deleteSelected = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setAllElements(allElements.filter((e) => !ids.includes(e.id)));
    setSelectedIdRaw(null);
    setSelectedIdsRaw([]);
  }, [allElements, setAllElements]);

  /** Duplicate all selected elements with an offset */
  const duplicateSelected = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const newEls = ids
      .map((id, i) => {
        const el = allElements.find((e) => e.id === id);
        if (!el) return null;
        return { ...el, id: uid(), x: el.x + 20, y: el.y + 20, zIndex: allElements.length + i };
      })
      .filter(Boolean) as ReportElement[];
    const newIds = newEls.map((e) => e.id);
    setAllElements([...allElements, ...newEls]);
    setSelectedIdsRaw(newIds);
    setSelectedIdRaw(newIds[newIds.length - 1] ?? null);
  }, [allElements, setAllElements]);

  /** Align all selected elements relative to the canvas */
  const alignSelected = useCallback(
    (ids: string[], align: 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom') => {
      if (ids.length === 0) return;
      setAllElements(
        allElements.map((el) => {
          if (!ids.includes(el.id)) return el;
          const patch: Partial<ReportElement> = {};
          if (align === 'left')    patch.x = 0;
          if (align === 'centerH') patch.x = Math.round((canvasW - el.w) / 2);
          if (align === 'right')   patch.x = canvasW - el.w;
          if (align === 'top')     patch.y = 0;
          if (align === 'centerV') patch.y = Math.round((canvasH - el.h) / 2);
          if (align === 'bottom')  patch.y = canvasH - el.h;
          return { ...el, ...patch };
        }),
      );
    },
    [allElements, canvasW, canvasH, setAllElements],
  );

  /** Create a new group and assign all selected elements to it */
  const groupSelected = useCallback(
    (ids: string[]) => {
      if (ids.length < 2) return;
      const count = allGroups.filter((g) => g.page === currentPage).length;
      const newGroup: ReportGroup = { id: uid(), name: `Group ${count + 1}`, page: currentPage };
      onChange({
        groups: [...allGroups, newGroup],
        elements: allElements.map((e) => (ids.includes(e.id) ? { ...e, groupId: newGroup.id } : e)),
      });
    },
    [allGroups, allElements, currentPage, onChange],
  );

  // ── groups ────────────────────────────────────────────────────────────────

  const createGroup = useCallback(() => {
    const count = allGroups.filter((g) => g.page === currentPage).length;
    const newGroup: ReportGroup = { id: uid(), name: `Group ${count + 1}`, page: currentPage };
    onChange({ groups: [...allGroups, newGroup] });
  }, [allGroups, currentPage, onChange]);

  const deleteGroup = useCallback((groupId: string) => {
    onChange({
      groups: allGroups.filter((g) => g.id !== groupId),
      elements: allElements.map((e) => e.groupId === groupId ? { ...e, groupId: undefined } : e),
    });
  }, [allGroups, allElements, onChange]);

  const renameGroup = useCallback((groupId: string, name: string) => {
    onChange({ groups: allGroups.map((g) => (g.id === groupId ? { ...g, name } : g)) });
  }, [allGroups, onChange]);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    onChange({ groups: allGroups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)) });
  }, [allGroups, onChange]);

  const moveToGroup = useCallback((elementId: string, groupId: string | null) => {
    setAllElements(allElements.map((e) =>
      e.id === elementId ? { ...e, groupId: groupId ?? undefined } : e,
    ));
  }, [allElements, setAllElements]);

  const moveGroupInLayout = useCallback((groupId: string, dir: 'up' | 'down') => {
    const pageEls = allElements.filter((e) => (e.page ?? 0) === currentPage);

    type TLItem = { kind: 'group'; id: string; yAnchor: number } | { kind: 'element'; id: string; yAnchor: number };
    const tl: TLItem[] = [
      ...currentGroups.map((g) => {
        const gEls = pageEls.filter((e) => e.groupId === g.id);
        return { kind: 'group' as const, id: g.id, yAnchor: gEls.length ? Math.min(...gEls.map((e) => e.y ?? 0)) : 9999 };
      }),
      ...pageEls.filter((e) => !e.groupId).map((e) => ({ kind: 'element' as const, id: e.id, yAnchor: e.y ?? 0 })),
    ].sort((a, b) => a.yAnchor - b.yAnchor);

    const idx = tl.findIndex((item) => item.kind === 'group' && item.id === groupId);
    if (idx === -1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= tl.length) return;

    const thisItem = tl[idx];
    const swapItem = tl[swapIdx];
    if (thisItem.yAnchor === 9999) return;

    const thisDelta = swapItem.yAnchor - thisItem.yAnchor;
    const swapDelta = thisItem.yAnchor - swapItem.yAnchor;

    const thisIds = pageEls.filter((e) => e.groupId === groupId).map((e) => e.id);
    const swapIds = swapItem.kind === 'group'
      ? pageEls.filter((e) => e.groupId === swapItem.id).map((e) => e.id)
      : [swapItem.id];

    setAllElements(allElements.map((e) => {
      if (thisIds.includes(e.id)) return { ...e, y: (e.y ?? 0) + thisDelta };
      if (swapIds.includes(e.id)) return { ...e, y: (e.y ?? 0) + swapDelta };
      return e;
    }));
  }, [allElements, currentGroups, currentPage, setAllElements]);

  // ── layout reordering ────────────────────────────────────────────────────

  const reorderLayout = useCallback((fromIdx: number, toIdx: number) => {
    const pageEls = allElements
      .filter((e) => (e.page ?? 0) === currentPage && !e.groupId)
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const clampedTo = Math.max(0, Math.min(toIdx, pageEls.length - 1));
    if (fromIdx === clampedTo || fromIdx < 0 || fromIdx >= pageEls.length) return;
    const yValues = pageEls.map((e) => e.y ?? 0);
    const newOrder = [...pageEls];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(clampedTo, 0, moved);
    const idToNewY = new Map(newOrder.map((e, i) => [e.id, yValues[i]]));
    setAllElements(allElements.map((e) => {
      const newY = idToNewY.get(e.id);
      return newY !== undefined ? { ...e, y: newY } : e;
    }));
  }, [allElements, currentPage, setAllElements]);

  const reorderInGroup = useCallback((groupId: string, fromIdx: number, toIdx: number) => {
    const groupEls = allElements
      .filter((e) => e.groupId === groupId)
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const clampedTo = Math.max(0, Math.min(toIdx, groupEls.length - 1));
    if (fromIdx === clampedTo || fromIdx < 0 || fromIdx >= groupEls.length) return;
    const yValues = groupEls.map((e) => e.y ?? 0);
    const newOrder = [...groupEls];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(clampedTo, 0, moved);
    const idToNewY = new Map(newOrder.map((e, i) => [e.id, yValues[i]]));
    setAllElements(allElements.map((e) => {
      const newY = idToNewY.get(e.id);
      return newY !== undefined ? { ...e, y: newY } : e;
    }));
  }, [allElements, setAllElements]);

  const renameElement = useCallback((id: string, name: string) => {
    const el = allElements.find((e) => e.id === id);
    if (!el) return;
    updateElement(id, { props: { ...el.props, _name: name || undefined } });
  }, [allElements, updateElement]);

  // ── table auto-pagination ────────────────────────────────────────────────

  const handleAutoPaginate = useCallback((elementId: string) => {
    const el = allElements.find((e) => e.id === elementId);
    if (!el || el.type !== 'table') return;
    autoLayoutSigRef.current = '';
    setAllElements(
      allElements.map((e) =>
        e.id === elementId
          ? { ...e, props: { ...e.props, autoPageBreak: true } }
          : e,
      ),
    );
    setSelectedId(null);
  }, [allElements, setAllElements]);

  const handleActualFit = useCallback((elementId: string, fitEnd: number) => {
    if (actualFitHintsRef.current[elementId] === fitEnd) return;
    actualFitHintsRef.current = { ...actualFitHintsRef.current, [elementId]: fitEnd };
    autoLayoutSigRef.current = '';
    const result = computeAutoLayout(templateRef.current, actualFitHintsRef.current);
    if (result) onChange({ pages: result.pages, elements: result.elements });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange]);

  // ── add element ──────────────────────────────────────────────────────────

  const addElement = useCallback((def: ElementDef) => {
    const newEl: ReportElement = {
      id: uid(), type: def.type, x: 40, y: 40,
      w: def.defaultSize.w, h: def.defaultSize.h,
      rotation: 0, zIndex: allElements.length,
      page: currentPage,
      props: { ...def.defaultProps },
    };
    setAllElements([...allElements, newEl]);
    setSelectedId(newEl.id);
  }, [allElements, currentPage, setAllElements]);

  // ── onPropsChange proxy ──────────────────────────────────────────────────

  const onPropsChange = useCallback((props: Record<string, unknown>) => {
    if (!selectedId) return;
    const el = allElements.find((e) => e.id === selectedId);
    if (!el) return;
    const { _x, _y, _w, _h, _rotation, ...rest } = props;
    const patch: Partial<ReportElement> = { props: rest };
    if (_x !== undefined)        patch.x        = _x as number;
    if (_y !== undefined)        patch.y        = _y as number;
    if (_w !== undefined)        patch.w        = _w as number;
    if (_h !== undefined)        patch.h        = _h as number;
    if (_rotation !== undefined) patch.rotation = _rotation as number;
    updateElement(selectedId, patch);
  }, [selectedId, allElements, updateElement]);

  // ── keyboard shortcuts ───────────────────────────────────────────────────
  // nudgeSelected is now stable (no allElements dep), so we access it via a
  // ref to avoid re-registering the window listener on every nudge.

  const nudgeSelectedRef = useRef(nudgeSelected);
  nudgeSelectedRef.current = nudgeSelected;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable = (e.target as HTMLElement).isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || isEditable) return;

      const ctrlKey = e.ctrlKey || e.metaKey;
      // Use ref so the handler always sees the latest selection without
      // needing to re-create the effect on every selection change.
      const ids = selectedIdsRef.current;

      // ── copy / paste / duplicate / delete / escape ───────────────────
      if (ctrlKey && e.key === 'c' && selectedId)    { e.preventDefault(); copyElement(selectedId); }
      if (ctrlKey && e.key === 'v')                   { e.preventDefault(); pasteElement(); }
      if (ctrlKey && e.key === 'd' && ids.length > 0) { e.preventDefault(); duplicateSelected(ids); }
      if (e.key === 'Delete' && ids.length > 0) {
        e.preventDefault();
        if (ids.length === 1) deleteElement(ids[0]);
        else deleteSelected(ids);
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        setEditingId(null);
        setShowShortcuts(false);
      }

      // ── zoom ─────────────────────────────────────────────────────────
      if (ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
      if (ctrlKey && e.key === '-')                     { e.preventDefault(); zoomOut(); }
      if (ctrlKey && e.key === '0')                     { e.preventDefault(); setScale(1); }

      // ── arrow-key nudge — works for single OR multi selection ────────
      //   Arrow → 1 px, Shift+Arrow → 10 px
      //   Single grouped element → nudges the entire group together.
      if (ids.length > 0 && !ctrlKey) {
        const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
                        e.key === 'ArrowUp'   || e.key === 'ArrowDown';
        if (isArrow) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          let nudgeIds = ids;
          if (ids.length === 1) {
            const elems = templateRef.current.elements ?? [];
            const el = elems.find((elem) => elem.id === ids[0]);
            if (el?.groupId) {
              nudgeIds = elems.filter((elem) => elem.groupId === el.groupId).map((elem) => elem.id);
            }
          }
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp'   ? -step : e.key === 'ArrowDown'  ? step : 0;
          nudgeSelectedRef.current(nudgeIds, dx, dy);
        }
      }

      // ── shortcut cheatsheet ──────────────────────────────────────────
      if (e.key === '?' && !ctrlKey) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedId,
    copyElement, pasteElement, duplicateSelected, deleteElement, deleteSelected,
    zoomIn, zoomOut, setSelectedId,
    // nudgeSelected intentionally omitted — accessed via nudgeSelectedRef above
  ]);

  // ── return ────────────────────────────────────────────────────────────────

  return {
    // selection
    selectedId, setSelectedId,
    selectedIds, setSelectedIds, toggleSelectId,
    editingId, setEditingId,
    // clipboard
    hasClipboard,
    // refs
    moveableRef,
    autoLayoutSigRef,
    actualFitHintsRef,
    resetLayoutSigs,
    // zoom
    scale, setScale, zoomIn, zoomOut,
    // snap / shortcuts
    snapGrid, setSnapGrid,
    showShortcuts, setShowShortcuts,
    // element mutations
    updateElement, updateElementBatch, deleteElement, copyElement, pasteElement,
    duplicateElement, alignElement, reorderElement, toggleLock, nudgeElement,
    // multi-element operations
    deleteSelected, duplicateSelected, alignSelected, groupSelected,
    // groups
    createGroup, deleteGroup, renameGroup, toggleGroupCollapse,
    moveToGroup, moveGroupInLayout, duplicateGroup, ungroupGroup,
    // layout
    reorderLayout, reorderInGroup, renameElement,
    // table pagination
    handleAutoPaginate, handleActualFit,
    // add & props
    addElement, onPropsChange,
  };
}
