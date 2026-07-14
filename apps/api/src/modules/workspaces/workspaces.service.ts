import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import {
  InstanceAdmin,
  InstanceAdminDocument,
} from '../instance/schemas/instance-admin.schema';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/workspace.dto';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

type PopulatedUser = { _id: Types.ObjectId; name?: string; email?: string };

@Injectable()
export class WorkspacesService implements OnModuleInit {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(InstanceAdmin.name)
    private adminModel: Model<InstanceAdminDocument>,
  ) {}

  /**
   * One-time, idempotent migration: any project without a workspace is moved
   * into a "Default" workspace so the workspace-scoped model has full coverage.
   * Skips entirely when there are no orphan projects.
   */
  async onModuleInit() {
    const orphans = await this.projectModel.countDocuments({
      workspaceId: null,
    });
    if (orphans === 0) return;

    const owner = await this.pickDefaultOwner();
    if (!owner) {
      this.logger.warn(
        `${orphans} project(s) without a workspace, but no user to own a default workspace yet — skipping backfill.`,
      );
      return;
    }

    let def = await this.workspaceModel.findOne({ slug: 'default' });
    if (!def) {
      def = await this.workspaceModel.create({
        name: 'Default',
        slug: 'default',
        desc: 'Auto-created to hold projects from before workspaces existed.',
        ownerId: owner,
        members: [owner],
      });
    }
    const res = await this.projectModel.updateMany(
      { workspaceId: null },
      { $set: { workspaceId: def._id } },
    );
    this.logger.log(
      `Backfilled ${res.modifiedCount} project(s) into the Default workspace.`,
    );
  }

  private async pickDefaultOwner(): Promise<Types.ObjectId | null> {
    const admin = await this.adminModel.findOne().sort({ createdAt: 1 }).lean();
    if (admin?.userId) return admin.userId as Types.ObjectId;
    const anyUser = await this.userModel.findOne({}, { _id: 1 }).lean();
    return anyUser ? (anyUser._id as Types.ObjectId) : null;
  }

  private async resolveMembers(emails: string[], ownerId: Types.ObjectId) {
    const ids = new Set<string>([ownerId.toString()]);
    if (emails.length) {
      const users = await this.userModel
        .find(
          { email: { $in: emails.map((e) => e.toLowerCase().trim()) } },
          { _id: 1 },
        )
        .lean();
      users.forEach((u) => ids.add(String(u._id)));
    }
    return Array.from(ids).map((id) => new Types.ObjectId(id));
  }

  /** Pick a unique slug, appending -2, -3… on collision. */
  private async uniqueSlug(base: string): Promise<string> {
    const root = slugify(base) || 'workspace';
    let candidate = root;
    for (let n = 2; await this.workspaceModel.exists({ slug: candidate }); n++) {
      candidate = `${root}-${n}`;
    }
    return candidate;
  }

  private shape(w: WorkspaceDocument | any, projectCount = 0) {
    const owner = w.ownerId as PopulatedUser | Types.ObjectId | null;
    const ownerObj =
      owner && typeof owner === 'object' && 'email' in owner
        ? { id: String(owner._id), name: owner.name, email: owner.email }
        : null;
    return {
      id: String(w._id),
      name: w.name,
      slug: w.slug,
      desc: w.desc,
      color: w.color,
      owner: ownerObj,
      memberCount: Array.isArray(w.members) ? w.members.length : 0,
      projectCount,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  }

  /** projectCount keyed by workspaceId string, for a set of workspaces. */
  private async projectCounts(
    ids: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.projectModel.aggregate<{
      _id: Types.ObjectId;
      count: number;
    }>([
      { $match: { workspaceId: { $in: ids } } },
      { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  /** Instance-admin overview: every workspace on the instance. */
  async listAll() {
    const rows = await this.workspaceModel
      .find()
      .populate('ownerId', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    const counts = await this.projectCounts(rows.map((r) => r._id));
    return rows.map((r) => this.shape(r, counts.get(String(r._id)) ?? 0));
  }

  /** Workspaces the given user owns or belongs to. */
  async listForUser(userId: string) {
    const me = new Types.ObjectId(userId);
    const rows = await this.workspaceModel
      .find({ $or: [{ ownerId: me }, { members: me }] })
      .populate('ownerId', 'name email')
      .sort({ updatedAt: -1 })
      .lean();
    const counts = await this.projectCounts(rows.map((r) => r._id));
    return rows.map((r) => this.shape(r, counts.get(String(r._id)) ?? 0));
  }

  async byId(id: string) {
    const w = await this.workspaceModel
      .findById(id)
      .populate('ownerId', 'name email')
      .lean();
    if (!w) throw new NotFoundException();
    const counts = await this.projectCounts([w._id]);
    return this.shape(w, counts.get(String(w._id)) ?? 0);
  }

  /** Full detail for the admin drawer: workspace + members + its projects. */
  async detail(id: string) {
    const w = await this.workspaceModel
      .findById(id)
      .populate('ownerId', 'name email')
      .lean();
    if (!w) throw new NotFoundException();

    // Fetch members explicitly (array-path populate is finicky with .lean()).
    const memberIds = (w.members as Types.ObjectId[]) ?? [];
    const memberDocs = memberIds.length
      ? await this.userModel
          .find({ _id: { $in: memberIds } }, { name: 1, email: 1 })
          .lean()
      : [];

    const projects = await this.projectModel
      .find({ workspaceId: w._id }, { name: 1, color: 1, visibility: 1 })
      .sort({ name: 1 })
      .lean();

    const base = this.shape(w, projects.length);
    return {
      ...base,
      members: memberDocs.map((m) => ({
        id: String(m._id),
        name: m.name,
        email: m.email,
      })),
      projects: projects.map((p) => ({
        id: String(p._id),
        name: p.name,
        color: p.color,
        visibility: p.visibility,
      })),
    };
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const owner = new Types.ObjectId(userId);
    const members = await this.resolveMembers(dto.memberEmails, owner);
    let slug: string;
    if (dto.slug) {
      if (await this.workspaceModel.exists({ slug: dto.slug })) {
        throw new ConflictException('That slug is already taken');
      }
      slug = dto.slug;
    } else {
      slug = await this.uniqueSlug(dto.name);
    }
    const created = await this.workspaceModel.create({
      name: dto.name,
      slug,
      desc: dto.desc,
      color: dto.color,
      ownerId: owner,
      members,
    });
    return this.byId(String(created._id));
  }

  private async applyUpdate(w: WorkspaceDocument, dto: UpdateWorkspaceDto) {
    if (dto.name) w.name = dto.name;
    if (dto.desc !== undefined) w.desc = dto.desc;
    if (dto.color) w.color = dto.color;
    if (dto.slug && dto.slug !== w.slug) {
      if (await this.workspaceModel.exists({ slug: dto.slug })) {
        throw new ConflictException('That slug is already taken');
      }
      w.slug = dto.slug;
    }
    if (dto.memberEmails)
      w.members = await this.resolveMembers(dto.memberEmails, w.ownerId);
    await w.save();
    return this.byId(String(w._id));
  }

  async update(userId: string, id: string, dto: UpdateWorkspaceDto) {
    const w = await this.workspaceModel.findById(id);
    if (!w) throw new NotFoundException();
    if (String(w.ownerId) !== userId) throw new ForbiddenException();
    return this.applyUpdate(w, dto);
  }

  /** Instance-admin edit — no ownership requirement. */
  async adminUpdate(id: string, dto: UpdateWorkspaceDto) {
    const w = await this.workspaceModel.findById(id);
    if (!w) throw new NotFoundException();
    return this.applyUpdate(w, dto);
  }

  // ── Members (instance-admin) ──────────────────────────────────────
  async addMember(id: string, email: string) {
    const w = await this.workspaceModel.findById(id);
    if (!w) throw new NotFoundException();
    const user = await this.userModel
      .findOne({ email: email.toLowerCase().trim() }, { _id: 1 })
      .lean();
    if (!user) throw new NotFoundException('No user with that email');
    const uid = user._id as Types.ObjectId;
    if (w.members.some((m) => String(m) === String(uid))) {
      throw new ConflictException('Already a member');
    }
    w.members.push(uid);
    await w.save();
    return this.detail(id);
  }

  async removeMember(id: string, userId: string) {
    const w = await this.workspaceModel.findById(id);
    if (!w) throw new NotFoundException();
    if (String(w.ownerId) === userId) {
      throw new ConflictException('Cannot remove the owner');
    }
    w.members = w.members.filter((m) => String(m) !== userId);
    await w.save();
    return this.detail(id);
  }

  // ── Project assignment (instance-admin) ───────────────────────────
  /** Projects in this workspace, plus any currently unassigned ones. */
  async availableProjects(id: string) {
    const wid = new Types.ObjectId(id);
    const rows = await this.projectModel
      .find(
        { $or: [{ workspaceId: wid }, { workspaceId: null }] },
        { name: 1, color: 1, workspaceId: 1 },
      )
      .sort({ name: 1 })
      .lean();
    return rows.map((p) => ({
      id: String(p._id),
      name: p.name,
      color: p.color,
      assigned: String(p.workspaceId) === String(wid),
    }));
  }

  async assignProject(id: string, projectId: string) {
    const w = await this.workspaceModel.exists({ _id: new Types.ObjectId(id) });
    if (!w) throw new NotFoundException('Workspace not found');
    const res = await this.projectModel.updateOne(
      { _id: new Types.ObjectId(projectId) },
      { $set: { workspaceId: new Types.ObjectId(id) } },
    );
    if (res.matchedCount === 0) throw new NotFoundException('Project not found');
    return this.detail(id);
  }

  async unassignProject(id: string, projectId: string) {
    const res = await this.projectModel.updateOne(
      { _id: new Types.ObjectId(projectId), workspaceId: new Types.ObjectId(id) },
      { $set: { workspaceId: null } },
    );
    if (res.matchedCount === 0)
      throw new NotFoundException('Project not in this workspace');
    return this.detail(id);
  }

  /** Owner-initiated delete. */
  async remove(userId: string, id: string) {
    const w = await this.workspaceModel.findById(id);
    if (!w) throw new NotFoundException();
    if (String(w.ownerId) !== userId) throw new ForbiddenException();
    await this.detach(w._id);
    await this.workspaceModel.deleteOne({ _id: w._id });
    return { ok: true };
  }

  /** Instance-admin delete — no ownership requirement. */
  async adminRemove(id: string) {
    const wid = new Types.ObjectId(id);
    const exists = await this.workspaceModel.exists({ _id: wid });
    if (!exists) throw new NotFoundException();
    await this.detach(wid);
    await this.workspaceModel.deleteOne({ _id: wid });
    return { ok: true };
  }

  /** Unassign projects so deleting a workspace never orphans a dangling ref. */
  private async detach(workspaceId: Types.ObjectId) {
    await this.projectModel.updateMany(
      { workspaceId },
      { $set: { workspaceId: null } },
    );
  }
}
