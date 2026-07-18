import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';
import { InstanceAdminGuard } from '../instance/instance-admin.guard';
import { InstanceModule } from '../instance/instance.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
    ]),
    // InstanceModule re-exports its Mongoose models (incl. InstanceAdmin), which
    // InstanceAdminGuard needs; UsersModule provides the User model;
    // ProjectsModule provides the Project model (assignment + counts).
    // ProjectAccessModule is the leaf that owns the workspace-membership gate.
    InstanceModule,
    UsersModule,
    ProjectsModule,
    ProjectAccessModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, InstanceAdminGuard],
  exports: [MongooseModule],
})
export class WorkspacesModule {}
