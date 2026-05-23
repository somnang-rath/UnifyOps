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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CalendarRangeQuery,
  CalendarRangeSchema,
  CommentDto,
  CommentSchema,
  CreateIssueDto,
  CreateIssueSchema,
  ListIssueQuery,
  ListIssueQuerySchema,
  UpdateIssueDto,
  UpdateIssueSchema,
} from './dto/issue.dto';

@Controller('issues')
export class IssuesController {
  constructor(private issues: IssuesService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodValidationPipe(ListIssueQuerySchema)) q: ListIssueQuery,
  ) {
    return this.issues.list(user.id, q);
  }

  @Get('calendar/range')
  calendar(@Query() q: CalendarRangeQuery) {
    const parsed = CalendarRangeSchema.parse(q);
    return this.issues.calendar(parsed.from, parsed.to);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.issues.byId(id);
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
}
