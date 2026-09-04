'use client';

import { useActionState, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import type { MoveableHoliday } from '@/lib/holidays';
import {
  addHolidayAction,
  removeHolidayAction,
  seedHolidaysAction,
} from '@/app/[locale]/[workspaceSlug]/settings/holidays/actions';

/**
 * §6-1's holiday calendar, and the visible half of §18-10's answer.
 *
 * Three things on this screen are not decoration:
 *
 * - **The warning when a year has no rows.** §18-10: "surface a warning in
 *   Settings when the calendar runs out." It fires on emptiness, not on
 *   incompleteness — a company that keeps four days off a year is not wrong,
 *   and a product that nags them about the other seventeen is one they stop
 *   reading.
 * - **The moveable holidays, listed and undated.** This is the part that would
 *   be easy to leave out and is the whole point: Khmer New Year, Pchum Ben and
 *   Water Festival move with the lunar calendar, and a seed that guessed them
 *   would make the calendar *look* complete while being wrong for the fortnight
 *   that matters most. Named here, they are somebody's five-minute job; omitted,
 *   they are a bug report next April.
 * - **The seed button says how many rows it will add**, before the click. §7.11
 *   makes that rule for a destructive action; it is worth just as much for a
 *   bulk additive one.
 */

export type HolidayRow = {
  id: string;
  date: string;
  name: string;
};

export function HolidayEditor({
  workspaceSlug,
  holidays,
  emptyYears,
  moveable,
  seedableYears,
  canManage,
}: {
  workspaceSlug: string;
  holidays: HolidayRow[];
  emptyYears: number[];
  moveable: readonly MoveableHoliday[];
  /** Years inside the horizon, with how many rows a seed would add to each. */
  seedableYears: { year: number; wouldAdd: number }[];
  canManage: boolean;
}) {
  const t = useTranslations('settings.holidays');
  const locale = useLocale();

  const byYear = new Map<number, HolidayRow[]>();
  for (const holiday of holidays) {
    const year = Number(holiday.date.split('-')[0]);
    byYear.set(year, [...(byYear.get(year) ?? []), holiday]);
  }

  const years = [...new Set([...byYear.keys(), ...seedableYears.map((entry) => entry.year)])].sort(
    (a, b) => a - b,
  );

  return (
    <div className="space-y-6">
      {emptyYears.length > 0 && (
        <Alert tone="warning">
          {t('emptyYears', {
            years: emptyYears.join(', '),
            count: emptyYears.length,
          })}
        </Alert>
      )}

      {canManage && <AddHoliday workspaceSlug={workspaceSlug} locale={locale} />}

      {years.length === 0 ? (
        <EmptyState title={t('empty.title')} />
      ) : (
        years.map((year) => {
          const rows = byYear.get(year) ?? [];
          const seedable = seedableYears.find((entry) => entry.year === year);

          return (
            <section key={year} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold tracking-tight">{year}</h3>

                {canManage && seedable && seedable.wouldAdd > 0 && (
                  <SeedButton
                    workspaceSlug={workspaceSlug}
                    locale={locale}
                    year={year}
                    wouldAdd={seedable.wouldAdd}
                  />
                )}
              </div>

              {rows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-text-subtle">
                  {t('noneThisYear')}
                </p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
                  {rows.map((holiday) => (
                    <li
                      key={holiday.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                    >
                      {/* Latin digits are pinned for both locales in
                          `src/i18n/request.ts`, and a date is one string that
                          must never become ០១២៣ in a task list (§13). This is a
                          machine date rendered as-is rather than through a
                          formatter, so it is the same in both scripts. */}
                      <span className="w-24 shrink-0 font-mono text-xs text-text-muted">
                        {holiday.date}
                      </span>
                      <span className="min-w-0 flex-1 break-words">{holiday.name}</span>
                      {canManage && (
                        <RemoveHoliday
                          workspaceSlug={workspaceSlug}
                          locale={locale}
                          holidayId={holiday.id}
                          name={holiday.name}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}

      {moveable.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-sm font-semibold tracking-tight">
            {t('moveable.title')}
          </h3>
          <p className="text-sm text-text-muted">{t('moveable.description')}</p>

          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface-sunken">
            {moveable.map((holiday) => (
              <li
                key={holiday.key}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
              >
                <span className="font-medium">{holiday.name[locale === 'km' ? 'km' : 'en']}</span>
                <span className="text-xs text-text-subtle">
                  {holiday.around[locale === 'km' ? 'km' : 'en']}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AddHoliday({ workspaceSlug, locale }: { workspaceSlug: string; locale: string }) {
  const t = useTranslations('settings.holidays');
  const tRoot = useTranslations();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    addHolidayAction,
    ROW_IDLE,
  );
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  return (
    <form
      action={(formData) => {
        action(formData);
        // Cleared optimistically: the row appears in the list above on
        // revalidation, so leaving the typed values in the fields would invite
        // somebody to submit the same day twice and meet the duplicate error.
        setDate('');
        setName('');
      }}
      className="space-y-3 rounded-md border border-border bg-surface p-3"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

      {state.error && <Alert tone="danger">{tRoot(state.error)}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <InputField
            label={t('date')}
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </div>
        <div className="min-w-48 flex-1">
          <InputField
            label={t('name')}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            help={t('nameHelp')}
          />
        </div>
        <Button type="submit" loading={pending}>
          {t('add')}
        </Button>
      </div>
    </form>
  );
}

function RemoveHoliday({
  workspaceSlug,
  locale,
  holidayId,
  name,
}: {
  workspaceSlug: string;
  locale: string;
  holidayId: string;
  name: string;
}) {
  const t = useTranslations('settings.holidays');
  const [, action, pending] = useActionState<RowActionState, FormData>(
    removeHolidayAction,
    ROW_IDLE,
  );

  return (
    <form action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="holidayId" value={holidayId} />
      <Button type="submit" variant="ghost" size="sm" loading={pending}>
        {/* Named, not just "Remove": this list is a column of near-identical
            rows, and an icon-only or bare-worded control in one of them is the
            classic way somebody deletes the day above the one they meant. */}
        {t('remove', { name })}
      </Button>
    </form>
  );
}

function SeedButton({
  workspaceSlug,
  locale,
  year,
  wouldAdd,
}: {
  workspaceSlug: string;
  locale: string;
  year: number;
  wouldAdd: number;
}) {
  const t = useTranslations('settings.holidays');
  const [, action, pending] = useActionState<RowActionState, FormData>(
    seedHolidaysAction,
    ROW_IDLE,
  );

  return (
    <form action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
      <input type="hidden" name="year" value={String(year)} />
      <Button type="submit" size="sm" loading={pending}>
        {t('seed', { count: wouldAdd })}
      </Button>
    </form>
  );
}
