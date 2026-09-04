import { getTranslations } from 'next-intl/server';
import { CrossProjectRows, MoreItemsNote, type RowProject } from '@/components/views/cross-project-rows';
import type { NeedsAttention } from '@/server/services/workload';

/**
 * §7.4's Needs Attention tab: "overdue · blocked · unassigned · no due date ·
 * stale (>N days)".
 *
 * §2.2 is the reason it exists at all — "no honest picture of team load, only
 * who complains loudest" — and §2.2's answer is that **manager views are
 * derived, never assembled**. Nothing maintains this list. Five narrowings of
 * the §9 query, run against the projects in scope.
 *
 * **The rows overlap and that is deliberate**, argued at `getNeedsAttention`: an
 * item can be overdue and blocked and unassigned, and it appears under all
 * three, because every precedence order that picks one reason is wrong for
 * somebody.
 *
 * §11's five states:
 *
 *   `[L]` Server-rendered.
 *   `[E]` §7.4's own: "nothing needs attention → explicit 'Nothing needs your
 *         attention' **confirmation** state". Not a shrug and not an absence —
 *         a manager who opens this and sees nothing has been told something.
 *   `[S]` A state pill on a row advances it in place; the row stays where it is
 *         until the page is rebuilt, which is honest — it *was* overdue.
 *   `[X]` A refusal lands in the row that caused it (§11), not in a toast.
 *   `[!]` A row caps at ten and says so against the real total; a section with
 *         nothing in it is dropped rather than drawn empty, because five
 *         headings with four blank reads as failure.
 */

export async function NeedsAttentionView({
  workspaceSlug,
  locale,
  projects,
  data,
}: {
  workspaceSlug: string;
  locale: string;
  projects: ReadonlyMap<string, RowProject>;
  data: NeedsAttention;
}) {
  const t = await getTranslations();

  const active = data.sections.filter((section) => section.total > 0);

  if (active.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-border bg-surface px-4 py-8 text-center">
        <p className="text-sm font-medium text-text">{t('needsAttention.clear')}</p>
        <p className="mt-1 text-sm text-text-muted">{t('needsAttention.clearHint')}</p>
      </section>
    );
  }

  /**
   * The heading, once — used both as the section's accessible name and as the
   * text in it.
   *
   * The stale row takes a parameter (§4 counts **working** days, so "stale"
   * without a number is a judgement nobody can check), and computing the label
   * in two places is how one of them ends up rendering the raw placeholder. The
   * other four take none, which `t` tolerates but this keeps explicit.
   */
  const headingOf = (row: (typeof data.sections)[number]['row']) =>
    row === 'stale'
      ? t('needsAttention.row.stale', { days: data.staleDays })
      : t(`needsAttention.row.${row}`);

  return (
    <div className="space-y-3">
      {active.map((section) => (
        <section
          key={section.row}
          aria-label={headingOf(section.row)}
          className="overflow-hidden rounded-md border border-border bg-surface"
        >
          <header className="flex items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
            <span
              className={
                section.row === 'overdue' || section.row === 'blocked'
                  ? 'text-sm font-medium text-danger'
                  : 'text-sm font-medium text-text'
              }
            >
              {headingOf(section.row)}
            </span>
            <span className="text-2xs font-medium tabular-nums text-text-subtle">
              {section.total}
            </span>
          </header>

          <CrossProjectRows
            workspaceSlug={workspaceSlug}
            locale={locale}
            projects={projects}
            items={section.items}
            people={data.people}
            labels={data.labels}
            today={data.today}
          />

          <MoreItemsNote shown={section.items.length} total={section.total} />
        </section>
      ))}
    </div>
  );
}
