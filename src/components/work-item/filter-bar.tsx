'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { PRIORITIES } from '@/lib/priorities';
import {
  DUE_WINDOWS,
  GROUP_BY,
  NONE,
  SORT_FIELDS,
  hasActiveFilters,
  toQueryString,
  type WorkItemQuery,
} from '@/lib/work-item-query';

/**
 * §12's FilterBar and GroupBySelect, over the §9 DSL.
 *
 * **The URL is the state.** §5: "Any view state is a URL. Paste it in chat and
 * a colleague sees exactly what you see." So every control here rewrites the
 * query string and lets the server re-render — there is no client-side filter
 * state to drift out of step with the address bar, and the back button works
 * because it is doing the only thing it ever does.
 *
 * The encoding is `toQueryString` from the same module the server parses with,
 * which is the reason that module lives in `src/lib` rather than `src/server`:
 * a filter this bar can express is a filter the server understands, by
 * construction rather than by agreement.
 *
 * **Single-select per filter, this slice.** The DSL takes arrays throughout and
 * the SQL builder ORs them, so multi-select is a UI change and not a data
 * change. What it needs is §12's Combobox — type-ahead above seven options,
 * chips with an overflow count, arrow keys — and that primitive is not built
 * yet. A native `<select>` is keyboard-operable, correct at 390px (§15-6), and
 * honest about what it does.
 */

export function FilterBar({
  query,
  states,
  people,
  labels,
  className,
}: {
  query: WorkItemQuery;
  states: readonly { id: string; name: string }[];
  people: readonly { memberId: string; name: string }[];
  labels: readonly { id: string; name: string }[];
  className?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();

  /** Rewrites the URL with one field replaced. Everything else is preserved. */
  function apply(next: WorkItemQuery) {
    router.replace(`${pathname}${toQueryString(next)}`);
  }

  const setFilter = (patch: Partial<WorkItemQuery['filters']>) =>
    apply({ ...query, filters: { ...query.filters, ...patch } });

  /** `''` is "no filter" in a native select; the DSL says that with an empty array. */
  const one = (value: string) => (value ? [value] : []);

  return (
    <div
      className={cn('flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface p-2', className)}
    >
      <Field label={t('workItems.filters.state')}>
        <select
          value={query.filters.stateIds[0] ?? ''}
          onChange={(e) => setFilter({ stateIds: one(e.target.value) })}
          className={CONTROL}
        >
          <option value="">{t('workItems.filters.any')}</option>
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('workItems.filters.assignee')}>
        <select
          value={query.filters.assignees[0] ?? ''}
          onChange={(e) => setFilter({ assignees: one(e.target.value) })}
          className={CONTROL}
        >
          <option value="">{t('workItems.filters.any')}</option>
          {/* One of §7.4's Needs Attention rows, so it is a first-class choice
              rather than something you reach by clearing a filter. */}
          <option value={NONE}>{t('workItems.filters.unassigned')}</option>
          {people.map((person) => (
            <option key={person.memberId} value={person.memberId}>
              {person.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('workItems.filters.label')}>
        <select
          value={query.filters.labels[0] ?? ''}
          onChange={(e) => setFilter({ labels: one(e.target.value) })}
          className={CONTROL}
        >
          <option value="">{t('workItems.filters.any')}</option>
          <option value={NONE}>{t('workItems.filters.unlabelled')}</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('workItems.filters.priority')}>
        <select
          value={query.filters.priorities[0] ?? ''}
          onChange={(e) =>
            setFilter({ priorities: one(e.target.value) as WorkItemQuery['filters']['priorities'] })
          }
          className={CONTROL}
        >
          <option value="">{t('workItems.filters.any')}</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {t(`priority.${priority}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('workItems.filters.due')}>
        <select
          value={query.filters.due}
          onChange={(e) => setFilter({ due: e.target.value as WorkItemQuery['filters']['due'] })}
          className={CONTROL}
        >
          {DUE_WINDOWS.map((window) => (
            <option key={window} value={window}>
              {t(`workItems.due.${window}`)}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('workItems.filters.blocked')}>
        <select
          value={query.filters.blocked === undefined ? '' : query.filters.blocked ? '1' : '0'}
          onChange={(e) =>
            setFilter({ blocked: e.target.value === '' ? undefined : e.target.value === '1' })
          }
          className={CONTROL}
        >
          <option value="">{t('workItems.filters.any')}</option>
          <option value="1">{t('workItems.filters.blockedOnly')}</option>
          <option value="0">{t('workItems.filters.notBlocked')}</option>
        </select>
      </Field>

      <span className="ms-auto flex items-end gap-2">
        <Field label={t('workItems.groupBy')}>
          <select
            value={query.groupBy}
            onChange={(e) => apply({ ...query, groupBy: e.target.value as WorkItemQuery['groupBy'] })}
            className={CONTROL}
          >
            {GROUP_BY.map((value) => (
              <option key={value} value={value}>
                {t(`workItems.groups.${value}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('workItems.sortBy')}>
          <select
            value={query.sort}
            onChange={(e) => apply({ ...query, sort: e.target.value as WorkItemQuery['sort'] })}
            className={CONTROL}
          >
            {SORT_FIELDS.map((value) => (
              <option key={value} value={value}>
                {t(`workItems.sorts.${value}`)}
              </option>
            ))}
          </select>
        </Field>

        {hasActiveFilters(query) && (
          <button
            type="button"
            onClick={() =>
              apply({
                ...query,
                filters: {
                  ...query.filters,
                  stateIds: [],
                  stateGroups: [],
                  assignees: [],
                  labels: [],
                  priorities: [],
                  blocked: undefined,
                  due: 'any',
                  includeArchivedProjects: false,
                },
              })
            }
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-xs text-text-muted transition-colors duration-120 hover:bg-surface-hover hover:text-text"
          >
            <X size={14} strokeWidth={1.5} aria-hidden />
            {t('workItems.filters.clear')}
          </button>
        )}
      </span>
    </div>
  );
}

const CONTROL =
  'h-8 rounded-sm border border-border bg-surface px-2 text-xs text-text transition-colors duration-120 hover:bg-surface-hover';

/** §12: the label sits above the control at 12px. Placeholders are never labels. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs text-text-subtle">{label}</span>
      {children}
    </label>
  );
}
