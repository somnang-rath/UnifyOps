'use client';
/**
 * Moved to @prism/ui (docs/plan/02-design-system.md).
 *
 * Thin adapter kept so the `@/components/ui/tabs` call sites keep their
 * `onChange` prop name; the implementation — WAI-ARIA tab pattern, roving
 * tabindex, arrow-key navigation — comes from the shared package. The old
 * local pill styling maps to the package's `pill` variant.
 */
import { Tabs as UITabs } from '@prism/ui';

export type { TabItem } from '@prism/ui';

export function Tabs<V extends string>({
  value,
  onChange,
  items,
}: {
  value: V;
  onChange: (v: V) => void;
  items: { value: V; label: string; count?: number }[];
}) {
  return (
    <UITabs<V>
      value={value}
      onValueChange={onChange}
      items={items}
      variant="pill"
    />
  );
}
