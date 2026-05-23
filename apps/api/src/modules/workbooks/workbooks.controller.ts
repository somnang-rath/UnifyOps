import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { xlsxBufferToSheets } from './xlsx.import';
import { Response } from 'express';
import {
  AuthUserPayload,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WorkbooksService } from './workbooks.service';
import { WorkbookCommentsService } from './workbook-comments.service';
import {
  CreateWorkbookDto,
  CreateWorkbookSchema,
  ShareWorkbookDto,
  ShareWorkbookSchema,
  UpdateWorkbookDto,
  UpdateWorkbookSchema,
} from './dto/workbook.dto';
import {
  CreateCommentDto,
  CreateCommentSchema,
  ReplyCommentDto,
  ReplyCommentSchema,
  UpdateCommentDto,
  UpdateCommentSchema,
} from './dto/workbook-comment.dto';

@Controller('workbooks')
export class WorkbooksController {
  constructor(
    private wb: WorkbooksService,
    private comments: WorkbookCommentsService,
  ) {}

  @Get()
  list(@CurrentUser() u: AuthUserPayload) {
    return this.wb.list(u);
  }

  @Get(':id')
  byId(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.wb.byId(u, id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateWorkbookSchema))
  create(@CurrentUser() u: AuthUserPayload, @Body() dto: CreateWorkbookDto) {
    return this.wb.create(u.id, dto);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateWorkbookSchema))
  update(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWorkbookDto,
  ) {
    return this.wb.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.wb.remove(u.id, id);
  }

  @Post(':id/copy')
  copy(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.wb.copy(u, id);
  }

  @Post('fetch-google-sheet')
  async fetchGoogleSheet(@Body() body: { url?: string }) {
    if (!body?.url) throw new BadRequestException('url is required');
    return this.wb.fetchGoogleSheetCsv(body.url);
  }

  @Post('import-xlsx')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    }),
  )
  async importXlsx(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const sheets = await xlsxBufferToSheets(file.buffer);
    return { sheets };
  }

  @Get(':id/export.xlsx')
  @Header(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  async exportXlsx(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.wb.exportXlsx(u, id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  }

  @Get(':id/grants')
  listGrants(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.wb.listGrants(u.id, id);
  }

  @Put(':id/grants')
  @UsePipes(new ZodValidationPipe(ShareWorkbookSchema))
  setGrant(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: ShareWorkbookDto,
  ) {
    return this.wb.setGrant(u.id, id, dto);
  }

  /**
   * `target` is either a 24-hex user id or a role string (admin/cpo/marketing/sales/dev).
   * The service dispatches on the shape.
   */
  @Delete(':id/grants/:target')
  removeGrant(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Param('target') target: string,
  ) {
    return this.wb.removeGrant(u.id, id, target);
  }

  // ---------- Comments ----------

  @Get(':id/comments')
  listComments(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
  ) {
    return this.comments.list(u, id);
  }

  @Post(':id/comments')
  @UsePipes(new ZodValidationPipe(CreateCommentSchema))
  createComment(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(u, id, dto);
  }

  @Patch(':id/comments/:cid')
  @UsePipes(new ZodValidationPipe(UpdateCommentSchema))
  updateComment(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(u, id, cid, dto);
  }

  @Delete(':id/comments/:cid')
  removeComment(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Param('cid') cid: string,
  ) {
    return this.comments.remove(u, id, cid);
  }

  @Post(':id/comments/:cid/replies')
  @UsePipes(new ZodValidationPipe(ReplyCommentSchema))
  replyComment(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Param('cid') cid: string,
    @Body() dto: ReplyCommentDto,
  ) {
    return this.comments.reply(u, id, cid, dto);
  }
}
