import type { Config } from 'tailwindcss';
import preset from '@prism/ui/tailwind-preset';

/**
 * God Mode shares the product's theme (docs/plan/02-design-system.md): the same
 * 13px type scale, 30px controls, radii, and motion as web and space.
 *
 * The `canvas`/`surface`/`fg`/`line`/`brand` names below are admin's original
 * vocabulary, kept so its existing markup keeps compiling. globals.css now
 * aliases them onto the shared tokens, so both names paint the same colours —
 * new admin code should use the shared names (bg-card, text, border, accent).
 */
const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    // Include the shared UI package so its Tailwind classes are generated.
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          hover: 'var(--surface-hover)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          soft: 'var(--brand-soft)',
          fg: 'var(--brand-fg)',
        },
      },
      boxShadow: {
        card: 'var(--shadow)',
      },
      ringColor: {
        brand: 'var(--ring)',
      },
    },
  },
  plugins: [],
};
export default config;
