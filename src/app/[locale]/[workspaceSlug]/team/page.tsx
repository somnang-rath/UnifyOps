import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/feedback';
import { NeedsAttentionView } from '@/components/views/needs-attention-view';
import { StatusSummary } from '@/components/views/status-summary';
import { WorkloadView, type WorkloadPerson } from '@/components/views/workload-view';
import { resolveActorContext } from '@/server/auth/context';
import { listMembers } from '@/server/services/members';
import { listTeams } from '@/server/services/teams';
import { getNeedsAttention, getWorkload } from '@/server/services/workload';
import { STALE_WORKING_DAYS } from '@/lib/needs-attention';
import { summaryMarkdown } from '@/lib/status-summary';
import { toItemRowData } from '@/lib/work-item-row';
import { displayName } from '@/lib/seeded-name';
import { Link } from '@/i18n/navigation';
import { resolveWorkspaceScope } from '../project-map';

/**
 * §7.4's manager loop, on one screen (§14, slice 13).
 *
 * ```
 * My Work → Team switcher → group by ASSIGNEE
 *   each column headed by person + open count + overdue count
 *   → NEEDS ATTENTION tab: overdue · blocked · unassigned · no due date · stale
 *   → drag a card between people to reassign      (notifies both)
 *   → "Copy status summary" → markdown to clipboard
 *   → "Export"               → print layout → Save as PDF
 * ```
 *
 * Two tabs rather than two routes, because §7.4 draws them as one loop and both
 * read the same scope — the same team, the same projects, the same members. The
 * tab is a search param, so the URL is shareable exactly as §5 asks of every
 * other view state.
 *
 * **Every number on this page is derived** (§2.2), and none of it is a new
 * query: the workload is the §9 list query grouped by assignee, and Needs
 * Attention is five narrowings of it. `getWorkload` and `getNeedsAttention` each
 * run inside **one** transaction, which is the trap slice 8, 9 and 10 each hit
 * separately and which this screen would hit six times over.
 *
 * **§17-25 is the reason the screen is worth having.** Workload with no idea who
 * is on leave "was confidently wrong about the one person it mattered most
 * about" — so an away member's column carries their dates and is left out of the
 * capacity line above it.
 */
export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, workspaceSlug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveActorContext(workspaceSlug);
  if (!resolved) notFound();

  const search = await searchParams;
  const tab = first(search.tab) === 'attention' ? 'attention' : 'workload';
  const teamId = first(search.team);

  const [t, members, teams] = await Promise.all([
    getTranslations(),
    listMembers(resolved.context),
    listTeams(resolved.context),
  ]);

  // A `team=` naming a team that does not exist, or one the actor can see no
  // project of, resolves to an empty scope and the empty state — the same
  // tolerance §9's parser shows a filter it does not recognise, rather than an
  // error page for a link somebody pasted after a team was renamed away.
  const known = teams.some((team) => team.id === teamId) ? teamId : undefined;
  const scope = await resolveWorkspaceScope(resolved, t, { teamId: known });

  const workScope = { projectIds: scope.projectIds, staleDays: STALE_WORKING_DAYS };

  /**
   * Only the tab being shown is fetched.
   *
   * Both together would be seven round trips on a screen where one of them is
   * behind a link nobody has clicked yet — and the workload's are the expensive
   * ones, because they page rows rather than counting them.
   */
  const workload = tab === 'workload' ? await getWorkload(resolved, workScope, members) : null;
  const attention = tab === 'attention' ? await getNeedsAttention(resolved, workScope) : null;

  const projectSlugs = Object.fromEntries(
    [...scope.rowProjects].map(([id, project]) => [id, project.slug]),
  );

  /** Anybody may drag if they may edit somewhere; the server checks each item. */
  const canEdit = [...scope.rowProjects.values()].some((project) => project.canEdit);

  const columns: WorkloadPerson[] =
    workload?.columns.map((column) => ({
      key: column.key,
      name: column.member?.name.trim() || column.member?.email || t('workItems.filters.unassigned'),
      open: column.open,
      overdue: column.overdue,
      unavailableUntil: column.member?.unavailableUntil ?? null,
      unavailableReason: column.member?.unavailableReason ?? null,
      away: column.member?.away ?? false,
      items: column.items.map(toItemRowData),
    })) ?? [];

  const teamName = known
    ? displayName(
        teams.find((team) => team.id === known) ?? { name: '', nameKey: null },
        t,
      )
    : t('dashboards.allTeams');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="space-y-1">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
            {t('dashboards.teamTitle')}
          </h1>
          <p className="text-sm text-text-muted">
            {teamName} · {t('projects.count', { count: scope.projects.length })}
          </p>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-3 print:hidden">
          {/*
            §7.4's team switcher. Plain links rather than a select: the scope is
            part of the URL (§5), so it has to be shareable and back-buttonable,
            and a `<select>` that navigates is a control a keyboard user cannot
            preview before committing to.
          */}
          <nav aria-label={t('dashboards.teamSwitcher')} className="flex flex-wrap items-center gap-2 text-sm">
            <TeamLink
              href={`/${workspaceSlug}/team?tab=${tab}`}
              active={known === undefined}
              label={t('dashboards.allTeams')}
            />
            {teams.map((team) => (
              <TeamLink
                key={team.id}
                href={`/${workspaceSlug}/team?tab=${tab}&team=${team.id}`}
                active={known === team.id}
                label={displayName(team, t)}
              />
            ))}
          </nav>
        </div>
      </header>

      {/* Two tabs, as links. Same reasoning as the switcher above. */}
      <nav
        aria-label={t('dashboards.tabs')}
        className="flex items-center gap-1 border-b border-border print:hidden"
      >
        <TabLink
          href={`/${workspaceSlug}/team?tab=workload${known ? `&team=${known}` : ''}`}
          active={tab === 'workload'}
          label={t('dashboards.workload')}
        />
        <TabLink
          href={`/${workspaceSlug}/team?tab=attention${known ? `&team=${known}` : ''}`}
          active={tab === 'attention'}
          label={t('needsAttention.title')}
        />
      </nav>

      {scope.projects.length === 0 ? (
        <Alert>{t('dashboards.noProjects')}</Alert>
      ) : tab === 'workload' && workload ? (
        <div className="space-y-4">
          {/*
            §17-25's arithmetic, said out loud. The average is over the people who
            are **here**, which is the whole correction: a team of five with two
            away reads as comfortable at exactly the moment the three left are
            drowning.
          */}
          <p className="text-sm text-text-muted">
            {t('workload.capacity', {
              available: workload.capacity.available,
              open: workload.capacity.open,
              average: workload.capacity.averageOpen,
            })}
            {workload.capacity.away > 0 && (
              <> · {t('workload.awayCount', { count: workload.capacity.away })}</>
            )}
          </p>

          <StatusSummary
            markdown={summaryMarkdown({
              title: t('dashboards.teamTitle'),
              scope: teamName,
              columns,
              unassignedLabel: t('workItems.filters.unassigned'),
              awayLabel: (date: string) => t('availability.awayUntil', { date }),
              overdueLabel: (count: number) => t('workload.overdueCount', { count }),
              emptyLabel: t('needsAttention.clear'),
            })}
          />

          <WorkloadView
            workspaceSlug={workspaceSlug}
            columns={columns}
            people={workload.people.map((person) => ({
              memberId: person.memberId,
              name: person.name,
            }))}
            labels={workload.labels.map((label) => ({
              id: label.id,
              name: label.name,
              color: label.color,
            }))}
            today={workload.today}
            projectSlugs={projectSlugs}
            canEdit={canEdit}
          />
        </div>
      ) : attention ? (
        <NeedsAttentionView
          workspaceSlug={workspaceSlug}
          locale={locale}
          projects={scope.rowProjects}
          data={attention}
        />
      ) : null}
    </div>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function TeamLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={
        active
          ? 'rounded-xs bg-surface-sunken px-2 py-1 text-sm font-medium text-text'
          : 'rounded-xs px-2 py-1 text-sm text-text-muted transition-colors duration-120 hover:text-text'
      }
    >
      {label}
    </Link>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? '-mb-px border-b-2 border-accent px-3 py-2 text-sm font-medium text-text'
          : '-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-text-muted transition-colors duration-120 hover:text-text'
      }
    >
      {label}
    </Link>
  );
}
