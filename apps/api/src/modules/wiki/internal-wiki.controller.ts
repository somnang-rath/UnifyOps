import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WikiService } from './wiki.service';
import {
  SnapshotContentDto,
  SnapshotContentSchema,
  WikiAccessQuery,
  WikiAccessQuerySchema,
} from './dto/internal-wiki.dto';

/**
 * Server-to-server endpoints called by the live server (`apps/live`) — ADR §1/§4.
 *
 * - `@Public()` skips the global `JwtAuthGuard` (these carry no user JWT).
 * - `InternalTokenGuard` then gates them by the `LIVE_INTERNAL_TOKEN` secret.
 * - `@SkipThrottle()` exempts them from the per-IP `ThrottlerGuard`: all live
 *   traffic originates from a single IP (the live server), so under many
 *   concurrent editors the shared-secret calls would otherwise trip the limiter.
 *
 * Mounted under the global `api/v1` prefix → `/api/v1/internal/wiki/...`.
 */
@Public()
@SkipThrottle()
@UseGuards(InternalTokenGuard)
@Controller('internal/wiki')
export class InternalWikiController {
  constructor(private readonly wiki: WikiService) {}

  /** GET /api/v1/internal/wiki/:id/access?userId=<sub> → { canRead, canWrite } */
  @Get(':id/access')
  access(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(WikiAccessQuerySchema)) q: WikiAccessQuery,
  ) {
    return this.wiki.accessFor(q.userId, id);
  }

  /** PUT /api/v1/internal/wiki/:id/content → { ok, updatedAt } */
  @Put(':id/content')
  snapshot(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SnapshotContentSchema)) dto: SnapshotContentDto,
  ) {
    return this.wiki.snapshotContent(id, dto.content, dto.editedBy);
  }
}
