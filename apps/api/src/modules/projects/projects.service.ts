import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AutomationsService } from '../automations/automations.service';

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/\s+/g, '-').slice(0, 60);

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    private notifs: NotificationsService,
    private autos: AutomationsService,
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
    const projects = await this.projectModel
      .find({
        $or: [
          { ownerId: me },
          { members: me },
          { visibility: { $in: ['internal', 'public'] } },
        ],
      })
      .sort({ updatedAt: -1 })
      .lean();
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

  async byId(id: string) {
    const p = await this.projectModel.findById(id).lean();
    if (!p) throw new NotFoundException();
    return p;
  }

  async create(userId: string, dto: CreateProjectDto) {
    const owner = new Types.ObjectId(userId);
    const members = await this.resolveMembers(dto.memberEmails, owner);
    const project = await this.projectModel.create({
      name: dto.name,
      desc: dto.desc,
      visibility: dto.visibility,
      color: dto.color,
      namespace: slug(dto.name),
      ownerId: owner,
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
