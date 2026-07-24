import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { MergeRequest, MergeRequestSchema } from '../mrs/schemas/mr.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Activity, ActivitySchema } from '../activity/schemas/activity.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { DashboardController } from './dashboard.controller';
import { BadgesController } from './badges.controller';
import { DashboardService } from './dashboard.service';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Issue.name, schema: IssueSchema },
      { name: MergeRequest.name, schema: MergeRequestSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: User.name, schema: UserSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
    ChatModule,
  ],
  controllers: [DashboardController, BadgesController],
  providers: [DashboardService],
})
export class DashboardModule {}
