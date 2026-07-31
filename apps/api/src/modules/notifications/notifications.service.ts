import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EntityKind,
  Notification,
  NotificationDocument,
  NotifType,
} from './schemas/notification.schema';
import { NotificationsGateway } from './notifications.gateway';
import { UsersService } from '../users/users.service';
import { EmailService } from './email.service';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';

export interface PushInput {
  userId: string;
  type: NotifType;
  title: string;
  subject: string;
  link?: string;
  actorId?: string;
  entityRef?: { kind: EntityKind; id: string };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private model: Model<NotificationDocument>,
    @InjectModel(Issue.name)
    private issueModel: Model<IssueDocument>,
    private gateway: NotificationsGateway,
    private users: UsersService,
    private email: EmailService,
  ) {}

  private async maybeSendEmail(
    userId: string,
    input: PushInput,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.email) return;
    const tpl = this.email.buildNotificationEmail({
      title: input.title,
      subject: input.subject,
      link: input.link,
    });
    await this.email.send({ to: user.email, ...tpl });
  }

  /**
   * `dueIssues` carries `projectId` because the caller feeds it to the
   * automation engine, which resolves an event's workspace from its project
   * (ADR 0003). Without it every scheduled `issue.due_soon` would resolve to no
   * tenant and fire nothing.
   */
  async runDueSoonSweep(now: Date = new Date()): Promise<{
    sent: number;
    dueIssues: Array<{ id: string; title: string; projectId: string | null }>;
  }> {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

    const issues = await this.issueModel
      .find({
        dueDate: { $gte: start, $lte: end },
        assigneeId: { $ne: null },
        status: { $ne: 'done' },
      })
      .select('title assigneeId projectId')
      .lean();

    let sent = 0;
    const dueIssues: Array<{
      id: string;
      title: string;
      projectId: string | null;
    }> = [];
    for (const i of issues) {
      if (!i.assigneeId) continue;
      const r = await this.push({
        userId: String(i.assigneeId),
        type: 'due_soon',
        title: 'Due tomorrow',
        subject: i.title,
        link: `/issues/${i._id}`,
        entityRef: { kind: 'issue', id: String(i._id) },
      });
      if (r) sent++;
      dueIssues.push({
        id: String(i._id),
        title: i.title,
        projectId: i.projectId ? String(i.projectId) : null,
      });
    }
    return { sent, dueIssues };
  }

  async list(userId: string) {
    const items = await this.model
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(40)
      .lean();
    const unread = await this.model.countDocuments({
      userId: new Types.ObjectId(userId),
      read: false,
    });
    return { items, unread };
  }

  async history(userId: string, cursor?: string, limit = 50) {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (cursor && Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new Types.ObjectId(cursor) };
    }
    const items = await this.model
      .find(filter)
      .sort({ _id: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean();
    const nextCursor =
      items.length === limit ? String(items[items.length - 1]._id) : null;
    return { items, nextCursor };
  }

  async push(input: PushInput) {
    if (input.actorId && input.actorId === input.userId) return null;

    const prefs = await this.users.getNotifPrefs(input.userId);
    const allowInApp = prefs[input.type]?.inApp !== false;
    const allowEmail = prefs[input.type]?.email === true;
    if (!allowInApp && !allowEmail) return null;

    const userObjId = new Types.ObjectId(input.userId);
    const actorObjId = input.actorId
      ? new Types.ObjectId(input.actorId)
      : undefined;

    let doc: NotificationDocument | null = null;
    let isFresh = true;

    if (allowInApp) {
      if (input.entityRef) {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        const existing = await this.model.findOne({
          userId: userObjId,
          type: input.type,
          'entityRef.kind': input.entityRef.kind,
          'entityRef.id': new Types.ObjectId(input.entityRef.id),
          read: false,
          createdAt: { $gte: fiveMinAgo },
        });
        if (existing) {
          const set: Record<string, unknown> = {
            title: input.title,
            subject: input.subject,
            link: input.link,
          };
          if (actorObjId) set.actorId = actorObjId;
          const update: Record<string, unknown> = {
            $set: set,
            $inc: { count: 1 },
          };
          if (actorObjId) {
            (update as { $addToSet?: Record<string, unknown> }).$addToSet = {
              actorIds: actorObjId,
            };
          }
          doc = await this.model.findByIdAndUpdate(existing._id, update, {
            new: true,
          });
          isFresh = false;
        }
      }
      if (!doc) {
        doc = await this.model.create({
          userId: userObjId,
          actorId: actorObjId,
          actorIds: actorObjId ? [actorObjId] : [],
          type: input.type,
          title: input.title,
          subject: input.subject,
          link: input.link,
          entityRef: input.entityRef
            ? {
                kind: input.entityRef.kind,
                id: new Types.ObjectId(input.entityRef.id),
              }
            : undefined,
        });
      }
      this.gateway.emitNew(input.userId, doc);
    }

    if (allowEmail && isFresh) {
      await this.maybeSendEmail(input.userId, input);
    }

    return doc;
  }

  async pushMany(
    userIds: (string | Types.ObjectId | null | undefined)[],
    base: Omit<PushInput, 'userId'>,
  ) {
    const recipients = Array.from(
      new Set(
        userIds
          .filter((u): u is string | Types.ObjectId => !!u)
          .map((u) => String(u)),
      ),
    ).filter((u) => !base.actorId || u !== base.actorId);

    if (recipients.length === 0) return [];
    return Promise.all(
      recipients.map((userId) => this.push({ ...base, userId })),
    );
  }

  markRead(userId: string, id: string) {
    return this.model.updateOne(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: { read: true } },
    );
  }

  markUnread(userId: string, id: string) {
    return this.model.updateOne(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: { read: false } },
    );
  }

  markAllRead(userId: string) {
    return this.model.updateMany(
      { userId: new Types.ObjectId(userId), read: false },
      { $set: { read: true } },
    );
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    await this.model.deleteOne({
      _id: id,
      userId: new Types.ObjectId(userId),
    });
    return { ok: true };
  }

  async clearRead(
    userId: string,
  ): Promise<{ ok: true; deleted: number }> {
    const r = await this.model.deleteMany({
      userId: new Types.ObjectId(userId),
      read: true,
    });
    return { ok: true, deleted: r.deletedCount ?? 0 };
  }

  async cleanupOldRead(daysOld = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const r = await this.model.deleteMany({
      read: true,
      updatedAt: { $lt: cutoff },
    });
    return r.deletedCount ?? 0;
  }
}
