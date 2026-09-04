'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { planItemsAction } from '@/app/[locale]/[workspaceSlug]/projects/[projectSlug]/cycles/actions';

/**
 * §7.6 step two: "add items (multi-select from backlog, or drag)".
 *
 * This is the multi-select half. Dragging backlog cards onto a cycle is the
 * other, and it is not built: the board's drag is `moveWorkItem`, whose whole
 * contract is neighbour ids and a state change (slice 6), and teaching it a
 * second meaning would make one gesture do two different things depending on
 * where it was dropped. §7.6 offers either, and the multi-select is the one
 * that works with a keyboard, which §11's baseline requires of everything.
 *
 * **Checkboxes sharing one name, so the action reads them with `getAll`.** Not
 * §12's Combobox: a Combobox is a form control with *a* value, and this is a
 * set of independent yes/no answers over a visible list. A native checkbox
 * already carries the role, the keyboard behaviour and the label association —
 * the same argument slice 9 made for its notification preference grid.
 *
 * **All or nothing on submit.** A partial plan is worse than a refused one:
 * this shows a selection, and a result that silently moved nineteen of twenty
 * leaves somebody to work out which.
 *
 * §11's five states: `[L]` the Button's spinner · `[E]` an empty backlog says
 * the project has nothing unplanned, which is good news and reads as such ·
 * `[S]` the items leave this list on the next render, because they are no
 * longer in the backlog · `[X]` the error keeps every tick · `[!]` a long title
 * is clamped by grapheme through the same `line-clamp` the item card uses.
 */

export type PlannableItem = {
  id: string;
  identifier: string;
  title: string;
};

export function PlanItems({
  workspaceSlug,
  projectSlug,
  projectId,
  cycleId,
  backlog,
}: {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string;
  cycleId: string;
  backlog: readonly PlannableItem[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    planItemsAction,
    ROW_IDLE,
  );

  if (backlog.length === 0) {
    // Good news, and said as such (§11): a project with nothing unplanned is
    // a project whose backlog is clear, not a screen that failed to load.
    return <EmptyState title={t('cycles.plan.empty')} />;
  }

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="cycleId" value={cycleId} />

      {state.error && <Alert tone="danger">{t(state.error)}</Alert>}

      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface">
        {backlog.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-start gap-2.5 p-2.5 transition-colors duration-120 hover:bg-surface-hover">
              <input
                type="checkbox"
                name="workItemIds"
                value={item.id}
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block font-mono text-xs tabular-nums text-text-subtle">
                  {item.identifier}
                </span>
                {/* Clamped by line, which the browser does by grapheme — the
                    one truncation §13 gets for free rather than by hand. */}
                <span className="line-clamp-2 block text-sm text-text">{item.title}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={pending}
          disabled={selected.size === 0}
        >
          {t('cycles.plan.submit', { count: selected.size })}
        </Button>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t('cycles.plan.clear')}
          </Button>
        )}
      </div>
    </form>
  );
}
