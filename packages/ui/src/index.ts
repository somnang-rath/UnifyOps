/**
 * @prism/ui — shared, presentational React components for web, admin, space.
 *
 * Rules: components are presentational only (no data fetching, no app-specific
 * stores). Consumers provide Tailwind. Extract more primitives out of
 * apps/web/src/components incrementally during Phase 0.
 */

export { cn } from './cn';
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Skeleton, EmptyState, ErrorState } from './states';
