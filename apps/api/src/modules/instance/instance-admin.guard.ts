import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstanceAdmin,
  InstanceAdminDocument,
} from './schemas/instance-admin.schema';

/**
 * Allows the request only if the authenticated user is an instance admin.
 * Runs AFTER the global JwtAuthGuard, so `req.user` is already populated.
 * Apply with `@UseGuards(InstanceAdminGuard)` on admin-only endpoints.
 */
@Injectable()
export class InstanceAdminGuard implements CanActivate {
  constructor(
    @InjectModel(InstanceAdmin.name)
    private admins: Model<InstanceAdminDocument>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.id;
    if (!userId) throw new ForbiddenException('Not authenticated');

    const exists = await this.admins.exists({
      userId: new Types.ObjectId(userId),
    });
    if (!exists) {
      throw new ForbiddenException('Instance admin access required');
    }
    return true;
  }
}
