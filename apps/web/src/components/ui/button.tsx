/**
 * Moved to @prism/ui (docs/plan/02-design-system.md).
 *
 * This file stays as a re-export so the many `@/components/ui/button` imports
 * keep working; the implementation — and the compact sizing — now comes from
 * the package that admin and space also use.
 */
export { Button, IconButton, buttonVariants } from '@prism/ui';
export type { ButtonProps, IconButtonProps } from '@prism/ui';
