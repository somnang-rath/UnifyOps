import type { Config } from 'tailwindcss';
import preset from '@prism/ui/tailwind-preset';

/**
 * The public Space uses the same theme as web and admin (docs/plan/02) — a
 * published page should look like it came from the product, because it did.
 */
const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  plugins: [],
};
export default config;
