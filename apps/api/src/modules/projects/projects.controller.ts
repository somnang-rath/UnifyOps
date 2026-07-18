import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CreateProjectDto,
  CreateProjectSchema,
  DuplicateListDto,
  DuplicateListSchema,
  UpdateBoardDto,
  UpdateBoardSchema,
  UpdateOverviewDto,
  UpdateOverviewSchema,
  UpdateProjectDto,
  UpdateProjectSchema,
} from './dto/project.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  /**
   * `?workspace=<id>` switches to the strict workspace-scoped list (ADR 0006):
   * only projects whose workspaceId matches, including ones the caller owns
   * elsewhere. Without it, the unscoped ADR 0003 rule applies.
   */
  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query('workspace') workspace?: string,
  ) {
    return workspace
      ? this.projects.listInWorkspace(user.id, workspace)
      : this.projects.listForUser(user.id);
  }

  @Get(':id')
  byId(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.projects.byId(user.id, id);
  }

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProjectDto,
  ) {
    return this.projects.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.id, id, dto);
  }

  @Patch(':id/overview')
  updateOverview(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateOverviewSchema)) dto: UpdateOverviewDto,
  ) {
    return this.projects.updateOverview(user.id, id, dto);
  }

  @Patch(':id/board')
  updateBoard(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBoardSchema)) dto: UpdateBoardDto,
  ) {
    return this.projects.updateBoard(user.id, id, dto);
  }

  @Post(':id/board/lists/:listId/clear')
  clearList(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('listId') listId: string,
  ) {
    return this.projects.clearList(user.id, id, listId);
  }

  @Post(':id/board/lists/:listId/duplicate')
  duplicateList(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('listId') listId: string,
    @Body(new ZodValidationPipe(DuplicateListSchema)) dto: DuplicateListDto,
  ) {
    return this.projects.duplicateList(user.id, id, listId, dto);
  }

  @Delete(':id/board/lists/:listId')
  deleteList(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('listId') listId: string,
  ) {
    return this.projects.deleteList(user.id, id, listId);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.projects.remove(user.id, id);
  }
}
