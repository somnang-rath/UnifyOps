import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HolidayEditor } from '@/components/settings/holiday-editor';
import { Alert } from '@/components/ui/feedback';
import { horizonYears, seedRowsFor } from '@/lib/holidays';
import { todayIn } from '@/lib/workspace-date';
import { resolveActorContext } from '@/server/auth/context';
import { can } from '@/server/authz/policy';
import { getHolidayCalendar, holidayDatesIn } from '@/server/services/holidays';

/**
 * §6-1's holiday calendar, and the screen §18-10 asked for.
 *
 * §6 calls this "the cheapest of the four and the one this market cannot do
 * without", and §4 is blunt about the failure it prevents: "A holiday calendar
 * the company cannot edit is worse than none — it is confidently wrong."
 *
 * The page computes what a seed *would* add before offering the button, which
 * costs one extra query over the horizon's dates and is what lets the button
 * name its own consequence. Every member can read the calendar — it explains
 * why their work is not stale on the Monday after Pchum Ben — and
 * `workspace.settings` writes it.
 */
export default async function HolidaySettingsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const [t, calendar] = await Promise.all([
    getTranslations(),
    getHolidayCalendar(resolved),
  ]);

  const canManage = can(resolved.actor, 'workspace.settings');

  const years = horizonYears(todayIn(resolved.workspace.timezone));
  const candidates = years.flatMap((year) =>
    seedRowsFor(resolved.workspace.timezone, year, resolved.workspace.defaultLocale),
  );

  // What is already there, so the button can say "add 7" rather than "add 10"
  // and then quietly do nothing about three of them.
  const present = await holidayDatesIn(
    resolved,
    candidates.map((row) => row.date),
  );

  const seedableYears = years.map((year) => ({
    year,
    wouldAdd: candidates.filter(
      (row) => row.date.startsWith(`${year}-`) && !present.has(row.date),
    ).length,
  }));

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {t('settings.sections.holidays')}
        </h2>
        <p className="text-sm text-text-muted">{t('settings.holidays.subtitle')}</p>
      </header>

      {!canManage && <Alert>{t('settings.readOnly')}</Alert>}

      <HolidayEditor
        workspaceSlug={workspaceSlug}
        holidays={calendar.holidays}
        emptyYears={calendar.emptyYears}
        moveable={calendar.moveable}
        seedableYears={seedableYears}
        canManage={canManage}
      />
    </div>
  );
}
