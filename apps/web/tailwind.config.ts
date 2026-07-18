import type { Config } from 'tailwindcss';
import preset from '@prism/ui/tailwind-preset';

/**
 * The theme itself lives in @prism/ui/tailwind-preset — colours, the 13px type
 * scale, control heights, radii, motion — so web, admin, and space cannot drift
 * apart (docs/plan/02-design-system.md).
 *
 * Only web-specific extras belong here.
 */
const config: Config = {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    // The primitives live in the package; Tailwind must scan them or their
    // classes get tree-shaken out of this app's stylesheet.
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/editor/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        float: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(40px,-30px) scale(1.05)' },
          '66%': { transform: 'translate(-30px,40px) scale(.95)' },
        },
      },
      animation: {
        float: 'float 18s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
