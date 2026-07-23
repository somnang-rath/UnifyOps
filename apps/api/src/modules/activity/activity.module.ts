import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Activity.name, schema: ActivitySchema },
    ]),
    // Leaf module (ADR 0004) — safe to import without a dependency cycle.
    ProjectAccessModule,
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
