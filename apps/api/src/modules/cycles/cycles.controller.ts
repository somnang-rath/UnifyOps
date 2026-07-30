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
import { CyclesService } from './cycles.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  AssignIssuesDto,
  AssignIssuesSchema,
  CreateCycleDto,
  CreateCycleSchema,
  ListCyclesQuery,
  ListCyclesQuerySchema,
  ReorderCyclesDto,
  ReorderCyclesSchema,
  UpdateCycleDto,
  UpdateCycleSchema,
} from './dto/cycle.dto';

@Controller('cycles')
export class CyclesController {
  constructor(private cycles: CyclesService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListCyclesQuerySchema)) q: ListCyclesQuery,
  ) {
    return this.cycles.list(user.id, q);
  }

  @Get(':id')
  byId(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.cycles.byId(user.id, id);
  }

  @Get(':id/issues')
  issues(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.cycles.issues(user.id, id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateCycleSchema))
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateCycleDto) {
    return this.cycles.create(user.id, dto);
  }

  // Declared before `:id/...` param routes below it would shadow — Nest matches
  // in declaration order, and `reorder` would otherwise land in `byId`.
  @Post('reorder')
  @UsePipes(new ZodValidationPipe(ReorderCyclesSchema))
  reorder(@CurrentUser() user: { id: string }, @Body() dto: ReorderCyclesDto) {
    return this.cycles.reorder(user.id, dto.ids);
  }

  /** Schedule work items into the cycle → `{ assigned, skipped[] }`. */
  @Post(':id/issues')
  @UsePipes(new ZodValidationPipe(AssignIssuesSchema))
  assign(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: AssignIssuesDto,
  ) {
    return this.cycles.assign(user.id, id, dto.issueIds);
  }

  /** Release one item back to the backlog. */
  @Delete(':id/issues/:issueId')
  unassign(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('issueId') issueId: string,
  ) {
    return this.cycles.unassign(user.id, id, issueId);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateCycleSchema))
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateCycleDto,
  ) {
    return this.cycles.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.cycles.remove(user.id, id);
  }
}
