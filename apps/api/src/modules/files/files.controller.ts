import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AuthUserPayload,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { FilesService } from './files.service';
import {
  AddLinkDto,
  AddLinkSchema,
  CreateFolderDto,
  CreateFolderSchema,
  ListFilesDto,
  ListFilesSchema,
  MoveFileSchema,
  RenameSchema,
  ShareFolderDto,
  ShareFolderSchema,
} from './dto/files.dto';

const MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB

@Controller('files')
export class FilesController {
  constructor(private files: FilesService) {}

  @Get('stats')
  stats(@CurrentUser() u: AuthUserPayload) {
    return this.files.stats(u.id);
  }

  // Folders
  @Get('folders')
  listFolders(@CurrentUser() u: AuthUserPayload) {
    return this.files.listFolders(u);
  }

  @Post('folders')
  @UsePipes(new ZodValidationPipe(CreateFolderSchema))
  createFolder(
    @CurrentUser() u: AuthUserPayload,
    @Body() dto: CreateFolderDto,
  ) {
    return this.files.createFolder(u.id, dto);
  }

  @Patch('folders/:id')
  @UsePipes(new ZodValidationPipe(RenameSchema))
  renameFolder(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: { name: string },
  ) {
    return this.files.renameFolder(u.id, id, dto.name);
  }

  @Delete('folders/:id')
  removeFolder(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.files.deleteFolder(u.id, id);
  }

  // Folder grants (sharing)
  @Get('folders/:id/grants')
  listGrants(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.files.listGrants(u.id, id);
  }

  @Put('folders/:id/grants')
  @UsePipes(new ZodValidationPipe(ShareFolderSchema))
  setGrant(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: ShareFolderDto,
  ) {
    return this.files.setGrant(u.id, id, dto);
  }

  /**
   * `target` is either a 24-hex user id or a role string (admin/cpo/marketing/sales/dev).
   * The service dispatches on the shape.
   */
  @Delete('folders/:id/grants/:target')
  removeGrant(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Param('target') target: string,
  ) {
    return this.files.removeGrant(u.id, id, target);
  }

  // Files
  @Get()
  list(
    @CurrentUser() u: AuthUserPayload,
    @Query(new ZodValidationPipe(ListFilesSchema)) q: ListFilesDto,
  ) {
    return this.files.listFiles(u, q);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } }),
  )
  upload(
    @CurrentUser() u: AuthUserPayload,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    @Body('folderId') folderId?: string,
  ) {
    return this.files.upload(u, file, folderId || null);
  }

  @Post('comment-upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD } }),
  )
  commentUpload(
    @CurrentUser() u: AuthUserPayload,
    @UploadedFile()
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    return this.files.uploadForComment(u.id, file);
  }

  @Public()
  @Get('public/:id')
  async downloadPublic(@Param('id') id: string, @Res() res: Response) {
    const { file, length, open } = await this.files.streamPublic(id);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(length),
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
      'Cache-Control': 'public, max-age=3600',
    });
    open().pipe(res);
  }

  @Post('link')
  @UsePipes(new ZodValidationPipe(AddLinkSchema))
  addLink(@CurrentUser() u: AuthUserPayload, @Body() dto: AddLinkDto) {
    return this.files.addLink(u, dto);
  }

  @Patch(':id/rename')
  @UsePipes(new ZodValidationPipe(RenameSchema))
  rename(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: { name: string },
  ) {
    return this.files.rename(u, id, dto.name);
  }

  @Patch(':id/move')
  @UsePipes(new ZodValidationPipe(MoveFileSchema))
  move(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: { folderId?: string | null },
  ) {
    return this.files.move(u, id, dto.folderId ?? null);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.files.remove(u, id);
  }

  @Get(':id/download')
  async download(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { file, length, open } = await this.files.stream(u, id);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(length),
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
      'Cache-Control': 'private, max-age=300, must-revalidate',
    });
    open().pipe(res);
  }
}
