import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  AUDIENCE_KEY,
  STEP_UP_KEY,
} from '../decorators/audience.decorator';
import { STEP_UP_MAX_AGE_MS, type RestAudience } from '../auth/audience';

/**
 * Enforces `@RequireAudience()` and `@RequireStepUp()` (docs/plan/01 §2).
 * Registered globally AFTER JwtAuthGuard, so `req.user` carries `aud`/`stepUpAt`.
 */
@Injectable()
export class AudienceGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<RestAudience>(AUDIENCE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const needsStepUp = this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!required && !needsStepUp) return true;

    const user = ctx.switchToHttp().getRequest().user as
      | { aud?: string; stepUpAt?: number }
      | undefined;

    // No user means the route is authenticated but the guard chain let it
    // through unauthenticated — fail closed rather than assume.
    if (!user) throw new ForbiddenException('Not authenticated');

    if (required && user.aud !== required) {
      throw new ForbiddenException(
        `This endpoint requires a '${required}' token. Sign in to the ${required} app.`,
      );
    }

    if (needsStepUp) {
      const age = user.stepUpAt ? Date.now() - user.stepUpAt * 1000 : Infinity;
      if (age > STEP_UP_MAX_AGE_MS) {
        throw new ForbiddenException({
          message: 'Confirm your password to continue.',
          code: 'STEP_UP_REQUIRED',
        });
      }
    }

    return true;
  }
}
