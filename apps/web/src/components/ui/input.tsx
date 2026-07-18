/**
 * Moved to @prism/ui (docs/plan/02-design-system.md).
 *
 * Re-export only, so existing `@/components/ui/input` imports keep working.
 * `Field` now wires aria-invalid/aria-describedby onto its child — an error was
 * previously rendered beside the input without ever being announced.
 */
export { Input, Textarea, Field, InputWithIcon, SearchInput } from '@prism/ui';
export type { FieldProps } from '@prism/ui';
