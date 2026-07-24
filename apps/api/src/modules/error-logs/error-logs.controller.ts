import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ZodQueryPipe, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ErrorLogsService } from './error-logs.service';
import {
  BulkIdsDto,
  BulkIdsSchema,
  CleanupSettingsDto,
  CleanupSettingsSchema,
  CreateErrorLogDto,
  CreateErrorLogSchema,
  QueryErrorLogsDto,
  QueryErrorLogsSchema,
} from './dto/error-log.dto';

const SUPER_ADMIN_EMAILS = new Set(['somnang.rath12@gmail.com', 'admin@demo.com']);

function assertSuperAdmin(email: string) {
  if (!SUPER_ADMIN_EMAILS.has(email)) throw new ForbiddenException('Super admin only');
}

@Controller('error-logs')
export class ErrorLogsController {
  constructor(private svc: ErrorLogsService) {}

  // ── Public ingest (frontend errors posted by the client) ──────────────────

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateErrorLogSchema)) dto: CreateErrorLogDto,
    @CurrentUser() me: { id: string; email: string },
  ) {
    return this.svc.create(dto, me?.id);
  }

  // ── Super-admin read endpoints ─────────────────────────────────────────────

  @Get('stats')
  stats(@CurrentUser() me: { email: string }) {
    assertSuperAdmin(me.email);
    return this.svc.stats();
  }

  @Get('export')
  async exportLogs(
    @Query(new ZodQueryPipe(QueryErrorLogsSchema)) q: QueryErrorLogsDto,
    @Query('format') format: string,
    @CurrentUser() me: { email: string },
    @Res() res: Response,
  ) {
    assertSuperAdmin(me.email);
    if (format === 'json') {
      const data = await this.svc.exportJson(q);
      res
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', 'attachment; filename="error-logs.json"')
        .send(JSON.stringify(data, null, 2));
    } else {
      const csv = await this.svc.exportCsv(q);
      res
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="error-logs.csv"')
        .send(csv);
    }
  }

  @Get('settings/retention')
  getRetention(@CurrentUser() me: { email: string }) {
    assertSuperAdmin(me.email);
    return this.svc.getRetentionDays();
  }

  @Patch('settings/retention')
  updateRetention(
    @Body(new ZodValidationPipe(CleanupSettingsSchema)) dto: CleanupSettingsDto,
    @CurrentUser() me: { email: string },
  ) {
    assertSuperAdmin(me.email);
    return this.svc.updateRetentionDays(dto.retentionDays);
  }

  @Get()
  list(
    @Query(new ZodQueryPipe(QueryErrorLogsSchema)) q: QueryErrorLogsDto,
    @CurrentUser() me: { email: string },
  ) {
    assertSuperAdmin(me.email);
    return this.svc.list(q);
  }

  @Get(':id')
  byId(@Param('id') id: string, @CurrentUser() me: { email: string }) {
    assertSuperAdmin(me.email);
    return this.svc.byId(id);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string, @CurrentUser() me: { id: string; email: string }) {
    assertSuperAdmin(me.email);
    return this.svc.resolve(id, me.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() me: { email: string }) {
    assertSuperAdmin(me.email);
    return this.svc.remove(id);
  }

  @Post('bulk/resolve')
  bulkResolve(
    @Body(new ZodValidationPipe(BulkIdsSchema)) dto: BulkIdsDto,
    @CurrentUser() me: { id: string; email: string },
  ) {
    assertSuperAdmin(me.email);
    return this.svc.bulkResolve(dto.ids, me.id);
  }

  @Post('bulk/delete')
  bulkDelete(
    @Body(new ZodValidationPipe(BulkIdsSchema)) dto: BulkIdsDto,
    @CurrentUser() me: { email: string },
  ) {
    assertSuperAdmin(me.email);
    return this.svc.bulkRemove(dto.ids);
  }
}
