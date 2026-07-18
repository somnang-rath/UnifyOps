import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type Accent =
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'rose'
  | 'amber'
  | 'emerald'
  | 'cyan'
  | 'blue';
export type Density = 'comfy' | 'compact';

interface ThemeState {
  theme: Theme;
  accent: Accent;
  density: Density;
  setTheme: (t: Theme) => void;
  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
}

const apply = (k: string, v: string) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(`data-${k}`, v);
  try {
    localStorage.setItem(`pr_${k}`, v);
  } catch {}
};

const read = <T extends string>(k: string, def: T): T => {
  if (typeof document === 'undefined') return def;
  return (
    (document.documentElement.getAttribute(`data-${k}`) as T | null) ?? def
  );
};

export const useThemeStore = create<ThemeState>((set) => ({
  theme: read<Theme>('theme', 'dark'),
  accent: read<Accent>('accent', 'indigo'),
  // Compact is the default (docs/plan/02-design-system.md §2.4): this is a tool
  // people keep open all day, and more rows on screen is the point. `comfy`
  // restores the roomier pre-v2 metrics for anyone who prefers them.
  density: read<Density>('density', 'compact'),
  setTheme: (theme) => {
    apply('theme', theme);
    set({ theme });
  },
  setAccent: (accent) => {
    apply('accent', accent);
    set({ accent });
  },
  setDensity: (density) => {
    apply('density', density);
    set({ density });
  },
}));
