import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import type { ListAuditQuery } from './dto/audit.dto';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private model: Model<AuditLogDocument>,
  ) {}

  /** Newest first, filterable by action prefix. Read-only by design. */
  async list(q: ListAuditQuery) {
    const filter: Record<string, unknown> = {};
    if (q.action) filter.action = { $regex: `^${escapeRegex(q.action)}` };
    if (q.success !== undefined) filter.success = q.success;

    const [rows, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('actorId', 'name email avatar')
        .sort({ createdAt: -1 })
        .skip(q.offset)
        .limit(q.limit)
        .lean(),
      this.model.countDocuments(filter),
    ]);

    return {
      total,
      items: rows.map((r) => ({
        id: String(r._id),
        action: r.action,
        actor: r.actorId,
        actorEmail: r.actorEmail,
        audience: r.audience,
        detail: r.detail,
        ip: r.ip,
        userAgent: r.userAgent,
        success: r.success,
        error: r.error,
        createdAt: (r as unknown as { createdAt: Date }).createdAt,
      })),
    };
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
