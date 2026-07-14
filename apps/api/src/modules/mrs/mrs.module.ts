import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MergeRequest, MergeRequestSchema } from './schemas/mr.schema';
import { MrsService } from './mrs.service';
import { MrsController } from './mrs.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ActivityModule } from '../activity/activity.module';
import { UsersModule } from '../users/users.module';
import { AutomationsModule } from '../automations/automations.module';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MergeRequest.name, schema: MergeRequestSchema },
    ]),
    ProjectAccessModule,
    NotificationsModule,
    ActivityModule,
    UsersModule,
    AutomationsModule,
  ],
  controllers: [MrsController],
  providers: [MrsService],
  exports: [MongooseModule, MrsService],
})
export class MrsModule {}
