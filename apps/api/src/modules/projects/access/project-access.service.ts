import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from '../schemas/project.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../workspaces/schemas/workspace.schema';

/** The minimal project fields the access rule needs. */
export type ProjectAccessFields = Pick<
  Project,
  'ownerId' | 'members' | 'visibility' | 'workspaceId'
>;

/**
 * The single source of truth for project read access (ADR 0003 + 0004). Depends
 * only on the Project + Workspace models, so it is a leaf that any feature module
 * can import without forming a dependency cycle. Feature services compose it with
 * their own (resource-specific) stakeholder logic for personal, project-less items.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
  ) {}

  /**
   * Membership only: owner OR member (no visibility path). Never hits the DB.
   * Used to derive write access (e.g. wiki `canWrite`).
   */
  isProjectMember(userId: string, project: ProjectAccessFields): boolean {
    const uid = String(userId);
    if (String(project.ownerId) === uid) return true;
    return (project.members ?? []).some((m) => String(m) === uid);
  }

  // ── Workspace membership ──────────────────────────────────────────

  /** Workspace membership: owner OR member. False for a missing/invalid id. */
  async isWorkspaceMember(
    userId: string,
    workspaceId: Types.ObjectId | string | null | undefined,
  ): Promise<boolean> {
    if (!workspaceId || !Types.ObjectId.isValid(String(workspaceId)))
      return false;
    const me = new Types.ObjectId(userId);
    const inWorkspace = await this.workspaceModel.exists({
      _id: workspaceId,
      $or: [{ ownerId: me }, { members: me }],
    });
    return Boolean(inWorkspace);
  }

  /**
   * Gate for workspace-scoped reads/writes (ADR 0006). Throws 404 — not 403 —
   * for a non-member, so a slug or id can't be used to enumerate workspaces.
   */
  async assertWorkspaceMember(
    userId: string,
    workspaceId: Types.ObjectId | string | null | undefined,
  ): Promise<void> {
    if (!(await this.isWorkspaceMember(userId, workspaceId))) {
      throw new NotFoundException();
    }
  }

  /** The id set of every workspace the user owns or belongs to. */
  async myWorkspaceIds(userId: string): Promise<Types.ObjectId[]> {
    const me = new Types.ObjectId(userId);
    const rows = await this.workspaceModel
      .find({ $or: [{ ownerId: me }, { members: me }] }, { _id: 1 })
      .lean();
    return rows.map((w) => w._id);
  }

  /**
   * THE canonical read rule (ADR 0003): owner OR member OR (internal/public
   * visibility AND the project sits in a workspace the user belongs to).
   */
  async canReadProject(
    userId: string,
    project: ProjectAccessFields,
  ): Promise<boolean> {
    if (this.isProjectMember(userId, project)) return true;
    if (project.visibility === 'internal' || project.visibility === 'public') {
      if (!project.workspaceId) return false;
      return this.isWorkspaceMember(userId, project.workspaceId);
    }
    return false;
  }

  /** Load the minimal access fields; null for a missing/invalid id. */
  async getAccessFields(
    projectId: Types.ObjectId | string | null | undefined,
  ): Promise<ProjectAccessFields | null> {
    if (!projectId || !Types.ObjectId.isValid(String(projectId))) return null;
    const project = await this.projectModel
      .findById(projectId, {
        ownerId: 1,
        members: 1,
        visibility: 1,
        workspaceId: 1,
      })
      .lean();
    return (project as ProjectAccessFields | null) ?? null;
  }

  /**
   * Convenience: load by id + apply the rule. Returns false for a missing,
   * invalid, or unreadable id (never throws). Callers convert false → 404.
   */
  async canReadProjectById(
    userId: string,
    projectId: Types.ObjectId | string | null | undefined,
  ): Promise<boolean> {
    const project = await this.getAccessFields(projectId);
    if (!project) return false;
    return this.canReadProject(userId, project);
  }

  /**
   * The id set of every project the user may read, matching {@link canReadProject}
   * (and {@link ProjectsService.listForUser}): owned OR member OR (internal/public
   * AND in a workspace the user belongs to). Lets list endpoints scope
   * project-linked items to what the caller can see without an N+1 per-item check.
   */
  async readableProjectIds(userId: string): Promise<Types.ObjectId[]> {
    const me = new Types.ObjectId(userId);
    const workspaceIds = await this.myWorkspaceIds(userId);
    const projects = await this.projectModel
      .find(
        {
          $or: [
            { ownerId: me },
            { members: me },
            {
              visibility: { $in: ['internal', 'public'] },
              workspaceId: { $in: workspaceIds },
            },
          ],
        },
        { _id: 1 },
      )
      .lean();
    return projects.map((p) => p._id);
  }

  /**
   * ADR 0011 §2a (the seam planned in ADR 0006 §4): the subset of
   * {@link readableProjectIds} whose project sits in the given workspace. A
   * plain intersection — no membership assert. For a non-member the visibility
   * branch contributes nothing (the workspace is not in their set), so their
   * result is empty unless they own/joined a project parked there; either way
   * it only ever contains projects the caller could already read. Invalid or
   * unknown `workspaceId` → empty array, never a throw.
   */
  async readableProjectIdsInWorkspace(
    userId: string,
    workspaceId: Types.ObjectId | string | null | undefined,
  ): Promise<Types.ObjectId[]> {
    if (!workspaceId || !Types.ObjectId.isValid(String(workspaceId))) {
      return [];
    }
    const readable = await this.readableProjectIds(userId);
    if (readable.length === 0) return [];
    const projects = await this.projectModel
      .find(
        {
          _id: { $in: readable },
          workspaceId: new Types.ObjectId(String(workspaceId)),
        },
        { _id: 1 },
      )
      .lean();
    return projects.map((p) => p._id);
  }

  // ── Write gate (ADR 0005: members + stakeholders) ──────────────────

  /**
   * Membership-required write gate for a specific project. No-op for a personal
   * item (`projectId` null) — the caller allows those on its own terms (e.g.
   * creating a personal issue). Throws 404 when the project is gone or the
   * caller can't read it (no existence leak), 403 when readable but not a member.
   */
  async assertProjectWritable(
    userId: string,
    projectId: Types.ObjectId | string | null | undefined,
  ): Promise<void> {
    if (!projectId) return;
    const project = await this.getAccessFields(projectId);
    if (!project) throw new NotFoundException();
    if (this.isProjectMember(userId, project)) return;
    if (await this.canReadProject(userId, project)) {
      throw new ForbiddenException();
    }
    throw new NotFoundException();
  }

  /**
   * Write authorization for an EXISTING project-linked item (ADR 0005): allowed
   * when the caller is a stakeholder of the item OR a member of its project.
   * `isStakeholder` is computed by the caller from the loaded item (issue
   * author/assignee, MR author/reviewer/decidedBy, wiki author…). A personal
   * item (null project) is writable only by its stakeholders. Throws 404/403 as
   * {@link assertProjectWritable}.
   */
  async assertCanWrite(
    userId: string,
    projectId: Types.ObjectId | string | null | undefined,
    isStakeholder: boolean,
  ): Promise<void> {
    if (isStakeholder) return;
    if (!projectId) throw new NotFoundException();
    return this.assertProjectWritable(userId, projectId);
  }
}
