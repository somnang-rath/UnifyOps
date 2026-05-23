import {
  Body,
  Controller,
  HttpCode,
  Param,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RolesService } from './roles.service';
import { EmailService } from '../notifications/email.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AdminUpdateUserDto,
  AdminUpdateUserSchema,
  InviteUserDto,
  InviteUserSchema,
} from '../users/dto/users.dto';

@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private users: UsersService,
    private roles: RolesService,
    private email: EmailService,
  ) {}

  @Roles('admin')
  @Post('invite')
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(InviteUserSchema))
  async invite(@Body() dto: InviteUserDto) {
    const { user, rawToken } = await this.users.inviteUser(dto, (key) =>
      this.roles.exists(key),
    );
    const msg = this.email.buildInviteEmail({
      name: user.name,
      email: user.email,
      role: user.role,
      token: rawToken,
    });
    await this.email.send({ to: user.email, ...msg });
    return { user };
  }

  @Roles('admin')
  @Post(':id/resend-invite')
  @HttpCode(200)
  async resendInvite(@Param('id') id: string) {
    const { user, rawToken } = await this.users.resendInvite(id);
    const msg = this.email.buildInviteEmail({
      name: user.name,
      email: user.email,
      role: user.role,
      token: rawToken,
    });
    await this.email.send({ to: user.email, ...msg });
    return { ok: true };
  }

  @Roles('admin')
  @Patch(':id')
  @UsePipes(new ZodValidationPipe(AdminUpdateUserSchema))
  update(
    @CurrentUser() me: { id: string },
    @Param('id') id: string,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.users.adminUpdate(me.id, id, dto, (key) =>
      this.roles.exists(key),
    );
  }
}
