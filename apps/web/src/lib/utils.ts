// Canonical Tailwind-aware `cn` now lives in @prism/ui and is shared across
// web, admin, and space. Re-exported here so the 80+ `@/lib/utils` call sites
// stay unchanged.
export { cn, type ClassValue } from '@prism/ui/cn';
