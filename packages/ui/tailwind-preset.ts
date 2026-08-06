import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

/**
 * `text-red` (our token) and `text-red-500` (Tailwind's scale) must both work.
 * Assigning a bare string to `colors.red` replaces the whole palette object and
 * silently deletes every numbered shade — which is exactly how the first cut of
 * this preset broke `text-indigo-600` in apps/space.
 */
const withDefault = <T extends Record<string, string>>(
  palette: T,
  fallback: string,
) => ({ ...palette, DEFAULT: fallback });

/**
 * The single Tailwind theme for web, admin, and space (docs/plan/02-design-system.md).
 *
 * Consumers spread this as a preset and add only app-specific extras:
 *
 *     import preset from '@prism/ui/tailwind-preset';
 *     export default { presets: [preset], content: [...] } satisfies Config;
 *
 * Values live in CSS variables (see tokens.css) wherever a theme or the density
 * switch needs to change them at runtime; everything fixed is inlined here.
 *
 * Density: this is a tool for people who look at it all day. Controls are 30px,
 * not 40px; the base size is 13px, not 16px; radii are 6px, not 10px. Compact by
 * default, `data-density="comfortable"` for those who want air.
 */
const preset = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [],
  theme: {
    extend: {
      colors: {
        // Accent (driven by [data-accent])
        accent: {
          DEFAULT: 'var(--a)',
          50: 'var(--a-50)',
          100: 'var(--a-100)',
          200: 'var(--a-200)',
          400: 'var(--a-400)',
          500: 'var(--a-500)',
          600: 'var(--a-600)',
          700: 'var(--a-700)',
        },
        // Static palette: our brand shade as DEFAULT (`text-red`), Tailwind's
        // numbered scale kept intact (`text-red-500`).
        violet: withDefault(colors.violet, '#8b5cf6'),
        indigo: withDefault(colors.indigo, '#6366f1'),
        blue: withDefault(colors.blue, '#3b82f6'),
        cyan: withDefault(colors.cyan, '#06b6d4'),
        green: withDefault(colors.emerald, '#10b981'),
        amber: withDefault(colors.amber, '#f59e0b'),
        red: withDefault(colors.red, '#ef4444'),
        pink: withDefault(colors.pink, '#ec4899'),
        rose: withDefault(colors.rose, '#f43f5e'),
        // Surfaces
        bg: 'var(--bg)',
        'bg-card': 'var(--bg-card)',
        'bg-input': 'var(--bg-input)',
        'bg-hover': 'var(--bg-hover)',
        'bg-subtle': 'var(--bg-subtle)',
        'bg-code': 'var(--bg-code)',
        text: 'var(--text)',
        'text-sub': 'var(--text-sub)',
        'text-muted': 'var(--text-muted)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        // Semantic (status + feedback)
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
        // Work-item states, mirroring Plane's vocabulary
        state: {
          backlog: 'var(--state-backlog)',
          unstarted: 'var(--state-unstarted)',
          started: 'var(--state-started)',
          completed: 'var(--state-completed)',
          cancelled: 'var(--state-cancelled)',
        },
      },

      backgroundImage: {
        grad: 'var(--grad)',
        'grad-soft': 'var(--grad-soft)',
      },

      /**
       * Tightened from 10/14/20. Large radii read as "consumer app"; a dense
       * tool wants corners you barely notice.
       */
      borderRadius: {
        xs: '3px',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        full: '9999px',
      },

      /** Base is 13px: the size everything else is judged against. */
      fontSize: {
        micro: ['10px', '14px'],
        '2xs': ['11px', '15px'],
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['13px', '18px'],
        md: ['14px', '20px'],
        lg: ['16px', '22px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', '32px'],
      },

      /** Control heights, driven by CSS vars so density can shift them. */
      height: {
        'ctl-xs': 'var(--ctl-xs)',
        'ctl-sm': 'var(--ctl-sm)',
        'ctl-md': 'var(--ctl-md)',
        'ctl-lg': 'var(--ctl-lg)',
        row: 'var(--row-h)',
        topbar: 'var(--topbar-h)',
      },
      minHeight: {
        'ctl-xs': 'var(--ctl-xs)',
        'ctl-sm': 'var(--ctl-sm)',
        'ctl-md': 'var(--ctl-md)',
        'ctl-lg': 'var(--ctl-lg)',
      },

      spacing: {
        // 4pt grid additions
        1.5: '6px',
        2.5: '10px',
        3.5: '14px',
        // App shell
        sb: 'var(--sidebar-w)',
        'sb-collapsed': 'var(--sidebar-collapsed-w)',
        tb: 'var(--topbar-h)',
        'tb-compact': 'var(--topbar-h)',
        peek: 'var(--peek-w)',
      },

      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        a: 'var(--shadow-a)',
        // The only focus treatment. Every interactive element uses this one.
        focus: '0 0 0 2px var(--bg), 0 0 0 4px var(--a-400)',
      },

      fontFamily: {
        /**
         * One stack for both scripts, not a stack per locale (ADR 0016 §2.8).
         * Inter has no Khmer glyphs, so Khmer text falls through to Kantumruy
         * Pro — which all three root layouts already load as `--font-khmer` and
         * which, until this line existed, nothing in the UI could reach.
         * Mixed-script strings ("Sprint ១២ — Acme") are normal here; swapping
         * whole stacks per locale would render those in two fonts.
         */
        sans: [
          'var(--font-sans)',
          'Inter',
          'var(--font-khmer)',
          '"Kantumruy Pro"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['var(--font-mono)', '"JetBrains Mono"', 'var(--font-khmer)', 'monospace'],
      },

      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      /** 120ms: fast enough that a dense UI feels immediate, slow enough to read. */
      transitionDuration: { DEFAULT: '120ms' },

      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        modalIn: {
          from: { opacity: '0', transform: 'scale(.98) translateY(4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        popoverIn: {
          from: { opacity: '0', transform: 'scale(.98) translateY(-3px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        sheetIn: {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'fade-in': 'fadeIn 120ms cubic-bezier(0.4,0,0.2,1)',
        'slide-up': 'slideUp 120ms cubic-bezier(0.4,0,0.2,1)',
        'modal-in': 'modalIn 160ms cubic-bezier(0.16,1,0.3,1)',
        'sheet-in': 'sheetIn 160ms cubic-bezier(0.16,1,0.3,1)',
        'popover-in': 'popoverIn 120ms cubic-bezier(0.16,1,0.3,1)',
        'toast-in': 'toastIn 160ms cubic-bezier(0.16,1,0.3,1)',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;

export default preset;
