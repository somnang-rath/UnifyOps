import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * Gates server-to-server "internal" endpoints (ADR 0001 §4) that the live
 * server (`apps/live`) calls. Requires header `x-internal-token` to match the
 * `LIVE_INTERNAL_TOKEN` env secret via a constant-time compare.
 *
 * This is NOT `JwtAuthGuard` — internal routes must also be marked `@Public()`
 * so the global `JwtAuthGuard` (an APP_GUARD) skips them; this guard then gates
 * them by shared secret instead of a user JWT. Rejects with 401.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers?.['x-internal-token'];
    const expected = this.config.get<string>('LIVE_INTERNAL_TOKEN');

    if (!expected || typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Invalid internal token');
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    // timingSafeEqual throws on unequal lengths — length check keeps it constant
    // time w.r.t. the (public) expected length and avoids leaking via exception.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}
