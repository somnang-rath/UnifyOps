import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Project, ProjectSchema } from './schemas/project.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../workspaces/schemas/workspace.schema';
import { ProjectAccessModule } from './access/project-access.module';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { UsersModule } from '../users/users.module';
import { IssuesModule } from '../issues/issues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AutomationsModule } from '../automations/automations.module';
import {
  WikiPage,
  WikiPageSchema,
} from '../wiki/schemas/wiki-page.schema';
import { View, ViewSchema } from '../views/schemas/view.schema';

@Module({
  imports: [
    // WikiPage + View bindings exist only for anchor-collision checks at
    // publish time (ADR 0012 §2) — own registration, no module dependency.
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WikiPage.name, schema: WikiPageSchema },
      { name: View.name, schema: ViewSchema },
    ]),
    ProjectAccessModule,
    UsersModule,
    IssuesModule,
    NotificationsModule,
    AutomationsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [MongooseModule],
})
export class ProjectsModule {}
