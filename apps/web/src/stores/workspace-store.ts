import { create } from 'zustand';

/**
 * The current workspace (ADR 0006). Holds the id only — the full record comes
 * from the `['workspaces']` query, so there is one source of truth for the data
 * and this store just remembers the selection across reloads.
 *
 * Phase 2 (`/[workspaceSlug]/...`) makes the URL authoritative; this store then
 * becomes the fallback for routes that aren't workspace-scoped.
 *
 * Read it through `useCurrentWorkspace()` (hooks/use-workspaces.ts), which
 * reconciles the persisted id against the workspaces the user can actually see.
 */
const KEY = 'pr_ws_current';

const read = () =>
  typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;

const write = (id: string | null) => {
  if (typeof localStorage === 'undefined') return;
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
};

interface WorkspaceState {
  currentId: string | null;
  setCurrent: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  // Starts null so SSR and the first client render agree; useCurrentWorkspace
  // hydrates from localStorage after mount.
  currentId: null,
  setCurrent: (id) => {
    write(id);
    set({ currentId: id });
  },
}));

/** The persisted selection, read directly. Client-only. */
export const readPersistedWorkspaceId = read;
