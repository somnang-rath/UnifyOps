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

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : undefined;

@Injectable()
export class MrsService {
  constructor(
    @InjectModel(MergeRequest.name)
    private model: Model<MergeRequestDocument>,
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

  async list(q: ListMRQuery) {
    const filter: FilterQuery<MergeRequestDocument> = {};
    if (q.status !== 'all') filter.status = q.status;
    if (q.projectId) filter.projectId = new Types.ObjectId(q.projectId);
    if (q.q) filter.title = { $regex: q.q, $options: 'i' };

    const skip = (q.page - 1) * q.limit;
    const [items, total, counts] = await Promise.all([
      this.model.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(q.limit).lean(),
      this.model.countDocuments(filter),
      this.model.aggregate<{ _id: MRStatus; n: number }>([
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

  async byId(id: string) {
    const mr = await this.model.findById(id).lean();
    if (!mr) throw new NotFoundException();
    return mr;
  }

  async create(authorId: string, dto: CreateMRDto) {
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
