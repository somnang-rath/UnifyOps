export const KB_COLORS = [
  { id: 'slate',  hex: '#94a3b8' },
  { id: 'red',    hex: '#ef4444' },
  { id: 'orange', hex: '#f97316' },
  { id: 'amber',  hex: '#f59e0b' },
  { id: 'green',  hex: '#10b981' },
  { id: 'blue',   hex: '#3b82f6' },
  { id: 'indigo', hex: '#6366f1' },
  { id: 'purple', hex: '#a855f7' },
  { id: 'pink',   hex: '#ec4899' },
] as const;

export const colorHex = (cid: string) =>
  (KB_COLORS.find((c) => c.id === cid) ?? KB_COLORS[0]).hex;

export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  collapsed?: boolean;
  builtin?: boolean;
  /** Optional WIP limit. When set, the column shows n/limit and tints red over. */
  wipLimit?: number | null;
}

export interface KanbanBoard {
  _id: string;
  userId: string;
  columns: BoardColumn[];
}
