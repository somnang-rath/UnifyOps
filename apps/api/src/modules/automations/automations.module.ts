import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Automation,
  AutomationLog,
  AutomationLogSchema,
  AutomationSchema,
} from './schemas/automation.schema';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Automation.name, schema: AutomationSchema },
      { name: AutomationLog.name, schema: AutomationLogSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
    forwardRef(() => NotificationsModule),
    UsersModule,
    // Resolves an event's workspace and gates rule CRUD (ADR 0003). A leaf —
    // Project + Workspace models only — so no cycle with projects/issues.
    ProjectAccessModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
