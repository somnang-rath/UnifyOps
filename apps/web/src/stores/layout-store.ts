import { create } from 'zustand';

/**
 * Editor pane layout — a binary split tree, the same model VSCode uses.
 *
 * A `leaf` renders one route's content. A `split` holds exactly two children
 * laid out in a `row` (side by side) or `col` (stacked), with fractional sizes
 * that sum to 1. Splitting the active leaf wraps it in a split node; closing a
 * leaf collapses its parent split back to the sibling.
 */
export type SplitDir = 'row' | 'col';

export type PaneNode =
  | { type: 'leaf'; id: string; route: string }
  | {
      type: 'split';
      id: string;
      dir: SplitDir;
      children: [PaneNode, PaneNode];
      sizes: [number, number];
    };

export interface LayoutState {
  root: PaneNode;
  activePaneId: string;

  splitActive: (where: 'right' | 'down', route?: string) => void;
  closePane: (id: string) => void;
  setActive: (id: string) => void;
  setRoute: (id: string, route: string) => void;
  resize: (splitId: string, sizes: [number, number]) => void;
  reset: () => void;
  /** True when more than one pane is open. */
  isSplit: () => boolean;
  /** Leaf pane ids in visual (left→right, top→bottom) order. */
  paneOrder: () => string[];
}

let seq = 0;
const nextId = () => `pane_${Date.now().toString(36)}_${seq++}`;

const leaf = (route: string): PaneNode => ({ type: 'leaf', id: nextId(), route });

/** Depth-first find of a leaf by id. */
function findLeaf(node: PaneNode, id: string): (PaneNode & { type: 'leaf' }) | null {
  if (node.type === 'leaf') return node.id === id ? node : null;
  return findLeaf(node.children[0], id) ?? findLeaf(node.children[1], id);
}

/** First leaf in the tree (used as a fallback active pane). */
function firstLeaf(node: PaneNode): PaneNode & { type: 'leaf' } {
  return node.type === 'leaf' ? node : firstLeaf(node.children[0]);
}

/** Immutably map over the tree, replacing whatever `fn` returns for each node. */
function transform(node: PaneNode, fn: (n: PaneNode) => PaneNode): PaneNode {
  const mapped = fn(node);
  if (mapped.type === 'leaf') return mapped;
  return {
    ...mapped,
    children: [
      transform(mapped.children[0], fn),
      transform(mapped.children[1], fn),
    ],
  };
}

/** Replace the leaf `id` with `replacement`, without descending into the replacement. */
function replaceLeaf(node: PaneNode, id: string, replacement: PaneNode): PaneNode {
  if (node.type === 'leaf') return node.id === id ? replacement : node;
  return {
    ...node,
    children: [
      replaceLeaf(node.children[0], id, replacement),
      replaceLeaf(node.children[1], id, replacement),
    ],
  };
}

/** Remove the leaf `id`, collapsing its parent split into the surviving sibling. */
function removeLeaf(node: PaneNode, id: string): PaneNode {
  if (node.type === 'leaf') return node;
  const [a, b] = node.children;
  if (a.type === 'leaf' && a.id === id) return removeLeaf(b, id);
  if (b.type === 'leaf' && b.id === id) return removeLeaf(a, id);
  return { ...node, children: [removeLeaf(a, id), removeLeaf(b, id)] };
}

/** Collect leaf ids in visual order (depth-first, left/top child first). */
function collectLeaves(node: PaneNode, acc: string[]): void {
  if (node.type === 'leaf') {
    acc.push(node.id);
    return;
  }
  collectLeaves(node.children[0], acc);
  collectLeaves(node.children[1], acc);
}

/* ------------------------------- Persistence ------------------------------- */

const LS_KEY = 'pr_editor_layout';

/** Persist the layout, but only while split — a single `__current__` leaf is the
 *  default and never worth storing. */
function save(root: PaneNode, activePaneId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (root.type === 'leaf') localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify({ root, activePaneId }));
  } catch {
    /* ignore quota / serialization errors */
  }
}

function load(): { root: PaneNode; activePaneId: string } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { root?: PaneNode; activePaneId?: string };
    if (parsed?.root && parsed.activePaneId) {
      return { root: parsed.root, activePaneId: parsed.activePaneId };
    }
  } catch {
    /* corrupt value — fall back to default */
  }
  return null;
}

const restored = load();
const initialRoot = restored?.root ?? leaf('__current__');
const initialActive = restored?.activePaneId ?? initialRoot.id;

export const useLayoutStore = create<LayoutState>((set, get) => ({
  root: initialRoot,
  activePaneId: initialActive,

  splitActive: (where, route) =>
    set((s) => {
      const target = findLeaf(s.root, s.activePaneId) ?? firstLeaf(s.root);
      const dir: SplitDir = where === 'right' ? 'row' : 'col';
      const newLeaf = leaf(route ?? target.route);
      const split: PaneNode = {
        type: 'split',
        id: nextId(),
        dir,
        children: [target, newLeaf],
        sizes: [0.5, 0.5],
      };
      const root = replaceLeaf(s.root, target.id, split);
      save(root, newLeaf.id);
      return { root, activePaneId: newLeaf.id };
    }),

  closePane: (id) =>
    set((s) => {
      if (s.root.type === 'leaf') return s; // never close the last pane
      // The live pane hosts the app's real route — closing it would leave the
      // route with nowhere to render, so refuse.
      if (findLeaf(s.root, id)?.route === '__current__') return s;
      const root = removeLeaf(s.root, id);
      const active = findLeaf(root, s.activePaneId)?.id ?? firstLeaf(root).id;
      save(root, active);
      return { root, activePaneId: active };
    }),

  setActive: (id) =>
    set((s) => {
      save(s.root, id);
      return { activePaneId: id };
    }),

  setRoute: (id, route) =>
    set((s) => {
      const root = transform(s.root, (n) =>
        n.type === 'leaf' && n.id === id ? { ...n, route } : n,
      );
      save(root, s.activePaneId);
      return { root };
    }),

  resize: (splitId, sizes) =>
    set((s) => {
      const root = transform(s.root, (n) =>
        n.type === 'split' && n.id === splitId ? { ...n, sizes } : n,
      );
      save(root, s.activePaneId);
      return { root };
    }),

  reset: () => {
    const root = leaf('__current__');
    save(root, root.id);
    set({ root, activePaneId: root.id });
  },

  isSplit: () => get().root.type === 'split',

  paneOrder: () => {
    const acc: string[] = [];
    collectLeaves(get().root, acc);
    return acc;
  },
}));
