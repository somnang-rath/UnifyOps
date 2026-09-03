'use client';

import { useTranslations } from 'next-intl';
import { Ban } from 'lucide-react';
import { AvatarGroup } from '@/components/ui/avatar';
import { Link } from '@/i18n/navigation';
import type { ItemRowData, RowLabel, RowPerson } from '@/lib/work-item-row';
import { DueDate } from './due-date';
import { LabelChip } from './label-chip';
import { PriorityIcon } from './priority-icon';
import { StateSelect } from './state-select';
import type { ItemActionContext, StateOption } from './state-select';

/**
 * §12's item card, as a list row.
 *
 * "ID · title (2-line clamp **by grapheme, not character**) · assignee avatars ·
 * priority icon · due date · label chips · blocked badge · sub-item count."
 *
 * The clamp is CSS `line-clamp-2`, which is the grapheme-correct answer for the
 * visual case — `Intl.Segmenter` is for when a string is shortened in *data*,
 * and this one is not (§13). A Khmer title has no inter-word spaces, so it
 * breaks anywhere, and clamping is the only thing that keeps a row one row.
 *
 * The sub-item count is the one field of that list not drawn yet: nothing in
 * this slice creates a sub-item, so the count would be zero on every row. The
 * column and its trigger exist (§9); the badge lands with the UI that fills it.
 *
 * A client component, and that is a paging decision rather than an interaction
 * one. `GroupList` appends the next keyset page in place, and rows that arrive
 * from the route handler have to render through exactly the same component as
 * the ones the server rendered first — two implementations of a row is how a
 * list ends up looking different above and below the fold.
 */

export function ItemRow({
  context,
  item,
  states,
  people,
  labels,
  today,
  href,
  canEdit,
}: {
  context: ItemActionContext;
  item: ItemRowData;
  states: readonly StateOption[];
  /** Everyone in the page, so a row resolves its own assignees without a query. */
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  href: string;
  canEdit: boolean;
}) {
  const t = useTranslations();

  const byMember = new Map(people.map((person) => [person.memberId, person]));
  const assignees = item.assigneeIds
    .map((id) => byMember.get(id))
    .filter((person): person is RowPerson => person !== undefined);

  const byLabel = new Map(labels.map((row) => [row.id, row]));
  const chips = item.labelIds
    .map((id) => byLabel.get(id))
    .filter((row): row is RowLabel => row !== undefined);

  return (
    <li className="flex items-start gap-2 px-3 py-2 transition-colors duration-120 hover:bg-surface-hover">
      <StateSelect
        context={context}
        itemLabel={item.identifier}
        workItemId={item.id}
        stateId={item.stateId}
        states={states}
        disabled={!canEdit}
      />

      <PriorityIcon
        priority={item.priority}
        label={t('priority.label', { value: t(`priority.${item.priority}`) })}
        className="mt-1"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {/* Tabular so a column of identifiers lines up, and micro-scale
              because it is a reference people quote rather than read. */}
          <span className="shrink-0 text-2xs font-medium tabular-nums text-text-subtle">
            {item.identifier}
          </span>
          <Link
            href={href}
            className="line-clamp-2 min-w-0 text-sm font-medium text-text transition-colors duration-120 hover:text-accent"
          >
            {item.title}
          </Link>
        </div>

        {(chips.length > 0 || item.blocked) && (
          <div className="flex flex-wrap items-center gap-1">
            {item.blocked && (
              <span
                className="inline-flex items-center gap-1 rounded-xs border border-danger bg-danger-subtle px-1.5 py-0.5 text-2xs text-danger"
                // The reason is the whole value of the flag (§7.3) — a blocked
                // card nobody can unblock without asking is worse than none.
                title={item.blockedReason ?? undefined}
              >
                <Ban size={12} strokeWidth={1.5} aria-hidden />
                {t('workItems.blocked')}
              </span>
            )}
            {chips.map((chip) => (
              <LabelChip key={chip.id} name={chip.name} color={chip.color} />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <DueDate date={item.dueDate} today={today} completed={item.completed} />
        <AvatarGroup
          people={assignees.map((person) => ({ id: person.memberId, name: person.name }))}
          size="sm"
        />
      </div>
    </li>
  );
}
