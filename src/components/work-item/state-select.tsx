'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { StateColor } from '@/lib/state-groups';
import { setWorkItemStateAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/actions';

/**
 * §7.3's one click: "click a state pill to advance an item (one click,
 * optimistic)".
 *
 * A native `<select>` under a coloured dot, rather than a popover menu. It is
 * keyboard-operable for free (§11's baseline asks for the whole create → assign
 * → move → comment loop without a mouse), it is the correct control on a phone
 * where §15-6 puts every screen at 390px, and it needs no dependency. The
 * §12 Combobox — type-ahead above seven options, chips, arrow keys — is the
 * primitive for the day a project has thirty states; six do not need it.
 *
 * **Optimistic** (§5, §11): the dot and the value move on click and the request
 * follows. If the server refuses — permission lost, project archived while the
 * tab sat open, item deleted — React discards the optimistic value on its own
 * and the message below says why. §11 asks an error to be plain language that
 * says what to do next; the sentence is a key, translated like every other
 * (§13).
 */

export type StateOption = {
  id: string;
  /** Already resolved through `displayName` — a seeded state renders translated (§13). */
  name: string;
  color: StateColor;
};

const DOT: Record<StateColor, string> = {
  ink: 'bg-state-ink',
  sky: 'bg-state-sky',
  navy: 'bg-state-navy',
  warning: 'bg-state-warning',
  success: 'bg-state-success',
  danger: 'bg-state-danger',
};

/** Where the action has to look the actor up again. A request, never an authorization. */
export type ItemActionContext = {
  workspaceSlug: string;
  projectSlug: string;
  locale: string;
};

export function StateSelect({
  context,
  itemLabel,
  workItemId,
  stateId,
  states,
  disabled,
  className,
}: {
  context: ItemActionContext;
  /** The item's human identifier, so fifty of these are fifty distinct controls. */
  itemLabel: string;
  workItemId: string;
  stateId: string;
  states: readonly StateOption[];
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticStateId, setOptimisticStateId] = useOptimistic(stateId);

  const current = states.find((state) => state.id === optimisticStateId) ?? states[0];

  function change(nextStateId: string) {
    startTransition(async () => {
      setOptimisticStateId(nextStateId);
      setError(null);

      const result = await setWorkItemStateAction({
        ...context,
        workItemId,
        stateId: nextStateId,
      });
      // The optimistic value is discarded by React when the transition ends, so
      // there is nothing to roll back by hand — only something to say.
      if (result?.error) setError(result.error);
    });
  }

  return (
    <span className={cn('relative mt-0.5 inline-flex shrink-0 items-center', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-s-2 size-2 rounded-full',
          DOT[current?.color ?? 'ink'],
        )}
      />
      <select
        // Named for the item, not just "State": there is one of these per row,
        // and a screen reader reading fifty controls all called "State" — one
        // of which is the filter bar's — cannot tell them apart. Neither can a
        // test, which is how this was found.
        aria-label={t('workItems.stateOf', { item: itemLabel })}
        value={optimisticStateId}
        disabled={disabled || pending}
        onChange={(event) => change(event.target.value)}
        className={cn(
          'h-6 w-32 appearance-none rounded-xs border border-transparent bg-transparent ps-6 pe-1 text-xs text-text transition-colors duration-120',
          'hover:border-border hover:bg-surface',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
      >
        {states.map((state) => (
          <option key={state.id} value={state.id}>
            {state.name}
          </option>
        ))}
      </select>

      {/* Announced when it appears, and only then — §11's error state, in the
          row it belongs to rather than a toast that outlives the context. */}
      {error && (
        <span role="alert" className="absolute top-full inset-s-6 z-10 text-2xs text-danger">
          {t(error)}
        </span>
      )}
    </span>
  );
}
