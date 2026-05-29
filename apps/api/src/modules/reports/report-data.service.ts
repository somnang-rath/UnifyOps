import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

export type DataWidgetType =
  | 'issues_total'
  | 'issues_open'
  | 'issues_done'
  | 'issues_overdue'
  | 'issues_by_status'
  | 'issues_table'
  | 'projects_total'
  | 'projects_list'
  | 'users_total'
  | 'users_by_department'
  | 'date_label';

export interface WidgetData {
  type: DataWidgetType;
  value?: number | string;
  label?: string;
  trend?: number;
  trendLabel?: string;
  series?: { name: string; value: number; color?: string }[];
  rows?: Record<string, string | number>[];
  columns?: string[];
}

const CHART_COLORS = [
  '#6366f1', '#f59e0b', '#22c55e', '#ef4444',
  '#06b6d4', '#ec4899', '#f97316', '#8b5cf6',
];

const STATUS_COLOR: Record<string, string> = {
  todo: '#94a3b8',
  open: '#6366f1',
  'in progress': '#f59e0b',
  doing: '#f59e0b',
  done: '#22c55e',
  closed: '#9ca3af',
  blocked: '#ef4444',
  cancelled: '#9ca3af',
};

@Injectable()
export class ReportDataService {
  constructor(
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async getWidgetData(type: DataWidgetType): Promise<WidgetData> {
    switch (type) {
      case 'issues_total': {
        const count = await this.issueModel.countDocuments();
        return { type, value: count, label: 'Total Issues' };
      }

      case 'issues_open': {
        const count = await this.issueModel.countDocuments({ status: { $ne: 'done' } });
        return { type, value: count, label: 'Open Issues' };
      }

      case 'issues_done': {
        const count = await this.issueModel.countDocuments({ status: 'done' });
        return { type, value: count, label: 'Completed Issues' };
      }

      case 'issues_overdue': {
        const count = await this.issueModel.countDocuments({
          dueDate: { $lt: new Date() },
          status: { $ne: 'done' },
        });
        return { type, value: count, label: 'Overdue Issues' };
      }

      case 'issues_by_status': {
        const agg = await this.issueModel.aggregate<{ _id: string; count: number }>([
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]);
        const series = agg.map((s, i) => ({
          name: s._id,
          value: s.count,
          color: STATUS_COLOR[s._id.toLowerCase()] ?? CHART_COLORS[i % CHART_COLORS.length],
        }));
        return { type, label: 'Issues by Status', series };
      }

      case 'issues_table': {
        const issues = await this.issueModel
          .find()
          .sort({ updatedAt: -1 })
          .limit(10)
          .populate<{ assigneeId: { name: string } | null }>('assigneeId', 'name')
          .lean();
        const rows = issues.map((i) => ({
          Title: i.title,
          Status: i.status,
          Assignee: (i.assigneeId as unknown as { name?: string } | null)?.name ?? '—',
          'Due Date': i.dueDate
            ? new Date(i.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—',
        }));
        return {
          type,
          label: 'Recent Issues',
          columns: ['Title', 'Status', 'Assignee', 'Due Date'],
          rows,
        };
      }

      case 'projects_total': {
        const count = await this.projectModel.countDocuments();
        return { type, value: count, label: 'Active Projects' };
      }

      case 'projects_list': {
        const projects = await this.projectModel.find().lean();
        const issueStats = await this.issueModel.aggregate<{
          _id: string;
          total: number;
          done: number;
        }>([
          { $match: { projectId: { $exists: true, $ne: null } } },
          {
            $group: {
              _id: { $toString: '$projectId' },
              total: { $sum: 1 },
              done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
            },
          },
        ]);
        const statsMap = Object.fromEntries(issueStats.map((s) => [s._id, s]));
        const rows = projects.map((p) => {
          const stats = statsMap[String(p._id)];
          const progress = stats?.total ? Math.round((stats.done / stats.total) * 100) : 0;
          const status = progress >= 80 ? 'On Track' : progress >= 40 ? 'In Progress' : 'Starting';
          return { Name: p.name, Progress: progress, Status: status };
        });
        return {
          type,
          label: 'Project Progress',
          columns: ['Name', 'Progress', 'Status'],
          rows,
        };
      }

      case 'users_total': {
        const count = await this.userModel.countDocuments({ blocked: false });
        return { type, value: count, label: 'Team Members' };
      }

      case 'users_by_department': {
        const agg = await this.userModel.aggregate<{ _id: string; count: number }>([
          { $match: { blocked: false } },
          { $group: { _id: { $ifNull: ['$department', 'Other'] }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]);
        const series = agg.map((d, i) => ({
          name: d._id,
          value: d.count,
          color: CHART_COLORS[i % CHART_COLORS.length],
        }));
        return { type, label: 'Team by Department', series };
      }

      case 'date_label': {
        const value = new Date().toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        return { type, value, label: 'Report Period' };
      }

      default:
        return { type, value: 0, label: 'Unknown Widget' };
    }
  }

  async getAllData(): Promise<Record<DataWidgetType, WidgetData>> {
    const types: DataWidgetType[] = [
      'issues_total', 'issues_open', 'issues_done', 'issues_overdue',
      'issues_by_status', 'issues_table', 'projects_total', 'projects_list',
      'users_total', 'users_by_department', 'date_label',
    ];
    const entries = await Promise.all(
      types.map(async (t) => [t, await this.getWidgetData(t)] as const),
    );
    return Object.fromEntries(entries) as Record<DataWidgetType, WidgetData>;
  }
}
