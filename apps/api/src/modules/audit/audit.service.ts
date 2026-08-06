import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import type { ListAuditQuery } from './dto/audit.dto';

/** One programmatic audit entry — see {@link AuditService.record}. */
export interface AuditRecordInput {
  actorId: string;
  actorEmail?: string | null;
  action: string;
  audience?: string | null;
  detail?: Record<string, unknown>;
  success?: boolean;
  error?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private model: Model<AuditLogDocument>,
  ) {}

  /**
   * Write one entry from inside a service, for actions that never pass through
   * an HTTP handler and so cannot be caught by `@Audit()` + the interceptor —
   * today, writes the AI assistant performs through a tool (ADR 0015 §2.7).
   *
   * `actorId` is the real user: a tool runs *as* the caller (§2.1), so they are
   * accountable for it. `detail.via = 'assistant'` is what distinguishes it
   * later from the same edit made by hand, which is the first question anyone
   * asks when an assistant-driven change goes wrong.
   *
   * Fire-and-forget like the interceptor: an audit write must never fail the
   * action it records, but it must never be silently lost either.
   */
  record(input: AuditRecordInput): void {
    if (!Types.ObjectId.isValid(input.actorId)) return;
    this.model
      .create({
        actorId: new Types.ObjectId(input.actorId),
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        audience: input.audience ?? null,
        detail: input.detail ?? {},
        ip: null,
        userAgent: null,
        success: input.success ?? true,
        error: input.error ?? null,
      })
      .catch((err: unknown) =>
        console.error('[audit] failed to write entry', input.action, err),
      );
  }

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
