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
import { ModulesService } from './modules.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  AssignModuleIssuesDto,
  AssignModuleIssuesSchema,
  CreateModuleDto,
  CreateModuleSchema,
  ListModulesQuery,
  ListModulesQuerySchema,
  ReorderModulesDto,
  ReorderModulesSchema,
  UpdateModuleDto,
  UpdateModuleSchema,
} from './dto/module.dto';

@Controller('modules')
export class ModulesController {
  constructor(private modules: ModulesService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListModulesQuerySchema)) q: ListModulesQuery,
  ) {
    return this.modules.list(user.id, q);
  }

  @Get(':id')
  byId(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.modules.byId(user.id, id);
  }

  @Get(':id/issues')
  issues(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.modules.issues(user.id, id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateModuleSchema))
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateModuleDto) {
    return this.modules.create(user.id, dto);
  }

  // Before the `:id` routes — Nest matches in declaration order, so a literal
  // path declared after `:id` would be swallowed by it.
  @Post('reorder')
  @UsePipes(new ZodValidationPipe(ReorderModulesSchema))
  reorder(@CurrentUser() user: { id: string }, @Body() dto: ReorderModulesDto) {
    return this.modules.reorder(user.id, dto.ids);
  }

  /** Add work items to the module → `{ assigned, skipped[] }`. */
  @Post(':id/issues')
  @UsePipes(new ZodValidationPipe(AssignModuleIssuesSchema))
  assign(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: AssignModuleIssuesDto,
  ) {
    return this.modules.assign(user.id, id, dto.issueIds);
  }

  @Delete(':id/issues/:issueId')
  unassign(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('issueId') issueId: string,
  ) {
    return this.modules.unassign(user.id, id, issueId);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateModuleSchema))
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateModuleDto,
  ) {
    return this.modules.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.modules.remove(user.id, id);
  }
}
