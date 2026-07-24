import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ProjectAccessService } from '../projects/access/project-access.service';
import {
  ANALYTICS_RANGE_WEEKS,
  AnalyticsQuery,
  AnalyticsRange,
  AnalyticsTrendPoint,
  WorkspaceAnalytics,
} from './dto/workspace-analytics.dto';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `d`. */
function utcMonday(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      daysSinceMonday * 24 * 60 * 60 * 1000,
  );
}

type FacetRow = {
  totals: { _id: null; open: number; completed: number; overdue: number }[];
  byState: { _id: string | null; count: number }[];
  byPriority: { _id: string | null; count: number }[];
  byAssignee: { _id: Types.ObjectId | null; count: number }[];
  trendCreated: { _id: Date; n: number }[];
  trendCompleted: { _id: Date; n: number }[];
};

/**
 * Workspace-scoped issue analytics (Phase 8 follow-up).
 *
 * Tenancy (ADRs 0003–0006): every pipeline starts from the set of project ids
 * that belong to the workspace — issues are reached only through
 * `projectId ∈ workspace.projects`, so numbers can never cross the tenant
 * boundary. Personal issues (`projectId: null`) belong to no workspace and are
 * deliberately out of scope.
 *
 * Classification matches the rest of the app (issues list tabs, dashboard):
 * completed = `status === 'done'`; open = anything else; overdue = open with a
 * real `dueDate` in the past. The Issue schema has no `completedAt`, so the
 * trend's "completed" series buckets done issues by `updatedAt` — the same
 * proxy the dashboard's done-this-week KPI uses.
 */
@Injectable()
export class WorkspaceAnalyticsService {
  constructor(
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private access: ProjectAccessService,
  ) {}

  async forWorkspace(
    userId: string,
    workspaceId: string,
    q: AnalyticsQuery,
  ): Promise<WorkspaceAnalytics> {
    // Tenant gate first — 404 (never 403) for a non-member, per module convention.
    await this.access.assertWorkspaceMember(userId, workspaceId);

    // The workspace boundary: only this workspace's projects.
    const wid = new Types.ObjectId(workspaceId);
    const rows = await this.projectModel
      .find({ workspaceId: wid }, { _id: 1 })
      .lean();
    let projectIds = rows.map((r) => r._id);

    if (q.projectId) {
      // A projectId outside the workspace 404s — same response as "absent",
      // so it can't be used to probe another tenant.
      const requested = projectIds.find((id) => String(id) === q.projectId);
      if (!requested) throw new NotFoundException();
      projectIds = [requested];
    }

    const weeks = ANALYTICS_RANGE_WEEKS[q.range];
    const rangeStart = new Date(
      utcMonday(new Date()).getTime() - (weeks - 1) * WEEK_MS,
    );

    if (projectIds.length === 0) return this.empty(q.range);

    const now = new Date();
    const week = (field: string) => ({
      $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday' },
    });
    // `$lt: [missing, date]` is true in aggregation expressions (missing ≡ null,
    // and null sorts before dates), so overdue must require an actual date.
    const hasDueDate = { $eq: [{ $type: '$dueDate' }, 'date'] };
    const isDone = { $eq: ['$status', 'done'] };
    const notDone = { $ne: ['$status', 'done'] };

    const [facet] = await this.issueModel.aggregate<FacetRow>([
      // Tenant boundary — every facet below inherits this $match.
      { $match: { projectId: { $in: projectIds } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                open: { $sum: { $cond: [notDone, 1, 0] } },
                completed: { $sum: { $cond: [isDone, 1, 0] } },
                overdue: {
                  $sum: {
                    $cond: [
                      {
                        $and: [notDone, hasDueDate, { $lt: ['$dueDate', now] }],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          byState: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
          byPriority: [
            { $group: { _id: '$priority', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
          ],
          byAssignee: [
            {
              $group: {
                _id: { $ifNull: ['$assigneeId', null] },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ],
          trendCreated: [
            { $match: { createdAt: { $gte: rangeStart } } },
            { $group: { _id: week('$createdAt'), n: { $sum: 1 } } },
          ],
          trendCompleted: [
            { $match: { status: 'done', updatedAt: { $gte: rangeStart } } },
            { $group: { _id: week('$updatedAt'), n: { $sum: 1 } } },
          ],
        },
      },
    ]);

    // Resolve assignee names in one query — no N+1.
    const assigneeIds = facet.byAssignee
      .map((b) => b._id)
      .filter((id): id is Types.ObjectId => id !== null);
    const users = assigneeIds.length
      ? await this.userModel
          .find({ _id: { $in: assigneeIds } }, { name: 1 })
          .lean()
      : [];
    const nameById = new Map(users.map((u) => [String(u._id), u.name]));

    const totals = facet.totals[0] ?? { open: 0, completed: 0, overdue: 0 };

    return {
      totals: {
        open: totals.open,
        completed: totals.completed,
        overdue: totals.overdue,
      },
      byState: facet.byState.map((b) => ({
        key: b._id ?? 'unknown',
        count: b.count,
      })),
      byPriority: facet.byPriority.map((b) => ({
        key: b._id ?? 'unknown',
        count: b.count,
      })),
      byAssignee: facet.byAssignee.map((b) => ({
        key: b._id ? String(b._id) : 'unassigned',
        name: b._id
          ? (nameById.get(String(b._id)) ?? 'Unknown user')
          : 'Unassigned',
        count: b.count,
      })),
      trend: this.zeroFilledTrend(
        rangeStart,
        weeks,
        facet.trendCreated,
        facet.trendCompleted,
      ),
    };
  }

  /** N consecutive week buckets from `rangeStart`, zero-filled where empty. */
  private zeroFilledTrend(
    rangeStart: Date,
    weeks: number,
    created: { _id: Date; n: number }[],
    completed: { _id: Date; n: number }[],
  ): AnalyticsTrendPoint[] {
    const key = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const createdBy = new Map(created.map((r) => [key(r._id), r.n]));
    const completedBy = new Map(completed.map((r) => [key(r._id), r.n]));
    const out: AnalyticsTrendPoint[] = [];
    for (let i = 0; i < weeks; i++) {
      const weekStart = key(new Date(rangeStart.getTime() + i * WEEK_MS));
      out.push({
        weekStart,
        created: createdBy.get(weekStart) ?? 0,
        completed: completedBy.get(weekStart) ?? 0,
      });
    }
    return out;
  }

  /** Workspace with no projects: all zeros, but the trend is still shaped. */
  private empty(range: AnalyticsRange): WorkspaceAnalytics {
    const weeks = ANALYTICS_RANGE_WEEKS[range];
    const rangeStart = new Date(
      utcMonday(new Date()).getTime() - (weeks - 1) * WEEK_MS,
    );
    return {
      totals: { open: 0, completed: 0, overdue: 0 },
      byState: [],
      byPriority: [],
      byAssignee: [],
      trend: this.zeroFilledTrend(rangeStart, weeks, [], []),
    };
  }
}
