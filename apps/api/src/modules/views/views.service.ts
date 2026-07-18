import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { View, ViewDocument } from './schemas/view.schema';
import {
  CreateViewDto,
  ListViewsQuery,
  UpdateViewDto,
} from './dto/view.dto';
import { ProjectAccessService } from '../projects/access/project-access.service';

const oid = (v: string) => new Types.ObjectId(v);

@Injectable()
export class ViewsService {
  constructor(
    @InjectModel(View.name) private model: Model<ViewDocument>,
    private access: ProjectAccessService,
  ) {}

  /**
   * List views the caller may see in a scope: shared views + their own private
   * ones. A project scope requires read access to that project; a workspace
   * scope requires membership.
   */
  async list(userId: string, q: ListViewsQuery) {
    const me = oid(userId);
    const filter: FilterQuery<ViewDocument> = {
      $or: [{ isShared: true }, { ownerId: me }],
    };

    if (q.projectId) {
      if (!(await this.access.canReadProjectById(userId, q.projectId))) {
        throw new NotFoundException('Project not found');
      }
      filter.projectId = oid(q.projectId);
    } else {
      // Workspace-level views (projectId null). Scope to workspaces the user
      // belongs to so one user cannot enumerate another workspace's views.
      const workspaceIds = q.workspaceId
        ? [oid(q.workspaceId)]
        : await this.access.myWorkspaceIds(userId);
      if (q.workspaceId && !workspaceIds.some((w) => String(w) === q.workspaceId)) {
        throw new ForbiddenException('Not a member of that workspace');
      }
      filter.projectId = null;
      filter.workspaceId = { $in: workspaceIds };
    }

    return this.model.find(filter).sort({ position: 1, updatedAt: -1 }).lean();
  }

  async byId(userId: string, id: string) {
    const view = await this.model.findById(id).lean();
    if (!view) throw new NotFoundException('View not found');
    await this.assertCanRead(userId, view);
    return view;
  }

  async create(userId: string, dto: CreateViewDto) {
    let workspaceId: Types.ObjectId;

    if (dto.projectId) {
      // A project view must live in that project's workspace, and the user must
      // be able to write there — a saved view is a change to the project.
      await this.access.assertProjectWritable(userId, dto.projectId);
      const fields = await this.access.getAccessFields(dto.projectId);
      if (!fields?.workspaceId) {
        throw new BadRequestException(
          'Project has no workspace; cannot attach a view',
        );
      }
      workspaceId = fields.workspaceId as Types.ObjectId;
    } else {
      if (!dto.workspaceId) {
        throw new BadRequestException(
          'workspaceId is required for a workspace-level view',
        );
      }
      await this.access.assertWorkspaceMember(userId, dto.workspaceId);
      workspaceId = oid(dto.workspaceId);
    }

    const last = await this.model
      .findOne({ workspaceId, projectId: dto.projectId ? oid(dto.projectId) : null })
      .sort({ position: -1 })
      .lean();

    const created = await this.model.create({
      name: dto.name,
      workspaceId,
      projectId: dto.projectId ? oid(dto.projectId) : null,
      ownerId: oid(userId),
      layout: dto.layout,
      filters: dto.filters,
      groupBy: dto.groupBy,
      sortBy: dto.sortBy,
      displayProperties: dto.displayProperties,
      isShared: dto.isShared,
      position: (last?.position ?? -1) + 1,
    });
    return created.toObject();
  }

  async update(userId: string, id: string, dto: UpdateViewDto) {
    const view = await this.model.findById(id);
    if (!view) throw new NotFoundException('View not found');
    // Only the owner edits a view. Sharing it does not hand editing to readers.
    if (String(view.ownerId) !== userId) {
      throw new ForbiddenException('Only the view owner can edit it');
    }

    if (dto.name !== undefined) view.name = dto.name;
    if (dto.layout !== undefined) view.layout = dto.layout;
    if (dto.filters !== undefined) view.filters = dto.filters;
    if (dto.groupBy !== undefined) view.groupBy = dto.groupBy;
    if (dto.sortBy !== undefined) view.sortBy = dto.sortBy;
    if (dto.displayProperties !== undefined)
      view.displayProperties = dto.displayProperties;
    if (dto.isShared !== undefined) view.isShared = dto.isShared;

    await view.save();
    return view.toObject();
  }

  async remove(userId: string, id: string) {
    const view = await this.model.findById(id);
    if (!view) throw new NotFoundException('View not found');
    if (String(view.ownerId) !== userId) {
      throw new ForbiddenException('Only the view owner can delete it');
    }
    await view.deleteOne();
    return { ok: true };
  }

  /** Persist a new order for the owner's views within one scope. */
  async reorder(userId: string, ids: string[]) {
    const me = oid(userId);
    const views = await this.model.find({ _id: { $in: ids.map(oid) } });
    // All must belong to the caller — reordering is not a way to touch another
    // person's views.
    if (views.some((v) => String(v.ownerId) !== userId)) {
      throw new ForbiddenException('Can only reorder your own views');
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    await Promise.all(
      views.map((v) =>
        this.model.updateOne(
          { _id: v._id, ownerId: me },
          { $set: { position: order.get(String(v._id)) ?? v.position } },
        ),
      ),
    );
    return { ok: true };
  }

  private async assertCanRead(
    userId: string,
    view: Pick<View, 'ownerId' | 'isShared' | 'projectId' | 'workspaceId'>,
  ) {
    if (String(view.ownerId) === userId) return;
    if (!view.isShared) throw new NotFoundException('View not found');

    const ok = view.projectId
      ? await this.access.canReadProjectById(userId, view.projectId)
      : await this.access.isWorkspaceMember(userId, view.workspaceId);
    if (!ok) throw new NotFoundException('View not found');
  }
}
