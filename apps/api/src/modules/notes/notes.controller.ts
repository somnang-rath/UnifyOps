import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UsePipes,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AuthUserPayload,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { NotesService } from './notes.service';
import { NotesPdfService } from './notes-pdf.service';
import {
  CreateFolderDto,
  CreateFolderSchema,
  RenameFolderSchema,
  SaveNoteDto,
  SaveNoteSchema,
  ShareNoteFolderDto,
  ShareNoteFolderSchema,
  UpdateNoteDto,
  UpdateNoteSchema,
} from './dto/notes.dto';

const safeFilename = (s: string) =>
  String(s || 'note')
    .replace(/[\\/:*?"<>|\r\n]+/g, '')
    .trim()
    .slice(0, 80) || 'note';

@Controller('notes')
export class NotesController {
  constructor(
    private notes: NotesService,
    private pdf: NotesPdfService,
    private auth: AuthService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUserPayload) {
    return this.notes.list(u);
  }

  @Get('folders')
  listFolders(@CurrentUser() u: AuthUserPayload) {
    return this.notes.listFolders(u);
  }

  @Post('folders')
  @UsePipes(new ZodValidationPipe(CreateFolderSchema))
  createFolder(
    @CurrentUser() u: AuthUserPayload,
    @Body() dto: CreateFolderDto,
  ) {
    return this.notes.createFolder(u, dto);
  }

  @Patch('folders/:id')
  @UsePipes(new ZodValidationPipe(RenameFolderSchema))
  renameFolder(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: { name: string },
  ) {
    return this.notes.renameFolder(u.id, id, dto.name);
  }

  @Delete('folders/:id')
  removeFolder(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.notes.removeFolder(u.id, id);
  }

  // Folder grants (sharing)
  @Get('folders/:id/grants')
  listGrants(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.notes.listGrants(u.id, id);
  }

  @Put('folders/:id/grants')
  @UsePipes(new ZodValidationPipe(ShareNoteFolderSchema))
  setGrant(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: ShareNoteFolderDto,
  ) {
    return this.notes.setGrant(u.id, id, dto);
  }

  @Delete('folders/:id/grants/:target')
  removeGrant(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Param('target') target: string,
  ) {
    return this.notes.removeGrant(u.id, id, target);
  }

  @Get(':id/export.pdf')
  @Header('Content-Type', 'application/pdf')
  async exportPdf(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const note = await this.notes.byId(u, id);
    const buf = await this.pdf.render(note as any);
    const filename = `${safeFilename(note.title || 'note')}.pdf`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  @Get(':id')
  byId(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.notes.byId(u, id);
  }

  /**
   * Mint a short-lived token for the live server (ADR 0009 §5, mirroring the
   * wiki endpoint). Re-checks read access via the folder-grant rules; the
   * token is good for this one `notes:<id>` document for five minutes and is
   * rejected outright by the REST API (aud=collab).
   */
  @HttpCode(200)
  @Post(':id/collab-token')
  async collabToken(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
  ) {
    const { canRead, canWrite } = await this.notes.accessFor(u.id, id);
    if (!canRead) throw new ForbiddenException('No access to this note');
    const { token, expiresIn } = await this.auth.mintCollabToken(
      u.id,
      `notes:${id}`,
    );
    return { token, expiresIn, canWrite };
  }

  @Post()
  @UsePipes(new ZodValidationPipe(SaveNoteSchema))
  create(@CurrentUser() u: AuthUserPayload, @Body() dto: SaveNoteDto) {
    return this.notes.create(u, dto);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateNoteSchema))
  update(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.notes.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.notes.remove(u, id);
  }
}
