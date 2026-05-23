import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role, RoleDocument } from './schemas/role.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

export const BUILTIN_ROLES: { key: string; name: string; color: string }[] = [
  { key: 'admin', name: 'Admin', color: 'indigo' },
  { key: 'cpo', name: 'CPO', color: 'violet' },
  { key: 'marketing', name: 'Marketing', color: 'amber' },
  { key: 'sales', name: 'Sales', color: 'emerald' },
  { key: 'dev', name: 'Developer', color: 'slate' },
];

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /** Idempotently insert builtin roles. Called from bootstrap. */
  async ensureBuiltins() {
    for (const r of BUILTIN_ROLES) {
      await this.roleModel.updateOne(
        { key: r.key },
        { $setOnInsert: { ...r, builtin: true } },
        { upsert: true },
      );
    }
  }

  async list() {
    return this.roleModel.find().sort({ builtin: -1, name: 1 }).lean();
  }

  async exists(key: string) {
    return !!(await this.roleModel.exists({ key }));
  }

  async create(dto: CreateRoleDto) {
    if (await this.roleModel.exists({ key: dto.key }))
      throw new ConflictException('Role already exists');
    const r = await this.roleModel.create({
      key: dto.key,
      name: dto.name,
      color: dto.color ?? 'indigo',
      builtin: false,
    });
    return r.toObject();
  }

  async update(key: string, dto: UpdateRoleDto) {
    const r = await this.roleModel.findOne({ key });
    if (!r) throw new NotFoundException();
    if (dto.name !== undefined) r.name = dto.name;
    if (dto.color !== undefined) r.color = dto.color;
    await r.save();
    return r.toObject();
  }

  async remove(key: string) {
    const r = await this.roleModel.findOne({ key });
    if (!r) throw new NotFoundException();
    if (r.builtin)
      throw new BadRequestException('Built-in roles cannot be deleted');
    const inUse = await this.userModel.exists({ role: key });
    if (inUse)
      throw new BadRequestException(
        'Role is assigned to one or more users — reassign them first',
      );
    await this.roleModel.deleteOne({ _id: r._id });
    return { ok: true };
  }
}
