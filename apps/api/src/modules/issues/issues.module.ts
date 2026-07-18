import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Issue, IssueSchema } from './schemas/issue.schema';
import {
  IssueRelation,
  IssueRelationSchema,
} from './schemas/issue-relation.schema';
import { IssuesService } from './issues.service';
import { IssueLinksService } from './issue-links.service';
import { IssuesController } from './issues.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ActivityModule } from '../activity/activity.module';
import { AutomationsModule } from '../automations/automations.module';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Issue.name, schema: IssueSchema },
      { name: IssueRelation.name, schema: IssueRelationSchema },
    ]),
    ProjectAccessModule,
    NotificationsModule,
    UsersModule,
    ActivityModule,
    AutomationsModule,
  ],
  controllers: [IssuesController],
  providers: [IssuesService, IssueLinksService],
  exports: [MongooseModule, IssuesService, IssueLinksService],
})
export class IssuesModule {}
