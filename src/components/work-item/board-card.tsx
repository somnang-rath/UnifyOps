'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslations } from 'next-intl';
import { Ban, GripVertical } from 'lucide-react';
import { AvatarGroup } from '@/components/ui/avatar';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { ItemRowData, RowLabel, RowPerson } from '@/lib/work-item-row';
import { DueDate } from './due-date';
import { LabelChip } from './label-chip';
import { PriorityIcon } from './priority-icon';

/**
 * §12's item card, as a board card — the same fields as `ItemRow`, stacked
 * instead of in a line.
 *
 * **Two components rather than one, deliberately.** A row and a card share
 * their *content* and share nothing about their layout: a row puts the metadata
 * on one line and truncates the title to two, a card wraps the title to three
 * and puts the metadata underneath. One component with a `variant` prop would
 * be two layouts in one file behind a branch, and every future field would have
 * to be placed twice anyway. What they genuinely share — the shape of the data,
 * and the pieces that draw it — is shared: `ItemRowData`, `PriorityIcon`,
 * `LabelChip`, `DueDate`, `AvatarGroup`.
 *
 * **The whole card is not the drag handle.** A card is also a link to the item,
 * and a card that is entirely draggable is a card that is hard to click and
 * impossible to select text in. The handle is its own control, which is also
 * what makes the keyboard path work: `dnd-kit`'s `KeyboardSensor` needs a
 * focusable element to start from, and §11's baseline requires the whole
 * create → assign → move → comment loop without a mouse.
 */

export function BoardCard({
  item,
  people,
  labels,
  today,
  href,
  canDrag,
}: {
  item: ItemRowData;
  people: readonly RowPerson[];
  labels: readonly RowLabel[];
  today: string;
  href: string;
  canDrag: boolean;
}) {
  const t = useTranslations();

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: !canDrag });

  const byMember = new Map(people.map((person) => [person.memberId, person]));
  const assignees = item.assigneeIds
    .map((id) => byMember.get(id))
    .filter((person): person is RowPerson => person !== undefined);

  const byLabel = new Map(labels.map((row) => [row.id, row]));
  const chips = item.labelIds
    .map((id) => byLabel.get(id))
    .filter((row): row is RowLabel => row !== undefined);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/card rounded-sm border border-border bg-surface p-2.5 shadow-sm',
        // The card being dragged stays in the flow as a gap rather than
        // vanishing, so the column does not resize under the pointer.
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            {/* Tabular so a column of identifiers lines up, and micro-scale
                because it is a reference people quote rather than read. */}
            <span className="shrink-0 text-2xs font-medium tabular-nums text-text-subtle">
              {item.identifier}
            </span>
            <PriorityIcon
              priority={item.priority}
              label={t('priority.label', { value: t(`priority.${item.priority}`) })}
            />
          </div>

          <Link
            href={href}
            className="line-clamp-3 text-sm font-medium text-text transition-colors duration-120 hover:text-accent"
          >
            {item.title}
          </Link>

          {(chips.length > 0 || item.blocked) && (
            <div className="flex flex-wrap items-center gap-1">
              {item.blocked && (
                <span
                  className="inline-flex items-center gap-1 rounded-xs border border-danger bg-danger-subtle px-1.5 py-0.5 text-2xs text-danger"
                  // The reason is the whole value of the flag (§7.3).
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

          <div className="flex items-center gap-2">
            <DueDate date={item.dueDate} today={today} completed={item.completed} />
            <span className="ms-auto">
              <AvatarGroup
                people={assignees.map((person) => ({ id: person.memberId, name: person.name }))}
                size="sm"
              />
            </span>
          </div>
        </div>

        {canDrag && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={t('board.dragHandle', { identifier: item.identifier })}
            className={cn(
              'shrink-0 cursor-grab touch-none rounded-xs p-0.5 text-text-subtle',
              'transition-opacity duration-120 hover:text-text',
              // Always present for keyboard and touch; only *visible* on hover
              // or focus, so a quiet board is not a field of grip dots.
              'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100',
            )}
          >
            <GripVertical size={14} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}
