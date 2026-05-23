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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Automation.name, schema: AutomationSchema },
      { name: AutomationLog.name, schema: AutomationLogSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
    forwardRef(() => NotificationsModule),
    UsersModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
