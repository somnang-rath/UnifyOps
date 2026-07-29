import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { IssuesService } from './issues.service';
import { IssueLinksService } from './issue-links.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodQueryPipe, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  BulkDeleteIssuesDto,
  BulkDeleteIssuesSchema,
  BulkUpdateIssuesDto,
  BulkUpdateIssuesSchema,
  CalendarRangeQuery,
  CalendarRangeSchema,
  CommentDto,
  CommentSchema,
  CreateIssueDto,
  CreateIssueSchema,
  CreateRelationDto,
  CreateRelationSchema,
  ImportIssuesDto,
  ImportIssuesSchema,
  ListIssueQuery,
  ListIssueQuerySchema,
  UpdateIssueDto,
  UpdateIssueSchema,
} from './dto/issue.dto';

@Controller('issues')
export class IssuesController {
  constructor(
    private issues: IssuesService,
    private links: IssueLinksService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListIssueQuerySchema)) q: ListIssueQuery,
  ) {
    return this.issues.list(user.id, q);
  }

  @Get('calendar/range')
  calendar(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(CalendarRangeSchema)) q: CalendarRangeQuery,
  ) {
    return this.issues.calendar(user.id, q);
  }

  @Get(':id')
  byId(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.issues.byId(user.id, id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateIssueSchema))
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateIssueDto,
  ) {
    return this.issues.create(user.id, dto);
  }

  /** Bulk CSV import (Phase 8 workstream B) — max 500 rows per call. */
  @Post('import')
  @UsePipes(new ZodValidationPipe(ImportIssuesSchema))
  importIssues(
    @CurrentUser() user: { id: string },
    @Body() dto: ImportIssuesDto,
  ) {
    return this.issues.importIssues(user.id, dto);
  }

  /**
   * Bulk edit from the issues list (Phase 7b; ADR 0011 §4 — the selection is
   * body-only, never a URL param). Declared before the `:id` routes so the
   * literal `bulk` segment can never be read as an id.
   *
   * Partial success by design: `{ updated, failed[] }`, 200 even when some
   * ids were unwritable.
   */
  @Post('bulk')
  @UsePipes(new ZodValidationPipe(BulkUpdateIssuesSchema))
  bulkUpdate(
    @CurrentUser() user: { id: string },
    @Body() dto: BulkUpdateIssuesDto,
  ) {
    return this.issues.bulkUpdate(user.id, dto);
  }

  /** POST, not DELETE — a body of ids is the payload (`{ deleted, failed[] }`). */
  @Post('bulk/delete')
  @UsePipes(new ZodValidationPipe(BulkDeleteIssuesSchema))
  bulkRemove(
    @CurrentUser() user: { id: string; role: string },
    @Body() dto: BulkDeleteIssuesDto,
  ) {
    return this.issues.bulkRemove(user.id, user.role, dto.ids);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateIssueSchema))
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateIssueDto,
  ) {
    return this.issues.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: { id: string; role: string },
    @Param('id') id: string,
  ) {
    return this.issues.remove(user.id, user.role, id);
  }

  @Post(':id/comments')
  @UsePipes(new ZodValidationPipe(CommentSchema))
  addComment(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CommentDto,
  ) {
    return this.issues.addComment(id, user.id, dto.body);
  }

  // ── Sub-issues ──────────────────────────────────────────────────
  @Get(':id/children')
  children(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.links.children(user.id, id);
  }

  // ── Relations ───────────────────────────────────────────────────
  @Get(':id/relations')
  relations(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.links.relations(user.id, id);
  }

  @Post(':id/relations')
  @UsePipes(new ZodValidationPipe(CreateRelationSchema))
  addRelation(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CreateRelationDto,
  ) {
    return this.links.addRelation(user.id, id, dto.targetId, dto.type);
  }

  @Delete('relations/:relationId')
  removeRelation(
    @CurrentUser() user: { id: string },
    @Param('relationId') relationId: string,
  ) {
    return this.links.removeRelation(user.id, relationId);
  }
}
