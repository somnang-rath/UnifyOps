import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import {
  MergeRequest,
  MergeRequestDocument,
} from '../mrs/schemas/mr.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import {
  Activity,
  ActivityDocument,
} from '../activity/schemas/activity.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationDocument,
} from '../notifications/schemas/notification.schema';

// `@Schema({ timestamps: true })` adds createdAt/updatedAt at runtime but
// Mongoose's inferred lean type doesn't surface them. Attach them here so
// downstream code can read the timestamps without `as any` casts.
type Timestamped = { createdAt: Date; updatedAt: Date };

export interface DashIssue {
  _id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  assigneeId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashActivity {
  _id: string;
  actorId: string;
  actorName: string;
  actorAvatar?: string;
  action: string;
  title: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    @InjectModel(MergeRequest.name)
    private mrModel: Model<MergeRequestDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Activity.name)
    private activityModel: Model<ActivityDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Notification.name)
    private notifModel: Model<NotificationDocument>,
  ) {}

  async badges(userId: string) {
    const meOid = new Types.ObjectId(userId);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [myOpenIssues, overdueIssues, openMrs, unreadNotifs] =
      await Promise.all([
        this.issueModel.countDocuments({
          assigneeId: meOid,
          status: { $ne: 'done' },
        }),
        this.issueModel.countDocuments({
          assigneeId: meOid,
          status: { $ne: 'done' },
          dueDate: { $lt: startOfDay },
        }),
        this.mrModel.countDocuments({ status: 'open' }),
        this.notifModel.countDocuments({ userId: meOid, read: false }),
      ]);

    return {
      issues: myOpenIssues,
      mywork: overdueIssues,
      approvals: openMrs,
      notifications: unreadNotifs,
    };
  }

  async overview(userId: string) {
    const meOid = new Types.ObjectId(userId);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const weekAgo = new Date(startOfDay);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekLater = new Date(startOfDay);
    weekLater.setDate(weekLater.getDate() + 7);

    const [issuesRaw, openMrs, projects, recentActivityRaw] = await Promise.all([
      this.issueModel.find({}).sort({ updatedAt: -1 }).lean(),
      this.mrModel.countDocuments({ status: 'open' }),
      this.projectModel
        .find({
          $or: [
            { ownerId: meOid },
            { members: meOid },
            { visibility: { $in: ['internal', 'public'] } },
          ],
        })
        .sort({ updatedAt: -1 })
        .lean(),
      this.activityModel
        .find({})
        .sort({ createdAt: -1 })
        .limit(7)
        .lean(),
    ]);

    // Re-type with timestamps that `@Schema({ timestamps: true })` adds at runtime.
    const issues = issuesRaw as Array<(typeof issuesRaw)[number] & Timestamped>;
    const recentActivity = recentActivityRaw as Array<
      (typeof recentActivityRaw)[number] & Timestamped
    >;

    const actorIds = Array.from(
      new Set(recentActivity.map((a) => String(a.actorId))),
    ).map((id) => new Types.ObjectId(id));
    const actors = actorIds.length
      ? await this.userModel
          .find({ _id: { $in: actorIds } }, { name: 1, avatar: 1 })
          .lean()
      : [];
    const actorById = new Map(
      actors.map((u) => [String(u._id), { name: u.name as string, avatar: u.avatar as string | undefined }]),
    );

    const toDash = (i: (typeof issues)[number]): DashIssue => ({
      _id: String(i._id),
      title: i.title,
      status: i.status,
      priority: i.priority,
      projectId: i.projectId ? String(i.projectId) : '',
      assigneeId: i.assigneeId ? String(i.assigneeId) : undefined,
      dueDate: i.dueDate ? new Date(i.dueDate).toISOString() : undefined,
      createdAt: new Date(i.createdAt).toISOString(),
      updatedAt: new Date(i.updatedAt).toISOString(),
    });

    const isMine = (i: (typeof issues)[number]) =>
      i.assigneeId && String(i.assigneeId) === userId;
    const isDone = (i: (typeof issues)[number]) => i.status === 'done';
    const isOpen = (i: (typeof issues)[number]) => !isDone(i);
    const isOverdue = (i: (typeof issues)[number]) =>
      !!i.dueDate && new Date(i.dueDate) < startOfDay && isOpen(i);
    const isDueToday = (i: (typeof issues)[number]) =>
      !!i.dueDate &&
      new Date(i.dueDate) >= startOfDay &&
      new Date(i.dueDate) < endOfDay;

    const myOpen = issues.filter((i) => isMine(i) && isOpen(i));
    const overdue = myOpen.filter(isOverdue);
    const dueToday = myOpen.filter(isDueToday);
    const doneWeek = issues.filter(
      (i) => isDone(i) && new Date(i.updatedAt) >= weekAgo,
    );

    const upcoming = issues
      .filter(
        (i) =>
          isOpen(i) &&
          !!i.dueDate &&
          new Date(i.dueDate) >= startOfDay &&
          new Date(i.dueDate) <= weekLater,
      )
      .sort(
        (a, b) =>
          new Date(a.dueDate as Date).getTime() -
          new Date(b.dueDate as Date).getTime(),
      )
      .slice(0, 7)
      .map(toDash);

    const total = issues.length;
    const done = issues.filter(isDone).length;
    const inProgress = issues.filter((i) => i.status === 'inprogress').length;
    const todo = issues.filter((i) => i.status === 'todo').length;

    const projectStats = projects.slice(0, 5).map((p) => {
      const pissues = issues.filter(
        (i) => i.projectId && String(i.projectId) === String(p._id),
      );
      const pdone = pissues.filter(isDone).length;
      const pover = pissues.filter(isOverdue).length;
      return {
        id: String(p._id),
        name: p.name,
        color: p.color,
        members: (p.members ?? []).map(String),
        done: pdone,
        total: pissues.length,
        overdue: pover,
      };
    });

    const activity: DashActivity[] = recentActivity.map((a) => {
      const actor = actorById.get(String(a.actorId));
      return {
        _id: String(a._id),
        actorId: String(a.actorId),
        actorName: actor?.name ?? 'Someone',
        actorAvatar: actor?.avatar,
        action: a.action,
        title: a.title,
        entityType: a.entityType,
        entityId: a.entityId,
        createdAt: new Date(a.createdAt).toISOString(),
      };
    });

    return {
      kpi: {
        myOpen: myOpen.length,
        overdue: overdue.length,
        dueToday: dueToday.length,
        doneWeek: doneWeek.length,
        projects: projects.length,
        approvals: openMrs,
      },
      myWork: myOpen.map(toDash),
      upcoming,
      progress: { done, inProgress, todo, total },
      projectStats,
      activity,
    };
  }
}
