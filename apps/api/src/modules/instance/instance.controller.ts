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
  @UseGuards(InstanceAdminGuard)
  @Get('config')
  getConfig() {
    return this.instance.getConfig();
  }

  @UseGuards(InstanceAdminGuard)
  @Patch('config')
  updateConfig(
    @Body(new ZodValidationPipe(UpdateConfigSchema)) dto: UpdateConfigDto,
  ) {
    return this.instance.updateConfig(dto);
  }

  @UseGuards(InstanceAdminGuard)
  @Patch()
  updateInstance(
    @Body(new ZodValidationPipe(UpdateInstanceSchema)) dto: UpdateInstanceDto,
  ) {
    return this.instance.updateInstance(dto);
  }

  @UseGuards(InstanceAdminGuard)
  @Get('admins')
  listAdmins() {
    return this.instance.listAdmins();
  }

  @UseGuards(InstanceAdminGuard)
  @Post('admins')
  addAdmin(@Body(new ZodValidationPipe(AddAdminSchema)) dto: AddAdminDto) {
    return this.instance.addAdmin(dto);
  }

  @UseGuards(InstanceAdminGuard)
  @Delete('admins/:userId')
  removeAdmin(@Param('userId') userId: string) {
    return this.instance.removeAdmin(userId);
  }

  @UseGuards(InstanceAdminGuard)
  @Post('email/test')
  testEmail(@Body(new ZodValidationPipe(TestEmailSchema)) dto: TestEmailDto) {
    return this.instance.testEmail(dto);
  }
}
