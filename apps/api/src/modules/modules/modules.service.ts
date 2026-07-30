import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  ProjectModule,
  ProjectModuleDocument,
} from './schemas/module.schema';
import {
  CreateModuleDto,
  ListModulesQuery,
  UpdateModuleDto,
} from './dto/module.dto';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { ProjectAccessService } from '../projects/access/project-access.service';

const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));

/** The single terminal status, matching `IssuesService.list`'s `closed` branch. */
const DONE = 'done';

export interface ModuleProgress {
  total: number;
  completed: number;
  byStatus: Record<string, number>;
}

@Injectable()
export class ModulesService {
  constructor(
    @InjectModel(ProjectModule.name)
    private model: Model<ProjectModuleDocument>,
    // Direct model registration, not an IssuesModule import — see the note in
    // modules.module.ts.
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    private access: ProjectAccessService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────

  /**
   * Modules in a scope, each with its progress rollup. Scope resolution mirrors
   * `CyclesService.list` (and `IssuesService.accessScope`): the filter is always
   * built from an id set the caller can already read, so there is no leak.
   *
   * `status` filters in Mongo here — unlike cycles, a module's status is a
   * stored field rather than something derived after the rollup.
   */
  async list(userId: string, q: ListModulesQuery) {
    const filter: FilterQuery<ProjectModuleDocument> = {};

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
    if (q.status) filter.status = q.status;

    const modules = await this.model
      .find(filter)
      .sort({ position: 1, createdAt: -1 })
      .lean();
    return this.attachProgress(modules);
  }

  async byId(userId: string, id: string) {
    const mod = await this.loadReadable(userId, id);
    const [withProgress] = await this.attachProgress([mod]);
    return withProgress;
  }

  /** The work items in a module. Read gate is the module's project. */
  async issues(userId: string, id: string) {
    const mod = await this.loadReadable(userId, id);
    return this.issueModel
      .find({ moduleId: mod._id })
      .sort({ status: 1, updatedAt: -1 })
      .lean();
  }

  // ── Writes ─────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateModuleDto) {
    await this.access.assertProjectWritable(userId, dto.projectId);
    const fields = await this.access.getAccessFields(dto.projectId);
    if (!fields?.workspaceId) {
      throw new BadRequestException(
        'Project has no workspace; cannot attach a module',
      );
    }

    const { startDate, targetDate } = this.normaliseDates(
      dto.startDate,
      dto.targetDate,
    );

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
      leadId: dto.leadId ? oid(dto.leadId) : null,
      memberIds: dto.memberIds.map(oid),
      startDate,
      targetDate,
      status: dto.status,
      position: (last?.position ?? -1) + 1,
    });
    const [withProgress] = await this.attachProgress([created.toObject()]);
    return withProgress;
  }

  async update(userId: string, id: string, dto: UpdateModuleDto) {
    const mod = await this.loadWritable(userId, id);

    if (dto.name !== undefined) mod.name = dto.name;
    if (dto.description !== undefined) mod.description = dto.description;
    if (dto.status !== undefined) mod.status = dto.status;
    if (dto.leadId !== undefined) mod.leadId = dto.leadId ? oid(dto.leadId) : null;
    if (dto.memberIds !== undefined) mod.memberIds = dto.memberIds.map(oid);

    if (dto.startDate !== undefined || dto.targetDate !== undefined) {
      // Validate as a pair even when one side is sent, so patching one at a
      // time cannot reach a target-before-start state.
      const { startDate, targetDate } = this.normaliseDates(
        dto.startDate !== undefined
          ? dto.startDate
          : mod.startDate?.toISOString(),
        dto.targetDate !== undefined
          ? dto.targetDate
          : mod.targetDate?.toISOString(),
      );
      mod.startDate = startDate;
      mod.targetDate = targetDate;
    }

    await mod.save();
    const [withProgress] = await this.attachProgress([mod.toObject()]);
    return withProgress;
  }

  /**
   * Delete a module and release its items. Unassign runs FIRST for the same
   * reason as `CyclesService.remove`: a delete that lands before the unassign
   * leaves every item pointing at a row that no longer exists, whereas the
   * reverse order only risks re-running a no-op unassign.
   */
  async remove(userId: string, id: string) {
    const mod = await this.loadWritable(userId, id);
    const { modifiedCount } = await this.issueModel.updateMany(
      { moduleId: mod._id },
      { $set: { moduleId: null } },
    );
    await mod.deleteOne();
    return { ok: true, releasedIssues: modifiedCount };
  }

  /**
   * Add work items to a module. As with cycles, ids outside the module's
   * project land in `skipped` rather than 400-ing the batch, and the filter is
   * pinned to `projectId` so this can never reach across a tenant boundary.
   */
  async assign(userId: string, id: string, issueIds: string[]) {
    const mod = await this.loadWritable(userId, id);

    const eligible = await this.issueModel
      .find({ _id: { $in: issueIds.map(oid) }, projectId: mod.projectId }, { _id: 1 })
      .lean();
    const eligibleIds = eligible.map((i) => i._id);
    const eligibleSet = new Set(eligibleIds.map(String));

    if (eligibleIds.length) {
      await this.issueModel.updateMany(
        { _id: { $in: eligibleIds } },
        { $set: { moduleId: mod._id } },
      );
    }

    return {
      assigned: eligibleIds.length,
      skipped: issueIds.filter((i) => !eligibleSet.has(i)),
    };
  }

  /** Remove one item from the module. Idempotent. */
  async unassign(userId: string, id: string, issueId: string) {
    const mod = await this.loadWritable(userId, id);
    if (!Types.ObjectId.isValid(issueId)) {
      throw new NotFoundException('Work item not found');
    }
    await this.issueModel.updateOne(
      { _id: oid(issueId), moduleId: mod._id },
      { $set: { moduleId: null } },
    );
    return { ok: true };
  }

  /** Persist a new order for one project's modules. */
  async reorder(userId: string, ids: string[]) {
    const modules = await this.model.find({ _id: { $in: ids.map(oid) } });
    if (modules.length !== ids.length) {
      throw new NotFoundException('Module not found');
    }
    const projectIds = [...new Set(modules.map((m) => String(m.projectId)))];
    await Promise.all(
      projectIds.map((p) => this.access.assertProjectWritable(userId, p)),
    );

    const order = new Map(ids.map((moduleId, i) => [moduleId, i]));
    await Promise.all(
      modules.map((m) =>
        this.model.updateOne(
          { _id: m._id },
          { $set: { position: order.get(String(m._id)) ?? m.position } },
        ),
      ),
    );
    return { ok: true };
  }

  // ── Internals ──────────────────────────────────────────────────────

  /** One grouped count for the whole page rather than a query per module. */
  private async attachProgress<T extends { _id: Types.ObjectId }>(modules: T[]) {
    if (modules.length === 0) return [];

    const rows = await this.issueModel.aggregate<{
      _id: { moduleId: Types.ObjectId; status: string };
      count: number;
    }>([
      { $match: { moduleId: { $in: modules.map((m) => m._id) } } },
      {
        $group: {
          _id: { moduleId: '$moduleId', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]);

    const progress = new Map<string, ModuleProgress>();
    for (const row of rows) {
      const key = String(row._id.moduleId);
      const entry = progress.get(key) ?? { total: 0, completed: 0, byStatus: {} };
      entry.total += row.count;
      if (row._id.status === DONE) entry.completed += row.count;
      entry.byStatus[row._id.status] =
        (entry.byStatus[row._id.status] ?? 0) + row.count;
      progress.set(key, entry);
    }

    return modules.map((m) => ({
      ...m,
      progress:
        progress.get(String(m._id)) ??
        ({ total: 0, completed: 0, byStatus: {} } as ModuleProgress),
    }));
  }

  /**
   * Each side is independently optional (unlike a cycle), so the only rule is
   * ordering when both are present. Dates are widened to cover their whole day
   * so a target date reads as "by the end of that day".
   */
  private normaliseDates(
    start?: string | null,
    target?: string | null,
  ): { startDate: Date | null; targetDate: Date | null } {
    const parse = (v: string | null | undefined, endOfDay: boolean) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(+d)) throw new BadRequestException('Invalid module dates');
      if (endOfDay) d.setHours(23, 59, 59, 999);
      else d.setHours(0, 0, 0, 0);
      return d;
    };

    const startDate = parse(start, false);
    const targetDate = parse(target, true);
    if (startDate && targetDate && startDate > targetDate) {
      throw new BadRequestException(
        'A module cannot target a date before it starts',
      );
    }
    return { startDate, targetDate };
  }

  /** Load + read gate. 404 for missing, invalid, or unreadable — no leak. */
  private async loadReadable(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Module not found');
    const mod = await this.model.findById(id).lean();
    if (!mod) throw new NotFoundException('Module not found');
    if (!(await this.access.canReadProjectById(userId, mod.projectId))) {
      throw new NotFoundException('Module not found');
    }
    return mod;
  }

  /** Load + write gate (hydrated, for callers that mutate). */
  private async loadWritable(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Module not found');
    const mod = await this.model.findById(id);
    if (!mod) throw new NotFoundException('Module not found');
    await this.access.assertProjectWritable(userId, mod.projectId);
    return mod;
  }
}
