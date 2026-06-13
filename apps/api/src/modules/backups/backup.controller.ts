import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Response } from 'express';
import { CurrentUser, AuthUserPayload } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BackupExportService }    from './backup-export.service';
import { BackupCryptoService }    from './backup-crypto.service';
import { BackupStorageService }   from './backup-storage.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupImportService }    from './backup-import.service';
import {
  ExportOptionsSchema,
  ImportOptionsSchema,
  UpsertScheduleSchema,
  type ExportOptionsDto,
  type ImportOptionsDto,
  type UpsertScheduleDto,
} from './dto/backup.dto';

const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // 100 MB

@Controller('backups')
export class BackupController {
  constructor(
    private exportSvc:    BackupExportService,
    private cryptoSvc:    BackupCryptoService,
    private storageSvc:   BackupStorageService,
    private schedulerSvc: BackupSchedulerService,
    private importSvc:    BackupImportService,
  ) {}

  // ── Manual export → stream file ──────────────────────────────────────────

  @Post('export')
  @UsePipes(new ZodValidationPipe(ExportOptionsSchema))
  async export(
    @Body() dto: ExportOptionsDto,
    @CurrentUser() user: AuthUserPayload,
    @Res() res: Response,
  ) {
    let buffer = await this.exportSvc.exportForUser(
      user.id,
      dto.scopes,
      user.email,
      dto.fileName,
    );

    let encrypted = false;

    if (dto.password) {
      // Parse existing payload, encrypt only the data section, re-gzip
      const parsed = JSON.parse(gunzipSync(buffer).toString('utf8')) as Record<string, unknown>;
      const envelope = this.cryptoSvc.encrypt(
        gzipSync(Buffer.from(JSON.stringify(parsed.data))),
        dto.password,
      );
      (parsed.meta as Record<string, unknown>).encrypted = true;
      (parsed.meta as Record<string, unknown>).iv        = envelope.iv;
      (parsed.meta as Record<string, unknown>).salt      = envelope.salt;
      parsed.data = envelope.ciphertext;
      buffer    = gzipSync(Buffer.from(JSON.stringify(parsed)));
      encrypted = true;
    }

    const dateStr  = new Date().toISOString().slice(0, 10);
    const safeName = dto.fileName.replace(/[^a-zA-Z0-9 _\-]/g, '').trim() || 'Backup UnifyOps';
    const fileName = `${safeName} ${dateStr}.prismback`;

    res.setHeader('Content-Type',        'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length',      buffer.length);
    res.setHeader('X-Backup-Encrypted',  String(encrypted));
    res.end(buffer);
  }

  // ── Stored backup list ────────────────────────────────────────────────────

  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.storageSvc.list(user.id);
  }

  // ── Download a stored backup ──────────────────────────────────────────────

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Res() res: Response,
  ) {
    const stream = await this.storageSvc.openDownloadStream(id, user.id);
    res.setHeader('Content-Type',        'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="backup-${id}.prismback"`);
    stream.pipe(res);
  }

  // ── Delete a stored backup ────────────────────────────────────────────────

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserPayload) {
    return this.storageSvc.remove(id, user.id);
  }

  // ── Import ────────────────────────────────────────────────────────────────

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, string>,
    @CurrentUser() user: AuthUserPayload,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded');
    }

    let opts: ImportOptionsDto;
    try {
      const rawOpts: ImportOptionsDto = {
        strategy: (body.strategy ?? 'merge') as ImportOptionsDto['strategy'],
        scopes:   body.scopes
          ? (JSON.parse(body.scopes) as ImportOptionsDto['scopes'])
          : undefined,
        password: body.password ?? null,
      };
      opts = ImportOptionsSchema.parse(rawOpts);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'Invalid import options',
      );
    }

    return this.importSvc.importForUser(user.id, file.buffer, opts);
  }

  // ── Schedule CRUD ─────────────────────────────────────────────────────────

  @Get('schedule')
  getSchedule(@CurrentUser() user: AuthUserPayload) {
    return this.schedulerSvc.get(user.id);
  }

  @Put('schedule')
  @UsePipes(new ZodValidationPipe(UpsertScheduleSchema))
  upsertSchedule(
    @Body() dto: UpsertScheduleDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.schedulerSvc.upsert(user.id, dto);
  }

  @Delete('schedule')
  deleteSchedule(@CurrentUser() user: AuthUserPayload) {
    return this.schedulerSvc.remove(user.id);
  }
}
