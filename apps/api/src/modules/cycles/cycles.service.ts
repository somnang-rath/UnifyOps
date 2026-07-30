import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Cycle, CycleDocument, cycleStatus } from './schemas/cycle.schema';
import {
  CreateCycleDto,
  ListCyclesQuery,
  UpdateCycleDto,
} from './dto/cycle.dto';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { ProjectAccessService } from '../projects/access/project-access.service';

const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));

/** The single terminal status, matching `IssuesService.list`'s `closed` branch. */
const DONE = 'done';

export interface CycleProgress {
  total: number;
  completed: number;
  /** Every distinct status present in the cycle → count. */
  byStatus: Record<string, number>;
}

@Injectable()
export class CyclesService {
  constructor(
    @InjectModel(Cycle.name) private model: Model<CycleDocument>,
    // Registered directly in CyclesModule rather than importing IssuesModule:
    // IssuesModule pulls in notifications/activity/automations/webhooks, and
    // cycles only ever needs the raw collection. Same leaf trick as ViewsModule.
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    private access: ProjectAccessService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────

  /**
   * Cycles in a scope, each with its derived status and progress rollup.
   *
   * Scope resolution mirrors `IssuesService.accessScope`: an explicit project
   * needs read access; a workspace narrows to readable projects in it; neither
   * spans every readable project. In all three cases the filter is built from
   * an id set the caller can already see, so there is no existence leak.
   */
  async list(userId: string, q: ListCyclesQuery) {
    const filter: FilterQuery<CycleDocument> = {};

    if (q.projectId) {
      if (!(await this.access.canReadProjectById(userId, q.projectId))) {
        throw new NotFoundException('Project not found');
      }
      filter.projectId = oid(q.projectId);
    } else {
      const projectIds = q.workspaceId
        ? await this.access.readableProjectIdsInWorkspace(userId, q.workspaceId)
        : await this.access.readableProjectIds(userId);
      filter.projectId = { $in: projectIds };
    }

    const cycles = await this.model
      .find(filter)
      .sort({ startDate: 1, position: 1, createdAt: -1 })
      .lean();

    const withProgress = await this.attachProgress(cycles);
    // Status is derived, so it can only be filtered after the rollup — doing it
    // in Mongo would mean re-deriving the date windows in the query language.
    return q.status
      ? withProgress.filter((c) => c.status === q.status)
      : withProgress;
  }

  async byId(userId: string, id: string) {
    const cycle = await this.loadReadable(userId, id);
    const [withProgress] = await this.attachProgress([cycle]);
    return withProgress;
  }

  /** The work items scheduled into a cycle. Read gate is the cycle's project. */
  async issues(userId: string, id: string) {
    const cycle = await this.loadReadable(userId, id);
    return this.issueModel
      .find({ cycleId: cycle._id })
      .sort({ status: 1, updatedAt: -1 })
      .lean();
  }

  // ── Writes ─────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateCycleDto) {
    await this.access.assertProjectWritable(userId, dto.projectId);
    const fields = await this.access.getAccessFields(dto.projectId);
    if (!fields?.workspaceId) {
      throw new BadRequestException(
        'Project has no workspace; cannot attach a cycle',
      );
    }

    const { startDate, endDate } = this.normaliseDates(
      dto.startDate,
      dto.endDate,
    );
    await this.assertNoOverlap(oid(dto.projectId), startDate, endDate);

    const last = await this.model
      .findOne({ projectId: oid(dto.projectId) })
      .sort({ position: -1 })
      .lean();

    const created = await this.model.create({
      name: dto.name,
      description: dto.description,
      projectId: oid(dto.projectId),
      workspaceId: fields.workspaceId,
      ownerId: oid(userId),
      startDate,
      endDate,
      position: (last?.position ?? -1) + 1,
    });
    const [withProgress] = await this.attachProgress([created.toObject()]);
    return withProgress;
  }

  async update(userId: string, id: string, dto: UpdateCycleDto) {
    const cycle = await this.loadWritable(userId, id);

    if (dto.name !== undefined) cycle.name = dto.name;
    if (dto.description !== undefined) cycle.description = dto.description;

    if (dto.startDate !== undefined || dto.endDate !== undefined) {
      // Dates are validated as a pair even when only one is sent, so you cannot
      // reach a half-scheduled cycle by patching one side at a time.
      const { startDate, endDate } = this.normaliseDates(
        dto.startDate !== undefined
          ? dto.startDate
          : cycle.startDate?.toISOString(),
        dto.endDate !== undefined ? dto.endDate : cycle.endDate?.toISOString(),
      );
      await this.assertNoOverlap(cycle.projectId, startDate, endDate, cycle._id);
      cycle.startDate = startDate;
      cycle.endDate = endDate;
    }

    await cycle.save();
    const [withProgress] = await this.attachProgress([cycle.toObject()]);
    return withProgress;
  }

  /**
   * Delete a cycle and release its items back to the backlog.
   *
   * The unassign runs FIRST: if the delete succeeded and the unassign then
   * failed, every one of those issues would keep a `cycleId` pointing at a row
   * that no longer exists. Losing the ordering the other way is harmless — a
   * retry just re-runs an unassign that is already a no-op.
   */
  async remove(userId: string, id: string) {
    const cycle = await this.loadWritable(userId, id);
    const { modifiedCount } = await this.issueModel.updateMany(
      { cycleId: cycle._id },
      { $set: { cycleId: null } },
    );
    await cycle.deleteOne();
    return { ok: true, releasedIssues: modifiedCount };
  }

  /**
   * Schedule work items into a cycle.
   *
   * Only items already in the cycle's project are moved — an id from another
   * project is reported in `skipped` rather than 400-ing the batch, so one
   * stale id in a multi-select doesn't lose the whole action. The filter is
   * pinned to `projectId`, so this can never pull an item across a tenant
   * boundary even if the caller guesses valid ids.
   */
  async assign(userId: string, id: string, issueIds: string[]) {
    const cycle = await this.loadWritable(userId, id);

    const eligible = await this.issueModel
      .find({ _id: { $in: issueIds.map(oid) }, projectId: cycle.projectId }, { _id: 1 })
      .lean();
    const eligibleIds = eligible.map((i) => i._id);
    const eligibleSet = new Set(eligibleIds.map(String));

    if (eligibleIds.length) {
      await this.issueModel.updateMany(
        { _id: { $in: eligibleIds } },
        { $set: { cycleId: cycle._id } },
      );
    }

    return {
      assigned: eligibleIds.length,
      skipped: issueIds.filter((i) => !eligibleSet.has(i)),
    };
  }

  /** Release one item back to the backlog. Idempotent. */
  async unassign(userId: string, id: string, issueId: string) {
    const cycle = await this.loadWritable(userId, id);
    if (!Types.ObjectId.isValid(issueId)) {
      throw new NotFoundException('Work item not found');
    }
    await this.issueModel.updateOne(
      { _id: oid(issueId), cycleId: cycle._id },
      { $set: { cycleId: null } },
    );
    return { ok: true };
  }

  /** Persist a new order for one project's cycles. */
  async reorder(userId: string, ids: string[]) {
    const cycles = await this.model.find({ _id: { $in: ids.map(oid) } });
    if (cycles.length !== ids.length) {
      throw new NotFoundException('Cycle not found');
    }
    // Every cycle must be writable — reordering is not a back door into a
    // project the caller cannot otherwise touch.
    const projectIds = [...new Set(cycles.map((c) => String(c.projectId)))];
    await Promise.all(
      projectIds.map((p) => this.access.assertProjectWritable(userId, p)),
    );

    const order = new Map(ids.map((cycleId, i) => [cycleId, i]));
    await Promise.all(
      cycles.map((c) =>
        this.model.updateOne(
          { _id: c._id },
          { $set: { position: order.get(String(c._id)) ?? c.position } },
        ),
      ),
    );
    return { ok: true };
  }

  // ── Internals ──────────────────────────────────────────────────────

  /**
   * One grouped count for the whole page of cycles rather than a query each —
   * the list endpoint would otherwise be N+1 on a project with many sprints.
   */
  private async attachProgress<
    T extends { _id: Types.ObjectId; startDate: Date | null; endDate: Date | null },
  >(cycles: T[]) {
    if (cycles.length === 0) return [];

    const rows = await this.issueModel.aggregate<{
      _id: { cycleId: Types.ObjectId; status: string };
      count: number;
    }>([
      { $match: { cycleId: { $in: cycles.map((c) => c._id) } } },
      {
        $group: {
          _id: { cycleId: '$cycleId', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]);

    const progress = new Map<string, CycleProgress>();
    for (const row of rows) {
      const key = String(row._id.cycleId);
      const entry = progress.get(key) ?? { total: 0, completed: 0, byStatus: {} };
      entry.total += row.count;
      if (row._id.status === DONE) entry.completed += row.count;
      entry.byStatus[row._id.status] =
        (entry.byStatus[row._id.status] ?? 0) + row.count;
      progress.set(key, entry);
    }

    const now = new Date();
    return cycles.map((c) => ({
      ...c,
      status: cycleStatus(c, now),
      progress:
        progress.get(String(c._id)) ??
        ({ total: 0, completed: 0, byStatus: {} } as CycleProgress),
    }));
  }

  /**
   * Both-or-neither, `start <= end`, and each side widened to cover its whole
   * day: a `YYYY-MM-DD` end date means "through the end of that day", so a
   * cycle ending today must still read `current` (see `cycleStatus`).
   */
  private normaliseDates(
    start?: string | null,
    end?: string | null,
  ): { startDate: Date | null; endDate: Date | null } {
    if (!start && !end) return { startDate: null, endDate: null };
    if (!start || !end) {
      throw new BadRequestException(
        'A scheduled cycle needs both a start and an end date',
      );
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(+startDate) || Number.isNaN(+endDate)) {
      throw new BadRequestException('Invalid cycle dates');
    }
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    if (startDate > endDate) {
      throw new BadRequestException('Cycle start date must be before its end date');
    }
    return { startDate, endDate };
  }

  /**
   * A project runs one cycle at a time — overlapping sprints make "what are we
   * working on now" unanswerable, and `cycleStatus` could report two `current`
   * cycles. Drafts (no dates) are exempt and may pile up freely.
   *
   * Standard interval intersection: existing.start <= new.end AND
   * existing.end >= new.start.
   */
  private async assertNoOverlap(
    projectId: Types.ObjectId,
    startDate: Date | null,
    endDate: Date | null,
    excludeId?: Types.ObjectId,
  ) {
    if (!startDate || !endDate) return;

    const filter: FilterQuery<CycleDocument> = {
      projectId,
      startDate: { $ne: null, $lte: endDate },
      endDate: { $ne: null, $gte: startDate },
    };
    if (excludeId) filter._id = { $ne: excludeId };

    const clash = await this.model.findOne(filter, { name: 1 }).lean();
    if (clash) {
      throw new BadRequestException(
        `Dates overlap the cycle "${clash.name}". A project runs one cycle at a time.`,
      );
    }
  }

  /** Load + read gate. 404 for missing, invalid, or unreadable — no leak. */
  private async loadReadable(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Cycle not found');
    const cycle = await this.model.findById(id).lean();
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (!(await this.access.canReadProjectById(userId, cycle.projectId))) {
      throw new NotFoundException('Cycle not found');
    }
    return cycle;
  }

  /** Load + write gate (hydrated, for callers that mutate). */
  private async loadWritable(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Cycle not found');
    const cycle = await this.model.findById(id);
    if (!cycle) throw new NotFoundException('Cycle not found');
    await this.access.assertProjectWritable(userId, cycle.projectId);
    return cycle;
  }
}
