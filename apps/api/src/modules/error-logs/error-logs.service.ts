import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ErrorLog, ErrorLogDocument } from './schemas/error-log.schema';
import type {
  CreateErrorLogDto,
  QueryErrorLogsDto,
} from './dto/error-log.dto';

@Injectable()
export class ErrorLogsService {
  private readonly logger = new Logger(ErrorLogsService.name);
  private retentionDays = 90;

  constructor(
    @InjectModel(ErrorLog.name) private model: Model<ErrorLogDocument>,
  ) {}

  async create(dto: CreateErrorLogDto, userId?: string): Promise<ErrorLogDocument> {
    return this.model.create({
      ...dto,
      userId: userId ? new Types.ObjectId(userId) : undefined,
    });
  }

  async list(q: QueryErrorLogsDto) {
    const filter: FilterQuery<ErrorLogDocument> = {};

    if (q.source) filter.source = q.source;
    if (q.logType) filter.logType = q.logType;
    if (q.statusCode) filter.statusCode = q.statusCode;
    if (q.resolved !== undefined) filter.resolvedStatus = q.resolved === 'true';
    if (q.userId && Types.ObjectId.isValid(q.userId))
      filter.userId = new Types.ObjectId(q.userId);
    if (q.userEmail) filter.userEmail = { $regex: q.userEmail, $options: 'i' };

    if (q.from || q.to) {
      filter.createdAt = {} as Record<string, unknown>;
      if (q.from) (filter.createdAt as Record<string, unknown>).$gte = new Date(q.from);
      if (q.to) (filter.createdAt as Record<string, unknown>).$lte = new Date(q.to);
    }

    if (q.search) {
      const rx = { $regex: q.search, $options: 'i' };
      filter.$or = [
        { errorTitle: rx },
        { errorMessage: rx },
        { endpointUrl: rx },
        { pageRoute: rx },
        { userEmail: rx },
      ];
    }

    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(q.limit)
        .lean(),
      this.model.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    };
  }

  async byId(id: string) {
    return this.model.findById(id).lean();
  }

  async stats() {
    const [
      total,
      totalDebug,
      totalWarning,
      frontend,
      backend,
      resolved,
      unresolved,
    ] = await Promise.all([
      this.model.countDocuments({ logType: 'error' }),
      this.model.countDocuments({ logType: 'debug' }),
      this.model.countDocuments({ logType: 'warning' }),
      this.model.countDocuments({ source: 'frontend' }),
      this.model.countDocuments({ source: 'backend' }),
      this.model.countDocuments({ resolvedStatus: true }),
      this.model.countDocuments({ resolvedStatus: false }),
    ]);

    const recentErrors = await this.model
      .find({ logType: 'error' })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('errorTitle createdAt source statusCode')
      .lean();

    return {
      totalErrors: total,
      totalDebug,
      totalWarning,
      frontendErrors: frontend,
      backendErrors: backend,
      resolved,
      unresolved,
      recentErrors,
    };
  }

  async resolve(id: string, resolvedById: string): Promise<ErrorLogDocument | null> {
    return this.model.findByIdAndUpdate(
      id,
      {
        $set: {
          resolvedStatus: true,
          resolvedBy: new Types.ObjectId(resolvedById),
          resolvedAt: new Date(),
        },
      },
      { new: true },
    );
  }

  async bulkResolve(ids: string[], resolvedById: string) {
    const result = await this.model.updateMany(
      { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
      {
        $set: {
          resolvedStatus: true,
          resolvedBy: new Types.ObjectId(resolvedById),
          resolvedAt: new Date(),
        },
      },
    );
    return { modified: result.modifiedCount };
  }

  async remove(id: string) {
    await this.model.findByIdAndDelete(id);
    return { ok: true };
  }

  async bulkRemove(ids: string[]) {
    const result = await this.model.deleteMany({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    });
    return { deleted: result.deletedCount };
  }

  async exportCsv(q: QueryErrorLogsDto): Promise<string> {
    const result = await this.list({ ...q, limit: 10000, page: 1 });
    const headers = [
      'id', 'createdAt', 'source', 'logType', 'statusCode',
      'errorTitle', 'errorMessage', 'pageRoute', 'endpointUrl',
      'userEmail', 'browser', 'operatingSystem', 'deviceType',
      'resolvedStatus', 'resolvedAt',
    ];

    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = result.items.map((item) =>
      headers.map((h) => escape((item as Record<string, unknown>)[h])).join(','),
    );
    return [headers.join(','), ...rows].join('\n');
  }

  async exportJson(q: QueryErrorLogsDto): Promise<unknown[]> {
    const result = await this.list({ ...q, limit: 10000, page: 1 });
    return result.items;
  }

  updateRetentionDays(days: number) {
    this.retentionDays = days;
    return { retentionDays: days };
  }

  getRetentionDays() {
    return { retentionDays: this.retentionDays };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCleanup() {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.model.deleteMany({ createdAt: { $lt: cutoff } });
    this.logger.log(`Auto-cleanup: deleted ${result.deletedCount} logs older than ${this.retentionDays} days`);
    return result.deletedCount;
  }
}
