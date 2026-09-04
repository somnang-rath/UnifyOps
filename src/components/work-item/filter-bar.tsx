'use client';

import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { PRIORITIES } from '@/lib/priorities';
import { MAX_QUERY_LENGTH } from '@/lib/search';
import {
  customGroupBy,
  isGroupable,
  type CustomFieldKind,
} from '@/lib/custom-fields';
import {
  DUE_WINDOWS,
  PICKABLE_GROUP_BY,
  NONE,
  SORT_FIELDS,
  customFilterFor,
  hasActiveFilters,
  toQueryString,
  withCustomFilter,
  type CustomFilter,
  type WorkItemQuery,
} from '@/lib/work-item-query';

/** What the bar needs to know about a project's custom fields (§6-4). */
export type FilterField = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: { id: string; name: string }[];
};

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
  cycles = [],
  fields = [],
  showGroupBy = true,
  className,
}: {
  query: WorkItemQuery;
  states: readonly { id: string; name: string }[];
  people: readonly { memberId: string; name: string }[];
  labels: readonly { id: string; name: string }[];
  /**
   * The project's cycles (§7.6). Offered only where there are any, because a
   * control whose whole list is "Any" and "Backlog" is a control that teaches
   * somebody the product has a feature they cannot use yet.
   */
  cycles?: readonly { id: string; name: string }[];
  /** The project's custom fields (§6-4). One control each, chosen by kind. */
  fields?: readonly FilterField[];
  /**
   * False on a view that fixes its own grouping — the Table, which §12 draws as
   * one scrolling table, and the Calendar, which groups by day.
   *
   * Hidden rather than disabled, for the reason slice 10's field-kind select
   * gives: a disabled control invites somebody to go looking for the permission
   * that would enable it, when the real answer is that this view does not have
   * that choice to make. The board does the same thing by not rendering this
   * bar at all.
   */
  showGroupBy?: boolean;
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
      {/*
        §7.9's search, inside a list (slice 14) — and the reason `q` was added to
        the §9 DSL rather than given a query of its own. Everything this control
        needs already existed: the filter is a URL parameter, the builder has one
        branch for it, and the result pages, groups and sorts like any other
        list. A search written as a second query would have needed all four
        again, and would have been the first place "what is overdue" got two
        answers.

        Uncontrolled with a `defaultValue` keyed on the current text, and blur or
        Enter is what applies it. A controlled input rewriting the URL on every
        keystroke would remount this component mid-word and lose the caret —
        which is the palette's job anyway, on a debounce, with an abort.
      */}
      <Field label={t('search.label')}>
        <input
          key={query.filters.text ?? ''}
          type="search"
          defaultValue={query.filters.text ?? ''}
          placeholder={t('workItems.filters.searchPlaceholder')}
          maxLength={MAX_QUERY_LENGTH}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== (query.filters.text ?? '')) setFilter({ text: next || undefined });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className={cn(CONTROL, 'w-40')}
        />
      </Field>

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

      {cycles.length > 0 && (
        <Field label={t('workItems.filters.cycle')}>
          <select
            value={query.filters.cycleIds[0] ?? ''}
            onChange={(e) => setFilter({ cycleIds: one(e.target.value) })}
            className={CONTROL}
          >
            <option value="">{t('cycles.filter.any')}</option>
            {/* The backlog is a first-class choice, not the absence of one:
                "what is not planned into anything" is the question a sprint
                planning session opens with. */}
            <option value={NONE}>{t('cycles.filter.backlog')}</option>
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </select>
        </Field>
      )}

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
          {/* Every window except `soon`, which is not a choice a person can
              make here. It is §7.8's digest window and it takes a *horizon* —
              the workspace's next working day — which the DSL deliberately
              keeps out of the URL, because a company's next working day on one
              evening is not a question anybody would want frozen into a shared
              link. Offered in this bar it would resolve to `today` and mean
              exactly "overdue", which is a filter that lies about itself.

              Until slice 9 this list rendered it anyway and threw
              MISSING_MESSAGE for a key no catalogue has — visible only in the
              server log, because next-intl swallows it and renders nothing. */}
          {DUE_WINDOWS.filter((window) => window !== 'soon').map((window) => (
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

      {/* §6-4: "Filter, group, show in views." One control per field, and the
          kind chooses which — a select is a dropdown of its own options, a
          checkbox is yes/no, text asks what it contains, and a number or a date
          takes two bounds. Every one of them also offers "no value", because
          "which items has nobody filled this in for" is the question a company
          asks a fortnight after adding the field. */}
      {fields.map((field) => (
        <CustomFilterControl
          key={field.id}
          field={field}
          people={people}
          filter={customFilterFor(query, field.id)}
          onChange={(next) => apply(withCustomFilter(query, field.id, next))}
        />
      ))}

      <span className="ms-auto flex items-end gap-2">
        {showGroupBy && (
        <Field label={t('workItems.groupBy')}>
          <select
            value={query.groupBy}
            onChange={(e) => apply({ ...query, groupBy: e.target.value as WorkItemQuery['groupBy'] })}
            className={CONTROL}
          >
            {/* `PICKABLE_GROUP_BY` rather than `GROUP_BY`: `day` is the
                calendar's own grouping and is only finite because the calendar
                also fixes a month. Offered here it would ask the builder for a
                heading per day of an unbounded range. */}
            {PICKABLE_GROUP_BY.map((value) => (
              <option key={value} value={value}>
                {t(`workItems.groups.${value}`)}
              </option>
            ))}
            {/* Only the kinds with a knowable set of keys: §9's page query is
                handed its groups rather than discovering them, so a text field
                has nothing to hand it. See `GROUPABLE_KINDS`. */}
            {fields.filter((field) => isGroupable(field.kind)).map((field) => (
              <option key={field.id} value={customGroupBy(field.id)}>
                {field.name}
              </option>
            ))}
          </select>
        </Field>
        )}

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
                  cycleIds: [],
                  priorities: [],
                  blocked: undefined,
                  due: 'any',
                  text: undefined,
                  includeArchivedProjects: false,
                  custom: [],
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

/**
 * One custom field's control, chosen by its kind (§6-4).
 *
 * Single-select per filter, like every other control in this bar and for the
 * same reason: the DSL takes arrays and the builder ORs them, so multi-select
 * is a UI change once §12's Combobox exists. A range is the one control that
 * takes two inputs, and it applies as soon as either end is set — a filter that
 * waited for both would do nothing on "everything after March", which is the
 * more common half of the question.
 */
function CustomFilterControl({
  field,
  people,
  filter,
  onChange,
}: {
  field: FilterField;
  people: readonly { memberId: string; name: string }[];
  filter: CustomFilter | null;
  onChange: (next: CustomFilter | null) => void;
}) {
  const t = useTranslations();

  /** `''` clears; `set:0` and `set:1` are the two "no value"/"any value" choices. */
  const SET_NONE = 'set:0';
  const SET_ANY = 'set:1';

  const setSentinel = (value: string): CustomFilter | null =>
    value === SET_NONE
      ? { fieldId: field.id, op: 'set', value: false }
      : value === SET_ANY
        ? { fieldId: field.id, op: 'set', value: true }
        : null;

  /** What a `set` filter looks like in a select whose other options are ids. */
  const sentinelValue =
    filter?.op === 'set' ? (filter.value ? SET_ANY : SET_NONE) : undefined;

  const sentinelOptions = (
    <>
      <option value={SET_ANY}>{t('customFields.filterSet')}</option>
      <option value={SET_NONE}>{t('customFields.filterUnset')}</option>
    </>
  );

  switch (field.kind) {
    case 'select':
    case 'multi_select':
    case 'user': {
      const chosen = filter?.op === 'in' ? (filter.ids[0] ?? '') : '';
      const entries =
        field.kind === 'user'
          ? people.map((person) => ({ id: person.memberId, name: person.name }))
          : field.options;

      return (
        <Field label={field.name}>
          <select
            value={sentinelValue ?? chosen}
            onChange={(event) => {
              const value = event.target.value;
              if (value === SET_ANY || value === SET_NONE || value === '') {
                onChange(setSentinel(value));
                return;
              }
              onChange({ fieldId: field.id, op: 'in', ids: [value] });
            }}
            className={CONTROL}
          >
            <option value="">{t('customFields.filterAny')}</option>
            {sentinelOptions}
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
      );
    }

    case 'checkbox':
      return (
        <Field label={field.name}>
          <select
            value={filter?.op === 'is' ? (filter.value ? '1' : '0') : ''}
            onChange={(event) => {
              const value = event.target.value;
              onChange(
                value === '' ? null : { fieldId: field.id, op: 'is', value: value === '1' },
              );
            }}
            className={CONTROL}
          >
            <option value="">{t('customFields.filterAny')}</option>
            <option value="1">{t('customFields.valueYes')}</option>
            <option value="0">{t('customFields.valueNo')}</option>
          </select>
        </Field>
      );

    case 'text':
      return (
        <Field label={field.name}>
          <input
            type="search"
            // Uncontrolled between renders would fight the URL; controlled on
            // every keystroke would push a history entry per character. It
            // applies on blur or Enter, which is what a search input in a
            // filter bar is expected to do.
            defaultValue={filter?.op === 'has' ? filter.text : ''}
            placeholder={t('customFields.filterContains')}
            aria-label={`${field.name} — ${t('customFields.filterContains')}`}
            onBlur={(event) => {
              const text = event.target.value.trim();
              onChange(text ? { fieldId: field.id, op: 'has', text } : null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            className={cn(CONTROL, 'w-36')}
          />
        </Field>
      );

    case 'number':
    case 'date': {
      const from = filter?.op === 'range' ? filter.from : null;
      const to = filter?.op === 'range' ? filter.to : null;
      const inputType = field.kind === 'date' ? 'date' : 'number';

      const applyRange = (nextFrom: string | null, nextTo: string | null) =>
        onChange(
          nextFrom === null && nextTo === null
            ? null
            : { fieldId: field.id, op: 'range', from: nextFrom, to: nextTo },
        );

      return (
        <Field label={field.name}>
          <span className="flex items-center gap-1">
            <input
              type={inputType}
              step={field.kind === 'number' ? 'any' : undefined}
              defaultValue={from ?? ''}
              aria-label={`${field.name} — ${t('customFields.filterFrom')}`}
              onBlur={(event) => applyRange(event.target.value.trim() || null, to)}
              className={cn(CONTROL, 'w-28')}
            />
            <input
              type={inputType}
              step={field.kind === 'number' ? 'any' : undefined}
              defaultValue={to ?? ''}
              aria-label={`${field.name} — ${t('customFields.filterTo')}`}
              onBlur={(event) => applyRange(from, event.target.value.trim() || null)}
              className={cn(CONTROL, 'w-28')}
            />
          </span>
        </Field>
      );
    }
  }
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
