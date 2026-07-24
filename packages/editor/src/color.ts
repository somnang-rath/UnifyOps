/**
 * Deterministic per-user color for carets and presence avatars. The same `id`
 * always maps to the same swatch across peers, so a user's caret color is stable
 * for everyone in the room. Palette mirrors the web app's avatar colors.
 */
const PALETTE = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#f43f5e', // rose
] as const;

export function userColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}
