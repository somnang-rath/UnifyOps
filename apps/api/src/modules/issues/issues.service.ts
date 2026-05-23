import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Issue, IssueDocument } from './schemas/issue.schema';
import {
  CreateIssueDto,
  ListIssueQuery,
  UpdateIssueDto,
} from './dto/issue.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  extractMentionTokens,
  newMentions,
} from '../notifications/mentions.util';
import { UsersService } from '../users/users.service';
import { ActivityService } from '../activity/activity.service';
import { AutomationsService } from '../automations/automations.service';

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : undefined;

@Injectable()
export class IssuesService {
  constructor(
    @InjectModel(Issue.name) private model: Model<IssueDocument>,
    private notifs: NotificationsService,
    private users: UsersService,
    private activity: ActivityService,
    private autos: AutomationsService,
  ) {}

  private logActivity(
    actorId: string,
    issueId: string,
    action: 'created' | 'updated' | 'closed' | 'reopened' | 'commented',
    title: string,
    projectId?: string | null,
  ) {
    this.activity
      .log(
        actorId,
        'issue',
        issueId,
        action,
        title,
        projectId ?? undefined,
      )
      .catch(() => {});
  }

  async list(_userId: string, q: ListIssueQuery) {
    const filter: FilterQuery<IssueDocument> = {};
    if (q.projectId) filter.projectId = new Types.ObjectId(q.projectId);
    if (q.assigneeId) filter.assigneeId = new Types.ObjectId(q.assigneeId);
    if (q.type) filter.type = q.type;
    if (q.priority) filter.priority = q.priority;
    if (q.status === 'open') filter.status = { $ne: 'done' };
    if (q.status === 'closed') filter.status = 'done';
    if (q.q)
      filter.$or = [
        { title: { $regex: q.q, $options: 'i' } },
        { desc: { $regex: q.q, $options: 'i' } },
      ];

    const skip = (q.page - 1) * q.limit;
    const items = await this.model
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(q.limit)
      .lean();

    const counts = await this.model.aggregate<{
      _id: 'open' | 'done';
      n: number;
    }>([
      { $match: filter },
      {
        $group: {
          _id: {
            $cond: [{ $eq: ['$status', 'done'] }, 'done', 'open'],
          },
          n: { $sum: 1 },
        },
      },
    ]);
    const openN = counts.find((c) => c._id === 'open')?.n ?? 0;
    const doneN = counts.find((c) => c._id === 'done')?.n ?? 0;

    const total = openN + doneN;
    return {
      items,
      totals: { open: openN, closed: doneN, all: total },
      pagination: {
        total,
        page: q.page,
        limit: q.limit,
        hasMore: skip + items.length < total,
      },
    };
  }

  async byId(id: string) {
    const issue = await this.model.findById(id).lean();
    if (!issue) throw new NotFoundException();
    return issue;
  }

  async calendar(from: string, to: string) {
    return this.model
      .find({
        dueDate: {
          $gte: new Date(`${from}T00:00:00.000Z`),
          $lte: new Date(`${to}T23:59:59.999Z`),
        },
      })
      .sort({ dueDate: 1 })
      .lean();
  }

  private async resolveMentions(
    body: string | null | undefined,
    actorId: string,
    excludeIds: Set<string>,
  ): Promise<string[]> {
    const tokens = extractMentionTokens(body);
    if (tokens.length === 0) return [];
    const users = await this.users.findByEmailLocalParts(tokens);
    return users
      .map((u) => u.id)
      .filter((id) => id !== actorId && !excludeIds.has(id));
  }

  async create(userId: string, dto: CreateIssueDto) {
    const issue = await this.model.create({
      ...dto,
      projectId: oid(dto.projectId ?? undefined),
      assigneeId: oid(dto.assigneeId ?? undefined),
      authorId: new Types.ObjectId(userId),
      dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
    });

    const link = `/issues/${issue._id}`;
    const entityRef = { kind: 'issue' as const, id: String(issue._id) };

    if (issue.assigneeId) {
      await this.notifs.push({
        userId: String(issue.assigneeId),
        actorId: userId,
        type: 'issue_assigned',
        title: 'Assigned to you',
        subject: issue.title,
        link,
        entityRef,
      });
    }

    const mentioned = await this.resolveMentions(
      issue.desc,
      userId,
      new Set(issue.assigneeId ? [String(issue.assigneeId)] : []),
    );
    if (mentioned.length > 0) {
      await this.notifs.pushMany(mentioned, {
        actorId: userId,
        type: 'mention',
        title: 'You were mentioned',
        subject: issue.title,
        link,
        entityRef,
      });
    }

    this.logActivity(
      userId,
      String(issue._id),
      'created',
      issue.title,
      issue.projectId ? String(issue.projectId) : null,
    );

    this.autos.fire('issue.created', {
      issueId: String(issue._id),
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      authorId: userId,
      assigneeId: issue.assigneeId ? String(issue.assigneeId) : undefined,
      projectId: issue.projectId ? String(issue.projectId) : undefined,
    }).catch(() => {});

    return issue;
  }

  async update(actorId: string, id: string, dto: UpdateIssueDto) {
    const issue = await this.model.findById(id);
    if (!issue) throw new NotFoundException();

    const prevAssignee = issue.assigneeId ? String(issue.assigneeId) : null;
    const prevStatus = issue.status;
    const prevDesc = issue.desc;

    if ('projectId' in dto)
      issue.projectId = oid(dto.projectId ?? undefined) ?? undefined;
    if ('assigneeId' in dto)
      issue.assigneeId = oid(dto.assigneeId ?? undefined) ?? undefined;
    if ('dueDate' in dto)
      issue.dueDate = dto.dueDate ? new Date(dto.dueDate) : undefined;
    if (dto.title !== undefined) issue.title = dto.title;
    if (dto.desc !== undefined) issue.desc = dto.desc;
    if (dto.type !== undefined) issue.type = dto.type;
    if (dto.status !== undefined) issue.status = dto.status;
    if (dto.priority !== undefined) issue.priority = dto.priority;
    if (dto.labels !== undefined) issue.labels = dto.labels;
    if (dto.todos !== undefined) issue.todos = dto.todos as any;

    await issue.save();

    const newAssignee = issue.assigneeId ? String(issue.assigneeId) : null;
    const link = `/issues/${issue._id}`;
    const entityRef = { kind: 'issue' as const, id: String(issue._id) };

    const issuePayload = {
      issueId: String(issue._id),
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      authorId: String(issue.authorId),
      assigneeId: newAssignee ?? undefined,
      projectId: issue.projectId ? String(issue.projectId) : undefined,
    };

    if (newAssignee && newAssignee !== prevAssignee) {
      await this.notifs.push({
        userId: newAssignee,
        actorId,
        type: 'issue_assigned',
        title: 'Assigned to you',
        subject: issue.title,
        link,
        entityRef,
      });
      this.autos.fire('issue.assigned', issuePayload).catch(() => {});
    }

    if (dto.status !== undefined && dto.status !== prevStatus) {
      const recipients =
        issue.status === 'done'
          ? [String(issue.authorId), newAssignee]
          : [newAssignee];
      const title =
        issue.status === 'done' ? 'Marked done' : `Status: ${issue.status}`;
      await this.notifs.pushMany(recipients, {
        actorId,
        type: 'issue_status',
        title,
        subject: issue.title,
        link,
        entityRef,
      });
      const action: 'closed' | 'reopened' | 'updated' =
        issue.status === 'done'
          ? 'closed'
          : prevStatus === 'done'
            ? 'reopened'
            : 'updated';
      this.logActivity(
        actorId,
        String(issue._id),
        action,
        issue.title,
        issue.projectId ? String(issue.projectId) : null,
      );
      this.autos.fire('issue.status_changed', issuePayload).catch(() => {});
    }

    if (dto.desc !== undefined && dto.desc !== prevDesc) {
      const tokens = newMentions(prevDesc, issue.desc);
      if (tokens.length > 0) {
        const users = await this.users.findByEmailLocalParts(tokens);
        const exclude = new Set<string>([
          String(issue.authorId),
          ...(newAssignee ? [newAssignee] : []),
        ]);
        const recipients = users
          .map((u) => u.id)
          .filter((uid) => uid !== actorId && !exclude.has(uid));
        if (recipients.length > 0) {
          await this.notifs.pushMany(recipients, {
            actorId,
            type: 'mention',
            title: 'You were mentioned',
            subject: issue.title,
            link,
            entityRef,
          });
        }
      }
    }

    return issue;
  }

  async remove(actorId: string, actorRole: string, id: string) {
    const issue = await this.model.findById(id).lean();
    if (!issue) throw new NotFoundException();
    const isOwner = String(issue.authorId) === actorId;
    const isAdmin = actorRole === 'admin';
    if (!isOwner && !isAdmin) throw new ForbiddenException();
    await this.model.findByIdAndDelete(id);
    return { ok: true };
  }

  async addComment(id: string, authorId: string, body: string) {
    const issue = await this.model.findByIdAndUpdate(
      id,
      {
        $push: {
          comments: {
            authorId: new Types.ObjectId(authorId),
            body,
            createdAt: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!issue) throw new NotFoundException();

    const link = `/issues/${issue._id}`;
    const entityRef = { kind: 'issue' as const, id: String(issue._id) };

    const tokens = extractMentionTokens(body);
    const mentioned = tokens.length
      ? await this.users.findByEmailLocalParts(tokens)
      : [];
    const mentionedIds = new Set(
      mentioned.map((u) => u.id).filter((uid: string) => uid !== authorId),
    );

    if (mentionedIds.size > 0) {
      await this.notifs.pushMany(Array.from(mentionedIds), {
        actorId: authorId,
        type: 'mention',
        title: 'You were mentioned',
        subject: issue.title,
        link,
        entityRef,
      });
    }

    const commentRecipients = [
      issue.assigneeId ? String(issue.assigneeId) : null,
      String(issue.authorId),
    ].filter((r): r is string => !!r && !mentionedIds.has(r));

    if (commentRecipients.length > 0) {
      await this.notifs.pushMany(commentRecipients, {
        actorId: authorId,
        type: 'issue_commented',
        title: 'New comment',
        subject: issue.title,
        link,
        entityRef,
      });
    }

    this.logActivity(
      authorId,
      String(issue._id),
      'commented',
      issue.title,
      issue.projectId ? String(issue.projectId) : null,
    );

    return issue;
  }
}
