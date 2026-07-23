import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Issue, IssueDocument } from './schemas/issue.schema';
import {
  CalendarRangeQuery,
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
import { ProjectAccessService } from '../projects/access/project-access.service';
import { WebhooksService } from '../webhooks/webhooks.service';

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : undefined;

/** True when `userId` is one of the (possibly-undefined) stakeholder ids. */
const isStakeholder = (
  userId: string,
  ids: (Types.ObjectId | undefined | null)[],
) => ids.some((id) => id && String(id) === userId);

@Injectable()
export class IssuesService {
  constructor(
    @InjectModel(Issue.name) private model: Model<IssueDocument>,
    private access: ProjectAccessService,
    private notifs: NotificationsService,
    private users: UsersService,
    private activity: ActivityService,
    private autos: AutomationsService,
    private webhooks: WebhooksService,
  ) {}

  /**
   * Fan a lifecycle event out to the workspace's webhooks (docs/plan/03 §3).
   * Fire-and-forget and best-effort: resolving the workspace or a failing
   * receiver must never affect the issue write that triggered it.
   */
  private async dispatchWebhook(
    projectId: Types.ObjectId | string | null | undefined,
    event: string,
    data: Record<string, unknown>,
  ) {
    if (!projectId) return; // personal issues have no workspace to notify
    try {
      const fields = await this.access.getAccessFields(projectId);
      if (fields?.workspaceId) {
        await this.webhooks.dispatch(fields.workspaceId, event, data);
      }
    } catch {
      // swallow — webhooks are a side channel, not part of the write
    }
  }

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

  /**
   * The access-scope branch shared by {@link list} and {@link calendar}
   * (ADR 0003/0005; workspace param per ADR 0011 §2b). Absent `workspaceId`:
   * issues in projects the caller can read, plus their own personal
   * (project-less) issues. Present: readable projects *in that workspace*
   * only — personal issues belong to no workspace and are dropped, and an
   * unknown/non-member workspace yields a filter that matches nothing.
   */
  private async accessScope(
    userId: string,
    workspaceId?: string,
  ): Promise<FilterQuery<IssueDocument>> {
    if (workspaceId) {
      const projectIds = await this.access.readableProjectIdsInWorkspace(
        userId,
        workspaceId,
      );
      return { projectId: { $in: projectIds } };
    }
    const me = new Types.ObjectId(userId);
    const readableProjects = await this.access.readableProjectIds(userId);
    return {
      $or: [
        { projectId: { $in: readableProjects } },
        { projectId: null, $or: [{ authorId: me }, { assigneeId: me }] },
      ],
    };
  }

  async list(userId: string, q: ListIssueQuery) {
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

    // Access scope, matching byId. Combined via $and so it can't collide with
    // the text-search $or above.
    const scopedFilter: FilterQuery<IssueDocument> = {
      $and: [filter, await this.accessScope(userId, q.workspaceId)],
    };

    const skip = (q.page - 1) * q.limit;
    const items = await this.model
      .find(scopedFilter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(q.limit)
      .lean();

    const counts = await this.model.aggregate<{
      _id: 'open' | 'done';
      n: number;
    }>([
      { $match: scopedFilter },
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

  async byId(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const issue = await this.model.findById(id).lean();
    if (!issue) throw new NotFoundException();
    // Project-linked → project read rule; personal (no project) → stakeholders.
    const ok = issue.projectId
      ? await this.access.canReadProjectById(userId, issue.projectId)
      : isStakeholder(userId, [issue.authorId, issue.assigneeId]);
    // 404 (not 403) on no-access so existence isn't leaked.
    if (!ok) throw new NotFoundException();
    return issue;
  }

  /**
   * Scoped exactly like {@link list} (ADR 0011 context #2 — the previous
   * date-only filter returned every tenant's issues in the range).
   */
  async calendar(userId: string, q: CalendarRangeQuery) {
    return this.model
      .find({
        $and: [
          {
            dueDate: {
              $gte: new Date(`${q.from}T00:00:00.000Z`),
              $lte: new Date(`${q.to}T23:59:59.999Z`),
            },
          },
          await this.accessScope(userId, q.workspaceId),
        ],
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
    // Creating inside a project requires membership; personal issues are free.
    await this.access.assertProjectWritable(userId, dto.projectId ?? null);
    const issue = await this.model.create({
      ...dto,
      projectId: oid(dto.projectId ?? undefined),
      assigneeId: oid(dto.assigneeId ?? undefined),
      parentId: oid(dto.parentId ?? undefined),
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

    this.dispatchWebhook(issue.projectId, 'issue.created', {
      issueId: String(issue._id),
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      projectId: issue.projectId ? String(issue.projectId) : undefined,
    }).catch(() => {});

    return issue;
  }

  async update(actorId: string, id: string, dto: UpdateIssueDto) {
    const issue = await this.model.findById(id);
    if (!issue) throw new NotFoundException();
    // Write requires membership of the issue's project or being a stakeholder.
    await this.access.assertCanWrite(
      actorId,
      issue.projectId ?? null,
      isStakeholder(actorId, [issue.authorId, issue.assigneeId]),
    );
    // Re-parenting into another project also requires write on the target.
    if ('projectId' in dto && dto.projectId) {
      await this.access.assertProjectWritable(actorId, dto.projectId);
    }

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
    if ('parentId' in dto) {
      // Guard against a self-parent, which would make the sub-issue tree cyclic.
      if (dto.parentId && dto.parentId === id) {
        throw new BadRequestException('An issue cannot be its own parent');
      }
      issue.parentId = oid(dto.parentId ?? undefined) ?? undefined;
    }

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
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const target = await this.model
      .findById(id, { projectId: 1, authorId: 1, assigneeId: 1 })
      .lean();
    if (!target) throw new NotFoundException();
    await this.access.assertCanWrite(
      authorId,
      target.projectId ?? null,
      isStakeholder(authorId, [target.authorId, target.assigneeId]),
    );
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
