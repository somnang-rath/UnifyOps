import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InstanceService } from './instance.service';
import { InstanceAdminGuard } from './instance-admin.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  RequireAudience,
  RequireStepUp,
} from '../../common/decorators/audience.decorator';
import { AUD_ADMIN } from '../../common/auth/audience';
import { Audit } from '../audit/audit.decorator';
import {
  AddAdminDto,
  AddAdminSchema,
  TestEmailDto,
  TestEmailSchema,
  UpdateConfigDto,
  UpdateConfigSchema,
  UpdateInstanceDto,
  UpdateInstanceSchema,
} from './dto/instance.dto';

@Controller('instance')
export class InstanceController {
  constructor(private instance: InstanceService) {}

  // ── Public bootstrap (no auth) ────────────────────────────────────
  @Public()
  @Get()
  getPublic() {
    return this.instance.getPublicInstance();
  }

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.instance.getSetupStatus();
  }

  /** Authenticated user claims the instance when no admin exists yet. */
  @Audit('instance.setup')
  @Post('setup')
  setup(@CurrentUser() user: { id: string }) {
    return this.instance.setupFirstAdmin(user.id);
  }

  /** Whether the current user is an instance admin (drives the web God Mode link). */
  @Get('me')
  async me(@CurrentUser() user: { id: string }) {
    return { isInstanceAdmin: await this.instance.isInstanceAdmin(user.id) };
  }

  // ── Admin-only ────────────────────────────────────────────────────
  // Two independent locks: the token must be an `admin`-audience token (a web
  // session can never reach here, even for an instance admin), and the user must
  // still be an instance admin. Mutations additionally demand a recent password
  // re-entry. docs/plan/01-security-model.md §1 S4/S5.
  @RequireAudience(AUD_ADMIN)
  @UseGuards(InstanceAdminGuard)
  @Get('config')
  getConfig() {
    return this.instance.getConfig();
  }

  @RequireAudience(AUD_ADMIN)
  @RequireStepUp()
  @Audit('instance.config.update')
  @UseGuards(InstanceAdminGuard)
  @Patch('config')
  updateConfig(
    @Body(new ZodValidationPipe(UpdateConfigSchema)) dto: UpdateConfigDto,
  ) {
    return this.instance.updateConfig(dto);
  }

  @RequireAudience(AUD_ADMIN)
  @RequireStepUp()
  @Audit('instance.update')
  @UseGuards(InstanceAdminGuard)
  @Patch()
  updateInstance(
    @Body(new ZodValidationPipe(UpdateInstanceSchema)) dto: UpdateInstanceDto,
  ) {
    return this.instance.updateInstance(dto);
  }

  @RequireAudience(AUD_ADMIN)
  @UseGuards(InstanceAdminGuard)
  @Get('admins')
  listAdmins() {
    return this.instance.listAdmins();
  }

  @RequireAudience(AUD_ADMIN)
  @RequireStepUp()
  @Audit('instance.admin.add')
  @UseGuards(InstanceAdminGuard)
  @Post('admins')
  addAdmin(@Body(new ZodValidationPipe(AddAdminSchema)) dto: AddAdminDto) {
    return this.instance.addAdmin(dto);
  }

  @RequireAudience(AUD_ADMIN)
  @RequireStepUp()
  @Audit('instance.admin.remove')
  @UseGuards(InstanceAdminGuard)
  @Delete('admins/:userId')
  removeAdmin(@Param('userId') userId: string) {
    return this.instance.removeAdmin(userId);
  }

  @RequireAudience(AUD_ADMIN)
  @Audit('instance.email.test')
  @UseGuards(InstanceAdminGuard)
  @Post('email/test')
  testEmail(@Body(new ZodValidationPipe(TestEmailSchema)) dto: TestEmailDto) {
    return this.instance.testEmail(dto);
  }
}
