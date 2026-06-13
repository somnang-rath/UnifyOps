import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UsePipes,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ChangePasswordDto,
  ChangePasswordSchema,
  ClearDataDto,
  ClearDataSchema,
  Confirm2FADto,
  Confirm2FASchema,
  CreateApiTokenDto,
  CreateApiTokenSchema,
  UpdateNotifPrefsDto,
  UpdateNotifPrefsSchema,
  UpdateProfileDto,
  UpdateProfileSchema,
} from './dto/users.dto';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.users.byId(id);
  }

  @Patch('me')
  @UsePipes(new ZodValidationPipe(UpdateProfileSchema))
  updateMe(
    @CurrentUser() me: { id: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(me.id, dto);
  }

  @HttpCode(200)
  @Post('me/change-password')
  @UsePipes(new ZodValidationPipe(ChangePasswordSchema))
  changePassword(
    @CurrentUser() me: { id: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.users.changePassword(me.id, dto);
  }

  @HttpCode(200)
  @Post('me/clear-data')
  @UsePipes(new ZodValidationPipe(ClearDataSchema))
  clearData(
    @CurrentUser() me: { id: string },
    @Body() dto: ClearDataDto,
  ) {
    return this.users.clearAllData(me.id, dto);
  }

  @Get('me/notif-prefs')
  getMyNotifPrefs(@CurrentUser() me: { id: string }) {
    return this.users.getNotifPrefs(me.id);
  }

  @Patch('me/notif-prefs')
  @UsePipes(new ZodValidationPipe(UpdateNotifPrefsSchema))
  updateMyNotifPrefs(
    @CurrentUser() me: { id: string },
    @Body() dto: UpdateNotifPrefsDto,
  ) {
    return this.users.updateNotifPrefs(me.id, dto);
  }

  @Post('me/2fa/setup')
  @HttpCode(200)
  setup2FA(@CurrentUser() me: { id: string }) {
    return this.users.setup2FA(me.id);
  }

  @Post('me/2fa/confirm')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(Confirm2FASchema))
  confirm2FA(
    @CurrentUser() me: { id: string },
    @Body() dto: Confirm2FADto,
  ) {
    return this.users.confirm2FA(me.id, dto);
  }

  @Post('me/2fa/disable')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(Confirm2FASchema))
  disable2FA(
    @CurrentUser() me: { id: string },
    @Body() dto: Confirm2FADto,
  ) {
    return this.users.disable2FA(me.id, dto);
  }

  @Post('me/2fa/recovery-codes')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(Confirm2FASchema))
  generateRecoveryCodes(
    @CurrentUser() me: { id: string },
    @Body() dto: Confirm2FADto,
  ) {
    return this.users.generateRecoveryCodes(me.id, dto);
  }

  @Get('me/api-tokens')
  listApiTokens(@CurrentUser() me: { id: string }) {
    return this.users.listApiTokens(me.id);
  }

  @Post('me/api-tokens')
  @UsePipes(new ZodValidationPipe(CreateApiTokenSchema))
  createApiToken(
    @CurrentUser() me: { id: string },
    @Body() dto: CreateApiTokenDto,
  ) {
    return this.users.createApiToken(me.id, dto);
  }

  @Delete('me/api-tokens/:tokenId')
  @HttpCode(200)
  revokeApiToken(
    @CurrentUser() me: { id: string },
    @Param('tokenId') tokenId: string,
  ) {
    return this.users.revokeApiToken(me.id, tokenId);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
