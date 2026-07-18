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
  CalendarRangeQuery,
  CalendarRangeSchema,
  CommentDto,
  CommentSchema,
  CreateIssueDto,
  CreateIssueSchema,
  CreateRelationDto,
  CreateRelationSchema,
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
  calendar(@Query() q: CalendarRangeQuery) {
    const parsed = CalendarRangeSchema.parse(q);
    return this.issues.calendar(parsed.from, parsed.to);
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
