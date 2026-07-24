import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  UsersService,
  API_TOKEN_PREFIX,
} from '../../modules/users/users.service';
import { AUD_WEB } from '../auth/audience';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private moduleRef: ModuleRef,
  ) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // A `prs_` bearer is a personal access token, not a JWT. Resolve it via the
    // users module (which owns PATs) and short-circuit the JWT path — passport-jwt
    // would only reject it. PATs carry the `web` audience so they can drive the
    // same surface a web session can, never admin/collab (docs/plan/01 §2).
    const req = ctx.switchToHttp().getRequest();
    const raw = extractBearer(req);
    if (raw?.startsWith(API_TOKEN_PREFIX)) {
      const users = this.moduleRef.get(UsersService, { strict: false });
      const result = await users.verifyApiToken(raw);
      // Bad credentials are 401, not 403: a returned `false` would surface as
      // Forbidden, which wrongly implies an authenticated-but-unauthorised user.
      if (!result) throw new UnauthorizedException('Invalid API token');
      const user = await users.findById(result.userId);
      if (!user || user.blocked) {
        throw new UnauthorizedException('Invalid API token');
      }
      req.user = {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        aud: AUD_WEB,
      };
      return true;
    }

    return (await super.canActivate(ctx)) as boolean;
  }
}

function extractBearer(req: {
  headers?: Record<string, unknown>;
}): string | null {
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
