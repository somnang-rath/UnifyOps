import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Project, ProjectSchema } from '../schemas/project.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../../workspaces/schemas/workspace.schema';
import { ProjectAccessService } from './project-access.service';

/**
 * Leaf module for the shared project-access rule (ADR 0004). Imports only the
 * Project + Workspace models — never Issues/MRs/Wiki/Projects — so any feature
 * module can import it without creating a dependency cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
    ]),
  ],
  providers: [ProjectAccessService],
  exports: [ProjectAccessService],
})
export class ProjectAccessModule {}
