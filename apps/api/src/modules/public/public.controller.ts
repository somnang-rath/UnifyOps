import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicService } from './public.service';

/**
 * Anonymous, read-only endpoints for the public Space (apps/space, :3002).
 *
 * - `@Public()` skips the global `JwtAuthGuard` — no user token is expected.
 * - Deliberately NOT `@SkipThrottle()`: this is anonymous internet traffic, so
 *   the global `ThrottlerGuard` limits (app.module) must apply (ADR 0002 §4).
 *
 * Mounted under the global `api/v1` prefix → `/api/v1/public/...`.
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicSvc: PublicService) {}

  /** GET /api/v1/public/anchor/:anchor → published wiki page (field-stripped) */
  @Get('anchor/:anchor')
  anchor(@Param('anchor') anchor: string) {
    return this.publicSvc.getWikiByAnchor(anchor);
  }
}
