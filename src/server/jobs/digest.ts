import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { appUrl } from '@/env';
import { emptyQuery } from '@/lib/work-item-query';
import type { CalendarDate } from '@/lib/workspace-date';
import { hourIn, todayIn } from '@/lib/workspace-date';
import { project, user, workspace, workspaceMember } from '@/server/db/schema';
import { withActor } from '@/server/db/tenant';
import { digestEmail } from '@/server/email/templates';
import type { DigestLine } from '@/server/email/templates';
import { sendMail } from '@/server/email/mailer';
import { fetchWorkItemPages } from '@/server/queries/work-items';
import { platformDb } from './client';
import { channelsFor } from './notify';

/**
 * The evening due-date digest (§7.8, §17-19).
 *
 * §17-19 is the finding this exists for: "Notifications covered mentions and
 * assignment, so the first time the product mentioned a due date was when the
 * item was already overdue and sitting in Needs Attention. A tracker reports; a
 * product warns."
 *
 * Three rules from §7.8 shape everything below, and each one is a decision that
 * would be easy to get wrong:
 *
 * 1. **One message per person per evening**, never one per item. "That is the
 *    fastest way to teach a team to filter the product's mail."
 * 2. **In the workspace timezone**, not the reader's. The same rule §17-13
 *    settled for "overdue" — a shared deadline has to mean one thing.
 * 3. **It moves off non-working days.** "When the next day is a non-working day
 *    or a workspace holiday it moves to the last working evening before, so
 *    nobody is reminded on Sunday about Monday."
 *
 * Rule 3 is implemented as its contrapositive, which is simpler and identical
 * in effect: **a digest only goes out on a working evening, and it covers work
 * due through the next working day.** Friday evening therefore carries Monday's
 * work across the weekend on its own, with no calendar arithmetic about "the
 * last working evening before" and no risk of two evenings both deciding they
 * are it.
 */

export const DIGEST_TICK_QUEUE = 'digest.tick';
export const DIGEST_WORKSPACE_QUEUE = 'digest.workspace';

/**
 * The hour, in the workspace's own timezone, that counts as "evening".
 *
 * A constant rather than a setting. §6-6 lists "digest scheduling" as
 * explicitly deferred to Phase 2, and a per-workspace hour is a settings
 * screen, a validation rule and a migration for something no one has asked for.
 */
export const DIGEST_HOUR = 18;

export type DigestJob = {
  workspaceId: string;
  /** The evening this digest is for, in the workspace's timezone. */
  localDate: CalendarDate;
};

/**
 * Hourly: which companies are having their evening right now?
 *
 * An hourly tick that asks every workspace, rather than a pg-boss schedule per
 * workspace with its own `tz`. Per-workspace schedules would have to be created
 * when a company signs up, updated when it changes timezone, and repaired
 * whenever either of those happened while the worker was down — and the failure
 * mode of a missed repair is a company that silently never gets a digest again.
 * One tick that reads the current state of the world has no such state to keep
 * in sync.
 *
 * Enumeration is the platform question §18-12's role exists for: it crosses
 * workspaces, reads nothing but settings, and cannot write.
 */
export async function tickDigests(boss: PgBoss, now: Date = new Date()): Promise<number> {
  const workspaces = await platformDb()
    .select({ id: workspace.id, timezone: workspace.timezone })
    .from(workspace)
    .where(isNull(workspace.deletedAt));

  let queued = 0;

  for (const row of workspaces) {
    if (hourIn(row.timezone, now) !== DIGEST_HOUR) continue;

    const localDate = todayIn(row.timezone, now);

    /**
     * One digest per workspace per local evening, however many times the tick
     * runs. A worker restart inside the hour, a second worker, or a retry all
     * arrive at the same key — and a company that gets two copies of the same
     * digest has learned the same lesson as one that gets forty emails.
     */
    await boss.send(
      DIGEST_WORKSPACE_QUEUE,
      { workspaceId: row.id, localDate } satisfies DigestJob,
      { singletonKey: `${row.id}:${localDate}` },
    );
    queued += 1;
  }

  return queued;
}

/**
 * One company's evening: work out whether tonight is a digest night, and send
 * one message to each person who has anything to read.
 */
export async function sendWorkspaceDigest(job: DigestJob): Promise<number> {
  const db = platformDb();

  const [company] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      /**
       * Both answers come from the SQL functions in migration 0016, not from
       * TypeScript. §9: "Staleness, the reminder digest, and cycle progress all
       * call it — three surfaces that must never disagree about whether Friday
       * counted." A second implementation here would be the first disagreement.
       */
      isWorkingDay: sql<boolean>`is_working_day(${workspace.id}, ${job.localDate}::date)`,
      horizon: sql<string | null>`next_working_day(${workspace.id}, ${job.localDate}::date)`,
    })
    .from(workspace)
    .where(and(eq(workspace.id, job.workspaceId), isNull(workspace.deletedAt)))
    .limit(1);

  if (!company) return 0;

  // Sunday evening. §7.8: nobody is reminded on Sunday about Monday — Friday
  // evening already carried Monday's work, because its horizon was Monday.
  if (!company.isWorkingDay) return 0;

  // No working day in the next two weeks. `next_working_day` gives up rather
  // than looping, and a digest with no horizon has no "due soon" to describe.
  if (!company.horizon) return 0;

  const members = await db
    .select({
      memberId: workspaceMember.id,
      userId: workspaceMember.userId,
      email: user.email,
      name: user.name,
      locale: user.locale,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, company.id), isNull(workspaceMember.deletedAt)));

  let sent = 0;

  for (const member of members) {
    const mailed = await digestFor({
      member,
      workspace: company,
      today: job.localDate,
      horizon: company.horizon,
    });
    if (mailed) sent += 1;
  }

  return sent;
}

/**
 * One person's digest, or nothing.
 *
 * Everything about this member's work is read **as that member**, through
 * `withActor` on the app connection. That is what makes §7.8's "each listing
 * only that person's own work" a property of the query rather than a filter
 * somebody remembered to write, and it is why an email cannot describe an item
 * its recipient could not open.
 */
async function digestFor(input: {
  member: { memberId: string; userId: string; email: string; name: string; locale: string };
  workspace: { id: string; name: string; slug: string };
  today: CalendarDate;
  horizon: CalendarDate;
}): Promise<boolean> {
  const { member } = input;

  const payload = await withActor(
    {
      workspaceId: input.workspace.id,
      userId: member.userId,
      actorUserId: member.userId,
      readOnly: false,
    },
    async (tx) => {
      const channels = await channelsFor(tx, member.memberId, 'digest');
      // §7.8: "One switch in per-user preferences turns it off."
      if (!channels.includes('email')) return null;

      /**
       * The §9 list query, not a query written beside it.
       *
       * Anchored by assignee, which is what `assertAnchored` requires and also
       * exactly what a personal digest means. `soon` is the window slice 9 added
       * to the DSL: open work due on or before the horizon, which is overdue and
       * due-next-working-day in one predicate and one ordering.
       *
       * Archived projects are excluded by the builder's default (§9), which is
       * right here: nobody needs an evening reminder about work in a project the
       * company has put away.
       */
      const query = emptyQuery();
      const pages = await fetchWorkItemPages(
        tx,
        {
          ...query,
          filters: { ...query.filters, assignees: [member.memberId], due: 'soon' },
          groupBy: 'none',
          sort: 'due',
          direction: 'asc',
        },
        { groupKeys: ['all'], today: input.today, horizon: input.horizon },
      );

      const rows = pages[0]?.rows ?? [];
      if (rows.length === 0) return null;

      // The slugs the deep links need. One query for the handful of projects
      // this person's due work actually touches.
      const projects = await tx
        .select({ id: project.id, slug: project.slug, key: project.key })
        .from(project);

      const slugOf = new Map(projects.map((row) => [row.id, row]));

      const lines: DigestLine[] = rows.flatMap((row) => {
        const owner = slugOf.get(row.projectId);
        if (!owner || row.dueDate === null) return [];
        return [
          {
            key: `${owner.key}-${row.number}`,
            title: row.title,
            dueDate: row.dueDate,
            url: `${appUrl().replace(/\/+$/, '')}/${member.locale}/${input.workspace.slug}/projects/${owner.slug}/${row.number}`,
          },
        ];
      });

      return lines;
    },
  );

  if (!payload || payload.length === 0) return false;

  /**
   * Split for reading, not for querying. §7.8 asks for "what is due tomorrow,
   * and what is already overdue" as two things a person scans differently — the
   * first is a plan for the morning, the second is a problem.
   */
  const overdue = payload.filter((line) => line.dueDate < input.today);
  const dueSoon = payload.filter((line) => line.dueDate >= input.today);

  const mail = digestEmail({
    locale: member.locale,
    workspaceName: input.workspace.name,
    overdue,
    dueSoon,
    url: `${appUrl().replace(/\/+$/, '')}/${member.locale}/${input.workspace.slug}`,
  });

  const result = await sendMail({ ...mail, to: member.email });
  if (!result.ok) throw new Error(`digest for ${member.userId}: ${result.error}`);

  return true;
}
