import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { InstanceAdminGuard } from '../instance/instance-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AddMemberDto,
  AddMemberSchema,
  CreateWorkspaceDto,
  CreateWorkspaceSchema,
  UpdateWorkspaceDto,
  UpdateWorkspaceSchema,
} from './dto/workspace.dto';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private workspaces: WorkspacesService) {}

  // ── Instance-admin (God Mode) ─────────────────────────────────────
  // Declared before ':id' so the literal /admin and /all segments are not
  // captured as an id param.
  @UseGuards(InstanceAdminGuard)
  @Get('all')
  listAll() {
    return this.workspaces.listAll();
  }

  @UseGuards(InstanceAdminGuard)
  @Get('admin/:id')
  detail(@Param('id') id: string) {
    return this.workspaces.detail(id);
  }

  @UseGuards(InstanceAdminGuard)
  @Patch('admin/:id')
  adminUpdate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceSchema)) dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.adminUpdate(id, dto);
  }

  @UseGuards(InstanceAdminGuard)
  @Delete('admin/:id')
  adminRemove(@Param('id') id: string) {
    return this.workspaces.adminRemove(id);
  }

  @UseGuards(InstanceAdminGuard)
  @Post('admin/:id/members')
  addMember(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) dto: AddMemberDto,
  ) {
    return this.workspaces.addMember(id, dto.email);
  }

  @UseGuards(InstanceAdminGuard)
  @Delete('admin/:id/members/:userId')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.workspaces.removeMember(id, userId);
  }

  @UseGuards(InstanceAdminGuard)
  @Get('admin/:id/projects')
  availableProjects(@Param('id') id: string) {
    return this.workspaces.availableProjects(id);
  }

  @UseGuards(InstanceAdminGuard)
  @Post('admin/:id/projects/:projectId')
  assignProject(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
  ) {
    return this.workspaces.assignProject(id, projectId);
  }

  @UseGuards(InstanceAdminGuard)
  @Delete('admin/:id/projects/:projectId')
  unassignProject(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
  ) {
    return this.workspaces.unassignProject(id, projectId);
  }

  // ── Authenticated user ────────────────────────────────────────────
  @Get()
  list(@CurrentUser() user: { id: string }) {
    return this.workspaces.listForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateWorkspaceSchema)) dto: CreateWorkspaceDto,
  ) {
    return this.workspaces.create(user.id, dto);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.workspaces.byId(id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceSchema)) dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.workspaces.remove(user.id, id);
  }
}
