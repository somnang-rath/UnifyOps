import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  MergeRequest,
  MergeRequestDocument,
  MRStatus,
} from './schemas/mr.schema';
import { CreateMRDto, ListMRQuery } from './dto/mr.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { extractMentionTokens } from '../notifications/mentions.util';
import { ActivityService } from '../activity/activity.service';
import { UsersService } from '../users/users.service';
import { AutomationsService } from '../automations/automations.service';
import { ProjectAccessService } from '../projects/access/project-access.service';

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : undefined;

/** True when `userId` is one of the (possibly-undefined) stakeholder ids. */
const isStakeholder = (
  userId: string,
  ids: (Types.ObjectId | undefined | null)[],
) => ids.some((id) => id && String(id) === userId);

@Injectable()
export class MrsService {
  constructor(
    @InjectModel(MergeRequest.name)
    private model: Model<MergeRequestDocument>,
    private access: ProjectAccessService,
    private notifs: NotificationsService,
    private activity: ActivityService,
    private users: UsersService,
    private autos: AutomationsService,
  ) {}

  private logActivity(
    actorId: string,
    mrId: string,
    action: 'opened' | 'approved' | 'rejected',
    title: string,
    projectId?: string | null,
  ) {
    this.activity
      .log(
        actorId,
        'mr',
        mrId,
        action,
        title,
        projectId ?? undefined,
      )
      .catch(() => {});
  }

  async list(userId: string, q: ListMRQuery) {
    // Access scope (ADR 0003/0005), matching byId: MRs in a project the caller
    // can read, plus their own personal (project-less) MRs. Everything below is
    // intersected with this so neither the items nor the status totals leak.
    const me = new Types.ObjectId(userId);
    const readableProjects = await this.access.readableProjectIds(userId);
    const scope: FilterQuery<MergeRequestDocument> = {
      $or: [
        { projectId: { $in: readableProjects } },
        {
          projectId: null,
          $or: [{ authorId: me }, { reviewerId: me }, { decidedById: me }],
        },
      ],
    };

    // The per-status tab totals share every filter EXCEPT status (so each tab
    // shows how many MRs it would contain), then the status filter is layered on
    // only for the items/total of the active tab.
    const totalsConds: FilterQuery<MergeRequestDocument>[] = [scope];
    if (q.projectId)
      totalsConds.push({ projectId: new Types.ObjectId(q.projectId) });
    if (q.q) totalsConds.push({ title: { $regex: q.q, $options: 'i' } });
    const totalsFilter: FilterQuery<MergeRequestDocument> = { $and: totalsConds };

    const conds = [...totalsConds];
    if (q.status !== 'all') conds.push({ status: q.status });
    const filter: FilterQuery<MergeRequestDocument> = { $and: conds };

    const skip = (q.page - 1) * q.limit;
    const [items, total, counts] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(q.limit).lean(),
      this.model.countDocuments(filter),
      this.model.aggregate<{ _id: MRStatus; n: number }>([
        { $match: totalsFilter },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
    ]);

    const totals = { open: 0, merged: 0, closed: 0, all: 0 };
    counts.forEach((c) => {
      totals[c._id] = c.n;
      totals.all += c.n;
    });

    return {
      items,
      totals,
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
    const mr = await this.model.findById(id).lean();
    if (!mr) throw new NotFoundException();
    // Project-linked → project read rule; personal (no project) → stakeholders.
    const ok = mr.projectId
      ? await this.access.canReadProjectById(userId, mr.projectId)
      : isStakeholder(userId, [mr.authorId, mr.reviewerId, mr.decidedById]);
    // 404 (not 403) on no-access so existence isn't leaked.
    if (!ok) throw new NotFoundException();
    return mr;
  }

  async create(authorId: string, dto: CreateMRDto) {
    // Opening an MR against a project requires membership; personal MRs are free.
    await this.access.assertProjectWritable(authorId, dto.projectId ?? null);
    const mr = await this.model.create({
      title: dto.title,
      desc: dto.desc,
      sourceBranch: dto.sourceBranch,
      targetBranch: dto.targetBranch,
      projectId: oid(dto.projectId ?? undefined),
      reviewerId: oid(dto.reviewerId ?? undefined),
      authorId: new Types.ObjectId(authorId),
      status: 'open',
    });

    if (mr.reviewerId) {
      await this.notifs.push({
        userId: String(mr.reviewerId),
        actorId: authorId,
        type: 'mr_review',
        title: 'Review requested',
        subject: mr.title,
        link: '/approvals',
        entityRef: { kind: 'mr', id: String(mr._id) },
      });
    }
    this.logActivity(
      authorId,
      String(mr._id),
      'opened',
      mr.title,
      mr.projectId ? String(mr.projectId) : null,
    );

    this.autos.fire('mr.opened', {
      mrId: String(mr._id),
      title: mr.title,
      authorId,
      reviewerId: mr.reviewerId ? String(mr.reviewerId) : undefined,
      projectId: mr.projectId ? String(mr.projectId) : undefined,
    }).catch(() => {});

    return mr;
  }

  private async decide(
    userId: string,
    id: string,
    status: 'merged' | 'closed',
  ) {
    const mr = await this.model.findById(id);
    if (!mr) throw new NotFoundException();
    // Deciding is a write: project member or MR stakeholder only.
    await this.access.assertCanWrite(
      userId,
      mr.projectId ?? null,
      isStakeholder(userId, [mr.authorId, mr.reviewerId, mr.decidedById]),
    );
    if (mr.status !== 'open')
      throw new ForbiddenException('Already decided');
    if (mr.reviewerId && String(mr.reviewerId) !== userId)
      throw new ForbiddenException();

    mr.status = status;
    mr.decidedAt = new Date();
    mr.decidedById = new Types.ObjectId(userId);
    const saved = await mr.save();

    await this.notifs.push({
      userId: String(saved.authorId),
      actorId: userId,
      type: 'mr_decided',
      title: status === 'merged' ? 'Approved' : 'Rejected',
      subject: saved.title,
      link: '/approvals',
      entityRef: { kind: 'mr', id: String(saved._id) },
    });

    this.logActivity(
      userId,
      String(saved._id),
      status === 'merged' ? 'approved' : 'rejected',
      saved.title,
      saved.projectId ? String(saved.projectId) : null,
    );

    if (status === 'merged') {
      this.autos.fire('mr.merged', {
        mrId: String(saved._id),
        title: saved.title,
        authorId: String(saved.authorId),
        reviewerId: saved.reviewerId ? String(saved.reviewerId) : undefined,
        projectId: saved.projectId ? String(saved.projectId) : undefined,
      }).catch(() => {});
    }

    return saved;
  }

  approve(userId: string, id: string) {
    return this.decide(userId, id, 'merged');
  }

  reject(userId: string, id: string) {
    return this.decide(userId, id, 'closed');
  }

  async remove(userId: string, id: string) {
    const mr = await this.model.findById(id);
    if (!mr) throw new NotFoundException();
    if (String(mr.authorId) !== userId) throw new ForbiddenException();
    await mr.deleteOne();
    return { ok: true };
  }

  async addComment(id: string, authorId: string, body: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const target = await this.model
      .findById(id, { projectId: 1, authorId: 1, reviewerId: 1, decidedById: 1 })
      .lean();
    if (!target) throw new NotFoundException();
    await this.access.assertCanWrite(
      authorId,
      target.projectId ?? null,
      isStakeholder(authorId, [
        target.authorId,
        target.reviewerId,
        target.decidedById,
      ]),
    );
    const mr = await this.model.findByIdAndUpdate(
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
    if (!mr) throw new NotFoundException();

    const link = '/approvals';
    const entityRef = { kind: 'mr' as const, id: String(mr._id) };

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
        subject: mr.title,
        link,
        entityRef,
      });
    }

    const commentRecipients = [
      String(mr.authorId),
      mr.reviewerId ? String(mr.reviewerId) : null,
    ].filter((r): r is string => !!r && !mentionedIds.has(r));

    if (commentRecipients.length > 0) {
      await this.notifs.pushMany(commentRecipients, {
        actorId: authorId,
        type: 'mr_commented',
        title: 'New comment',
        subject: mr.title,
        link,
        entityRef,
      });
    }

    return mr;
  }
}
