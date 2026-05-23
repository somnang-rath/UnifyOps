import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Issue, IssueSchema } from './schemas/issue.schema';
import { IssuesService } from './issues.service';
import { IssuesController } from './issues.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ActivityModule } from '../activity/activity.module';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Issue.name, schema: IssueSchema }]),
    NotificationsModule,
    UsersModule,
    ActivityModule,
    AutomationsModule,
  ],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [MongooseModule],
})
export class IssuesModule {}
