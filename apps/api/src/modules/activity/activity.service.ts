import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Activity, ActivityDocument } from './schemas/activity.schema';
import { ListActivityDto } from './dto/activity.dto';

@Injectable()
export class ActivityService {
  constructor(
    @InjectModel(Activity.name) private model: Model<ActivityDocument>,
  ) {}

  async list(q: ListActivityDto, forceUserId?: string) {
    const filter: FilterQuery<ActivityDocument> = {};
    if (q.projectId) filter.projectId = new Types.ObjectId(q.projectId);

    const uid = forceUserId ?? q.userId;
    if (uid) filter.actorId = new Types.ObjectId(uid);

    if (q.from || q.to) {
      filter.createdAt = {};
      if (q.from) filter.createdAt.$gte = new Date(q.from);
      if (q.to) filter.createdAt.$lte = new Date(q.to);
    }

    return this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .populate('actorId', 'name email avatar role')
      .lean();
  }

  log(
    actorId: string,
    entityType: string,
    entityId: string,
    action: string,
    title: string,
    projectId?: string,
    meta: Record<string, unknown> = {},
  ) {
    return this.model.create({
      actorId: new Types.ObjectId(actorId),
      projectId: projectId ? new Types.ObjectId(projectId) : undefined,
      entityType,
      entityId,
      action,
      title,
      meta,
    });
  }
}
