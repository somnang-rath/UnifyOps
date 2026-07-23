import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { InstanceService } from '../instance/instance.service';
import { AuthService, SessionMeta } from './auth.service';
import {
  AcceptInviteDto,
  AcceptInviteSchema,
  LoginDto,
  LoginSchema,
  RefreshDto,
  RefreshSchema,
  RegisterDto,
  RegisterSchema,
  StepUpDto,
  StepUpSchema,
} from './dto/auth.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import {
  clearCsrfCookie,
  clearRefreshCookie,
  readRefreshCookie,
  setCsrfCookie,
  setRefreshCookie,
} from '../../common/auth/cookies';
import {
  AUD_ADMIN,
  AUD_WEB,
  type RestAudience,
} from '../../common/auth/audience';
import { Audit } from '../audit/audit.decorator';
import type { AuthedUser } from './strategies/jwt.strategy';

function meta(req: Request): SessionMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private instance: InstanceService,
  ) {}

  @Public()
  @Post('register')
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Effective signup switch (ADR 0008 §5): instance config row wins when
    // set, else the `ALLOW_PUBLIC_REGISTER` env — same gate the OAuth signup
    // path already applies in OAuthService.
    if (!(await this.instance.isSignupEnabled())) {
      throw new ForbiddenException(
        'Registration is by invitation only. Ask a workspace admin to invite you.',
      );
    }
    const { accessToken, refreshToken, user } = await this.auth.register(
      dto,
      meta(req),
    );
    setRefreshCookie(res, refreshToken, AUD_WEB);
    const csrfToken = setCsrfCookie(res);
    return { accessToken, csrfToken, user };
  }

  @Public()
  @HttpCode(200)
  @Post('accept-invite')
  @UsePipes(new ZodValidationPipe(AcceptInviteSchema))
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.auth.acceptInvite(
      dto,
      meta(req),
    );
    setRefreshCookie(res, refreshToken, AUD_WEB);
    const csrfToken = setCsrfCookie(res);
    return { accessToken, csrfToken, user };
  }

  /**
   * Password login is the brute-force surface: 5 attempts per minute per IP.
   *
   * The key must name a throttler declared in ThrottlerModule.forRoot — ours are
   * `short` and `medium`. An unknown name (like the conventional `default`) is
   * silently ignored, leaving the route on the global 300/min limit.
   */
  @Public()
  @Throttle({ short: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  @UsePipes(new ZodValidationPipe(LoginSchema))
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audience: RestAudience = dto.audience;
    const { accessToken, refreshToken, user } = await this.auth.login(
      dto,
      audience,
      meta(req),
    );
    setRefreshCookie(res, refreshToken, audience);
    const csrfToken = setCsrfCookie(res);
    return { accessToken, csrfToken, user };
  }

  @Public()
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @UseGuards(CsrfGuard)
  @HttpCode(200)
  @Post('refresh')
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audience: RestAudience = dto.audience;
    const raw = readRefreshCookie(req, audience);
    const { accessToken, refreshToken, user } = await this.auth.refresh(
      raw,
      meta(req),
    );
    setRefreshCookie(res, refreshToken, audience);
    const csrfToken = setCsrfCookie(res);
    return { accessToken, csrfToken, user };
  }

  /** Confirm the password again to unlock instance mutations for 15 minutes. */
  @Audit('auth.step-up')
  @HttpCode(200)
  @Post('step-up')
  @UsePipes(new ZodValidationPipe(StepUpSchema))
  async stepUp(@Body() dto: StepUpDto, @CurrentUser() user: AuthedUser) {
    return this.auth.stepUp(user.id, dto.password, user.aud);
  }

  @Public()
  @UseGuards(CsrfGuard)
  @HttpCode(204)
  @Post('logout')
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const audience: RestAudience = dto.audience;
    await this.auth.logout(readRefreshCookie(req, audience));
    clearRefreshCookie(res, audience);
    clearCsrfCookie(res);
  }

  @Audit('auth.logout-all')
  @HttpCode(204)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: AuthedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logoutAll(user.id);
    clearRefreshCookie(res, AUD_WEB);
    clearRefreshCookie(res, AUD_ADMIN);
    clearCsrfCookie(res);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthedUser, @Req() req: Request) {
    return this.auth.listSessions(user.id, readRefreshCookie(req, user.aud));
  }

  @Audit('auth.session.revoke')
  @HttpCode(204)
  @Delete('sessions/:familyId')
  revokeSession(
    @CurrentUser() user: AuthedUser,
    @Param('familyId') familyId: string,
  ) {
    return this.auth.revokeSession(user.id, familyId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthedUser) {
    return user;
  }
}
