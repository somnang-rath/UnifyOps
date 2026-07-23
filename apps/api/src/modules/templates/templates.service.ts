import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  IssueTemplate,
  IssueTemplateDocument,
} from './schemas/issue-template.schema';
import {
  CreateTemplateDto,
  ListTemplatesQuery,
  UpdateTemplateDto,
} from './dto/template.dto';
import { ProjectAccessService } from '../projects/access/project-access.service';

const oid = (v: string) => new Types.ObjectId(v);

@Injectable()
export class TemplatesService {
  constructor(
    @InjectModel(IssueTemplate.name)
    private model: Model<IssueTemplateDocument>,
    private access: ProjectAccessService,
  ) {}

  /**
   * Templates in a workspace, member-gated (ADR 0006: 404 for non-members so
   * workspace ids can't be enumerated). With `projectId`: that project's
   * templates merged with the workspace-level (projectId null) ones. The
   * workspaceId filter stays on regardless, so a cross-workspace projectId
   * can never pull another tenant's templates.
   */
  async list(userId: string, q: ListTemplatesQuery) {
    await this.access.assertWorkspaceMember(userId, q.workspaceId);
    const filter: FilterQuery<IssueTemplateDocument> = {
      workspaceId: oid(q.workspaceId),
    };
    if (q.projectId) {
      filter.$or = [{ projectId: oid(q.projectId) }, { projectId: null }];
    }
    return this.model
      .find(filter)
      .sort({ position: 1, updatedAt: -1 })
      .lean();
  }

  async create(userId: string, dto: CreateTemplateDto) {
    let workspaceId: Types.ObjectId;

    if (dto.projectId) {
      // A project template must live in that project's workspace, and the
      // caller must be able to write there.
      await this.access.assertProjectWritable(userId, dto.projectId);
      const fields = await this.access.getAccessFields(dto.projectId);
      if (!fields?.workspaceId) {
        throw new BadRequestException(
          'Project has no workspace; cannot attach a template',
        );
      }
      workspaceId = fields.workspaceId as Types.ObjectId;
    } else {
      if (!dto.workspaceId) {
        throw new BadRequestException(
          'workspaceId is required for a workspace-level template',
        );
      }
      await this.access.assertWorkspaceMember(userId, dto.workspaceId);
      workspaceId = oid(dto.workspaceId);
    }

    const last = await this.model
      .findOne({
        workspaceId,
        projectId: dto.projectId ? oid(dto.projectId) : null,
      })
      .sort({ position: -1 })
      .lean();

    const created = await this.model.create({
      workspaceId,
      projectId: dto.projectId ? oid(dto.projectId) : null,
      name: dto.name,
      defaults: dto.defaults,
      createdBy: oid(userId),
      position: (last?.position ?? -1) + 1,
    });
    return created.toObject();
  }

  async update(userId: string, id: string, dto: UpdateTemplateDto) {
    const tpl = await this.loadForMember(userId, id);
    if (dto.name !== undefined) tpl.name = dto.name;
    if (dto.defaults !== undefined) tpl.defaults = dto.defaults;
    if (dto.position !== undefined) tpl.position = dto.position;
    await tpl.save();
    return tpl.toObject();
  }

  async remove(userId: string, id: string) {
    const tpl = await this.loadForMember(userId, id);
    await tpl.deleteOne();
    return { ok: true };
  }

  /**
   * Load a template, gated on membership of its workspace. 404 — not 403 —
   * for a non-member, so another tenant can't probe template existence.
   */
  private async loadForMember(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const tpl = await this.model.findById(id);
    if (!tpl) throw new NotFoundException();
    await this.access.assertWorkspaceMember(userId, tpl.workspaceId);
    return tpl;
  }
}
