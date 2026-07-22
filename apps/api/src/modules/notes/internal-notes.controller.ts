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
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import { NotesService } from './notes.service';
import {
  NoteAccessQuery,
  NoteAccessQuerySchema,
  NoteSnapshotContentDto,
  NoteSnapshotContentSchema,
} from './dto/internal-notes.dto';

/**
 * Server-to-server endpoints called by the live server (`apps/live`) for the
 * `notes:<id>` document namespace — ADR 0009 §2/§4, mirroring
 * `internal-wiki.controller.ts`:
 *
 * - `@Public()` skips the global `JwtAuthGuard` (these carry no user JWT).
 * - `InternalTokenGuard` then gates them by the `LIVE_INTERNAL_TOKEN` secret.
 * - `@SkipThrottle()` exempts them from the per-IP `ThrottlerGuard` — all live
 *   traffic originates from a single IP (the live server).
 *
 * Mounted under the global `api/v1` prefix → `/api/v1/internal/notes/...`.
 */
@Public()
@SkipThrottle()
@UseGuards(InternalTokenGuard)
@Controller('internal/notes')
export class InternalNotesController {
  constructor(private readonly notes: NotesService) {}

  /** GET /api/v1/internal/notes/:id/access?userId=<sub> → { canRead, canWrite } */
  @Get(':id/access')
  access(
    @Param('id') id: string,
    @Query(new ZodQueryPipe(NoteAccessQuerySchema)) q: NoteAccessQuery,
  ) {
    return this.notes.accessFor(q.userId, id);
  }

  /** PUT /api/v1/internal/notes/:id/content → { ok, updatedAt } */
  @Put(':id/content')
  snapshot(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(NoteSnapshotContentSchema))
    dto: NoteSnapshotContentDto,
  ) {
    return this.notes.snapshotContent(id, dto.content, dto.editedBy);
  }
}
