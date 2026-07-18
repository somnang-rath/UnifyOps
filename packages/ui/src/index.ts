/**
 * @prism/ui — the design system for web, admin, and space
 * (docs/plan/02-design-system.md).
 *
 * Rules:
 * - Presentational only: no data fetching, no app stores, no routing.
 * - Every consumer uses `tailwind-preset.ts` + `tokens.css`, so a primitive
 *   looks the same in all three apps and changing it here changes all three.
 * - Component APIs match what apps/web already called, so adoption is a
 *   re-export rather than a migration.
 */

export { cn } from './cn';

// Tier 1 — primitives
export { Button, IconButton, buttonVariants } from './Button';
export type { ButtonProps, IconButtonProps } from './Button';

export { Input, Textarea, Field, InputWithIcon, SearchInput } from './Input';
export type { FieldProps } from './Input';

export {
  Badge,
  StateBadge,
  StateIcon,
  Avatar,
  AvatarGroup,
  Checkbox,
  Radio,
  Switch,
  Label,
  Kbd,
  Separator,
  Spinner,
  Tooltip,
} from './primitives';
export type {
  BadgeProps,
  AvatarProps,
  AvatarSize,
  SwitchProps,
  WorkItemState,
} from './primitives';

// Tier 2 — composites
export { Modal } from './Modal';
export type { ModalProps } from './Modal';
export { Tabs } from './Tabs';
export type { TabsProps, TabItem } from './Tabs';
export { Table, THead, TBody, TRow } from './Table';

// States
export { Skeleton, SkeletonText, EmptyState, ErrorState } from './states';
export type { SkeletonProps } from './states';

// Density — compact by default; `comfortable` is the opt-out.
export { DENSITIES, applyDensity } from './density';
export type { Density } from './density';
