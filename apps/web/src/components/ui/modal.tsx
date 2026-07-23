/**
 * Moved to @prism/ui (docs/plan/02-design-system.md).
 *
 * This file stays as a re-export so the many `@/components/ui/modal` imports
 * keep working; the implementation — focus trap, Escape, ARIA labelling,
 * body scroll lock — now comes from the package that admin also uses.
 */
export { Modal } from '@prism/ui';
export type { ModalProps } from '@prism/ui';
