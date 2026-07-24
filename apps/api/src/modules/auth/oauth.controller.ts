import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService, SessionMeta } from './auth.service';
import { OAuthFlowError, OAuthService } from './oauth.service';
import { OAuthCallbackDto, OAuthCallbackSchema } from './dto/oauth.dto';
import { ZodQueryPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../../common/decorators/public.decorator';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setCsrfCookie,
  setOAuthStateCookie,
  setRefreshCookie,
} from '../../common/auth/cookies';
import { AUD_WEB } from '../../common/auth/audience';

function meta(req: Request): SessionMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
  };
}

/**
 * OAuth login for apps/web only (ADR 0008). Both routes are top-level GET
 * navigations that answer with redirects — never a token in a URL or body.
 * They 404 whenever the provider is not effectively enabled, so with no
 * credentials configured this whole surface does not exist.
 */
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private oauth: OAuthService,
    private auth: AuthService,
    private cfg: ConfigService,
  ) {}

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Get(':provider')
  async start(@Param('provider') provider: string, @Res() res: Response) {
    const { provider: p, config } = await this.oauth.requireEnabled(provider);
    const state = setOAuthStateCookie(res);
    res.redirect(302, this.oauth.buildAuthorizeUrl(p, config.clientId, state));
  }

  @Public()
  @Throttle({ short: { limit: 10, ttl: 60_000 } })
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query(new ZodQueryPipe(OAuthCallbackSchema)) query: OAuthCallbackDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Same 404 rule as the start route: disabling a provider kills
    // in-flight flows too.
    const { provider: p, config } = await this.oauth.requireEnabled(provider);

    const cookieState = readOAuthStateCookie(req);
    clearOAuthStateCookie(res);

    try {
      if (
        !query.code ||
        !query.state ||
        !cookieState ||
        query.state !== cookieState
      ) {
        throw new OAuthFlowError('oauth_failed');
      }
      const user = await this.oauth.exchangeAndResolve(p, config, query.code);

      // Exactly what password login does (Phase 5 session model), minus
      // step-up: the browser gets the refresh + CSRF cookies and the web
      // app's boot path hydrates the access token via POST /auth/refresh.
      const { refreshToken } = await this.auth.issueOAuthSession(
        user,
        meta(req),
      );
      setRefreshCookie(res, refreshToken, AUD_WEB);
      setCsrfCookie(res);
      res.redirect(302, `${this.webOrigin()}/`);
    } catch (err) {
      // Coarse codes only — no provider error details ever reach a URL.
      const code = err instanceof OAuthFlowError ? err.code : 'oauth_failed';
      res.redirect(302, `${this.webOrigin()}/login?error=${code}`);
    }
  }

  /** First entry of the WEB_ORIGIN allowlist (ADR 0008 §4). */
  private webOrigin(): string {
    const raw = this.cfg.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    const first = raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)[0];
    return (first ?? 'http://localhost:3000').replace(/\/+$/, '');
  }
}
