import { create } from 'zustand';

interface UIState {
  /** Sidebar shrunk to an icon rail (existing behavior). */
  sidebarCollapsed: boolean;
  /** Sidebar fully hidden off-screen — VSCode's "Toggle Primary Side Bar" (Ctrl+B). */
  sidebarHidden: boolean;
  paletteOpen: boolean;
  notifsOpen: boolean;
  userMenuOpen: boolean;

  toggleSidebar: () => void;
  toggleSidebarVisibility: () => void;
  setSidebarHidden: (hidden: boolean) => void;
  setPalette: (open: boolean) => void;
  setNotifs: (open: boolean) => void;
  setUserMenu: (open: boolean) => void;
}

const read = (key: string) =>
  typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';

const write = (key: string, on: boolean) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, on ? '1' : '0');
  }
};

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: read('pr_sb_collapsed'),
  sidebarHidden: read('pr_sb_hidden'),
  paletteOpen: false,
  notifsOpen: false,
  userMenuOpen: false,

  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      write('pr_sb_collapsed', next);
      return { sidebarCollapsed: next };
    }),
  toggleSidebarVisibility: () =>
    set((s) => {
      const next = !s.sidebarHidden;
      write('pr_sb_hidden', next);
      return { sidebarHidden: next };
    }),
  setSidebarHidden: (hidden) => {
    write('pr_sb_hidden', hidden);
    set({ sidebarHidden: hidden });
  },
  setPalette: (open) => set({ paletteOpen: open }),
  setNotifs: (open) => set({ notifsOpen: open }),
  setUserMenu: (open) => set({ userMenuOpen: open }),
}));
