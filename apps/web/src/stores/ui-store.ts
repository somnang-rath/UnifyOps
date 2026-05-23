import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  notifsOpen: boolean;
  userMenuOpen: boolean;

  toggleSidebar: () => void;
  setPalette: (open: boolean) => void;
  setNotifs: (open: boolean) => void;
  setUserMenu: (open: boolean) => void;
}

const persisted =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('pr_sb_collapsed') === '1'
    : false;

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: persisted,
  paletteOpen: false,
  notifsOpen: false,
  userMenuOpen: false,

  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('pr_sb_collapsed', next ? '1' : '0');
      }
      return { sidebarCollapsed: next };
    }),
  setPalette: (open) => set({ paletteOpen: open }),
  setNotifs: (open) => set({ notifsOpen: open }),
  setUserMenu: (open) => set({ userMenuOpen: open }),
}));
