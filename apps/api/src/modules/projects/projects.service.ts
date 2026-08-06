import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../workspaces/schemas/workspace.schema';
import { ProjectAccessService } from './access/project-access.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import {
  CreateProjectDto,
  DuplicateListDto,
  UpdateBoardDto,
  UpdateOverviewDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationsService } from '../automations/automations.service';
import {
  WikiPage,
  WikiPageDocument,
} from '../wiki/schemas/wiki-page.schema';
import { View, ViewDocument } from '../views/schemas/view.schema';
import {
  anchorFor,
  isDuplicateAnchorError,
  mintUniqueAnchor,
  PublishOptionsDto,
} from '../../common/anchor.util';

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/\s+/g, '-').slice(0, 60);

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    private access: ProjectAccessService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    private notifs: NotificationsService,
    private autos: AutomationsService,
    // Anchor-collision checks only (ADR 0012 §2): minting scans all three
    // published-content collections so the anchor namespace is global.
    @InjectModel(WikiPage.name) private wikiModel: Model<WikiPageDocument>,
    @InjectModel(View.name) private viewModel: Model<ViewDocument>,
  ) {}

  private async notifyNewMembers(
    project: ProjectDocument,
    actorId: string,
    newMemberIds: string[],
  ) {
    if (newMemberIds.length === 0) return;
    await this.notifs.pushMany(newMemberIds, {
      actorId,
      type: 'project_member',
      title: 'Added to project',
      subject: project.name,
      link: `/projects/${project._id}`,
      entityRef: { kind: 'project', id: String(project._id) },
    });
  }

  private async resolveMembers(emails: string[], ownerId: Types.ObjectId) {
    const ids = new Set<string>([ownerId.toString()]);
    if (emails.length) {
      const users = await this.userModel
        .find({ email: { $in: emails } }, { _id: 1 })
        .lean();
      users.forEach((u) => ids.add(String(u._id)));
    }
    return Array.from(ids).map((id) => new Types.ObjectId(id));
  }

  async listForUser(userId: string) {
    const me = new Types.ObjectId(userId);
    // Scope `internal`/`public` visibility to workspaces the user belongs to,
    // so the instance behaves as isolated tenants rather than one shared pool.
    // Owned / member projects stay visible regardless of workspace.
    const workspaceIds = await this.access.myWorkspaceIds(userId);
    const projects = await this.projectModel
      .find({
        $or: [
          { ownerId: me },
          { members: me },
          {
            visibility: { $in: ['internal', 'public'] },
            workspaceId: { $in: workspaceIds },
          },
        ],
      })
      .select('-overview')
      .sort({ updatedAt: -1 })
      .lean();
    return this.withIssueCounts(projects);
  }

  /**
   * Strict workspace isolation (ADR 0006): a project is listed if and only if its
   * `workspaceId` matches — including ones the caller owns but that live in
   * another workspace. Deliberately NOT {@link listForUser}'s rule, whose owner/
   * member branches are workspace-independent by design (ADR 0003). Used by the
   * workspace-scoped project list so the view means exactly what it says.
   */
  async listInWorkspace(userId: string, workspaceId: string) {
    await this.access.assertWorkspaceMember(userId, workspaceId);
    const projects = await this.projectModel
      .find({ workspaceId: new Types.ObjectId(workspaceId) })
      .select('-overview')
      .sort({ updatedAt: -1 })
      .lean();
    return this.withIssueCounts(projects);
  }

  /** Attach issueCount/doneCount to a project list in one aggregate. */
  private async withIssueCounts<T extends { _id: Types.ObjectId }>(
    projects: T[],
  ) {
    if (!projects.length) return projects;

    const counts = await this.issueModel.aggregate<{
      _id: Types.ObjectId;
      total: number;
      done: number;
    }>([
      { $match: { projectId: { $in: projects.map((p) => p._id) } } },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          done: {
            $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] },
          },
        },
      },
    ]);
    const byProject = new Map(
      counts.map((c) => [String(c._id), c]),
    );
    return projects.map((p) => ({
      ...p,
      issueCount: byProject.get(String(p._id))?.total ?? 0,
      doneCount: byProject.get(String(p._id))?.done ?? 0,
    }));
  }

  /**
   * The single source of truth for "can this user read this project", matching
   * {@link listForUser}: owner OR member OR (internal/public visibility AND the
   * project sits in a workspace the user belongs to). See ADR 0003.
   */
  async canRead(
    userId: string,
    project: Pick<
      Project,
      'ownerId' | 'members' | 'visibility' | 'workspaceId'
    >,
  ): Promise<boolean> {
    return this.access.canReadProject(userId, project);
  }

  async byId(userId: string, id: string) {
    const p = await this.projectModel.findById(id).lean();
    if (!p) throw new NotFoundException();
    // 404 (not 403) on no-access so we don't leak that the project exists.
    if (!(await this.canRead(userId, p))) throw new NotFoundException();
    return p;
  }

  /**
   * Project members (owner included) with the fields needed to name a person,
   * for the AI assistant's `list_project_members` tool.
   *
   * Gated by the ordinary project read rule via {@link byId}, so it exposes no
   * one the caller could not already see on the project page — and it exists so
   * the assistant can *look up* an assignee id rather than guess one (ADR 0015
   * §2.3).
   */
  async membersForAssistant(userId: string, projectId: string) {
    const project = await this.byId(userId, projectId);
    const ids = [project.ownerId, ...(project.members ?? [])];
    const users = await this.userModel
      .find({ _id: { $in: ids } }, { name: 1, email: 1 })
      .lean();
    const ownerId = String(project.ownerId);
    return users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      role: String(u._id) === ownerId ? 'owner' : 'member',
    }));
  }

  async create(userId: string, dto: CreateProjectDto) {
    const owner = new Types.ObjectId(userId);
    const members = await this.resolveMembers(dto.memberEmails, owner);
    // Can't create into a workspace you don't belong to (ADR 0006).
    if (dto.workspaceId) {
      await this.access.assertWorkspaceMember(userId, dto.workspaceId);
    }
    const project = await this.projectModel.create({
      name: dto.name,
      desc: dto.desc,
      visibility: dto.visibility,
      color: dto.color,
      coverImage: dto.coverImage ?? null,
      namespace: slug(dto.name),
      ownerId: owner,
      workspaceId: dto.workspaceId
        ? new Types.ObjectId(dto.workspaceId)
        : null,
      members,
    });
    const newMemberIds = members
      .map((m) => String(m))
      .filter((m) => m !== userId);
    await this.notifyNewMembers(project, userId, newMemberIds);
    for (const memberId of newMemberIds) {
      this.autos.fire('project.member_added', {
        projectId: String(project._id),
        projectName: project.name,
        memberId,
      }).catch(() => {});
    }
    return project;
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    if (String(project.ownerId) !== userId) throw new ForbiddenException();

    const prevMembers = new Set(project.members.map((m) => String(m)));

    if (dto.name) {
      project.name = dto.name;
      project.namespace = slug(dto.name);
    }
    if (dto.desc !== undefined) project.desc = dto.desc;
    if (dto.visibility) project.visibility = dto.visibility;
    if (dto.color) project.color = dto.color;
    // `!== undefined`, not truthy: null is a meaningful value (clears the cover).
    if (dto.coverImage !== undefined) project.coverImage = dto.coverImage;
    if (dto.memberEmails)
      project.members = await this.resolveMembers(
        dto.memberEmails,
        project.ownerId,
      );

    const saved = await project.save();

    if (dto.memberEmails) {
      const added = saved.members
        .map((m) => String(m))
        .filter((m) => !prevMembers.has(m) && m !== userId);
      await this.notifyNewMembers(saved, userId, added);
      for (const memberId of added) {
        this.autos.fire('project.member_added', {
          projectId: String(saved._id),
          projectName: saved.name,
          memberId,
        }).catch(() => {});
      }
    }

    return saved;
  }

  /**
   * Replace the project Overview blocks. Unlike {@link update} (owner-only), the
   * Overview is collaborative: any project member may edit it. `assertProjectWritable`
   * throws 404 (unreadable/missing) or 403 (readable but not a member).
   */
  async updateOverview(userId: string, id: string, dto: UpdateOverviewDto) {
    await this.access.assertProjectWritable(userId, id);
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    project.overview = dto.overview as typeof project.overview;
    const saved = await project.save();
    return saved.toObject();
  }

  /**
   * Replace the project's Kanban board columns. Collaborative like the Overview:
   * any project member may edit. Handles add / rename / recolor / WIP-limit /
   * collapse / reorder — everything that only touches list metadata.
   */
  async updateBoard(userId: string, id: string, dto: UpdateBoardDto) {
    await this.access.assertProjectWritable(userId, id);
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    project.boardLists = dto.boardLists as typeof project.boardLists;
    const saved = await project.save();
    return saved.toObject();
  }

  /** Delete every card (issue) in one board list, leaving the list itself. */
  async clearList(userId: string, id: string, listId: string) {
    await this.access.assertProjectWritable(userId, id);
    await this.issueModel.deleteMany({
      projectId: new Types.ObjectId(id),
      status: listId,
    });
    const project = await this.projectModel.findById(id).lean();
    if (!project) throw new NotFoundException();
    return project;
  }

  /** Remove a board list and delete all of its cards. */
  async deleteList(userId: string, id: string, listId: string) {
    await this.access.assertProjectWritable(userId, id);
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    project.boardLists = project.boardLists.filter(
      (l) => l.id !== listId,
    ) as typeof project.boardLists;
    const [saved] = await Promise.all([
      project.save(),
      this.issueModel.deleteMany({
        projectId: new Types.ObjectId(id),
        status: listId,
      }),
    ]);
    return saved.toObject();
  }

  /**
   * Clone a board list — its metadata (new id + given name) plus every card in
   * it — inserting the copy immediately after the source list.
   */
  async duplicateList(
    userId: string,
    id: string,
    listId: string,
    dto: DuplicateListDto,
  ) {
    await this.access.assertProjectWritable(userId, id);
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    const idx = project.boardLists.findIndex((l) => l.id === listId);
    if (idx === -1) throw new NotFoundException();

    const source = project.boardLists[idx];
    const newId = new Types.ObjectId().toString();
    const copy = {
      id: newId,
      name: dto.name,
      color: source.color,
      wipLimit: source.wipLimit,
      collapsed: false,
    };
    project.boardLists.splice(idx + 1, 0, copy as (typeof project.boardLists)[0]);

    const cards = await this.issueModel
      .find({ projectId: new Types.ObjectId(id), status: listId })
      .lean();
    if (cards.length) {
      await this.issueModel.insertMany(
        cards.map((c) => ({
          projectId: c.projectId,
          title: c.title,
          desc: c.desc,
          type: c.type,
          status: newId,
          priority: c.priority,
          assigneeId: c.assigneeId,
          authorId: new Types.ObjectId(userId),
          dueDate: c.dueDate,
          labels: c.labels,
          todos: c.todos,
        })),
      );
    }
    const saved = await project.save();
    return saved.toObject();
  }

  /**
   * Publish the project's board to the public Space (ADR 0012 §4). Project
   * OWNER only — the same gate as the ADR 0010 cover mutation (`update`):
   * members cannot expose a project to the internet. Mints a stable `anchor`
   * on first publish and reuses it thereafter.
   */
  async publish(userId: string, id: string, opts: PublishOptionsDto = {}) {
    const project = await this.loadOwned(userId, id);

    if (!project.anchor) {
      project.anchor = await mintUniqueAnchor(project.name, [
        this.wikiModel,
        this.viewModel,
        this.projectModel,
      ]);
    }
    project.isPublic = true;
    project.publishedAt = new Date();
    project.publishedBy = new Types.ObjectId(userId);
    // Explicit boolean only — re-publishing must not silently re-open a project
    // its owner had marked noindex (docs/plan/01 §3.4).
    if (opts.indexing !== undefined) project.publicIndexing = opts.indexing;
    try {
      await project.save();
    } catch (err) {
      // E11000 on the partial unique index — the backstop (ADR 0012 §2):
      // re-mint once and retry.
      if (!isDuplicateAnchorError(err)) throw err;
      project.anchor = anchorFor(project.name);
      await project.save();
    }

    return {
      anchor: project.anchor,
      isPublic: project.isPublic,
      publishedAt: project.publishedAt,
      indexing: project.publicIndexing,
    };
  }

  /**
   * Unpublish (ADR 0012 §4). Keeps the `anchor` so a later re-publish yields
   * the same URL. Owner only, like {@link publish}.
   */
  async unpublish(userId: string, id: string) {
    const project = await this.loadOwned(userId, id);
    project.isPublic = false;
    await project.save();
    return { isPublic: project.isPublic };
  }

  /** Owner-only load for publish/unpublish (mirrors the `update` gate). */
  private async loadOwned(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    if (String(project.ownerId) !== userId) throw new ForbiddenException();
    return project;
  }

  async remove(userId: string, id: string) {
    const project = await this.projectModel.findById(id);
    if (!project) throw new NotFoundException();
    if (String(project.ownerId) !== userId) throw new ForbiddenException();
    await Promise.all([
      this.projectModel.deleteOne({ _id: project._id }),
      this.issueModel.deleteMany({ projectId: project._id }),
    ]);
    return { ok: true };
  }
}
