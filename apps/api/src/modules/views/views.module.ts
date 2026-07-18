import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { View, ViewSchema } from './schemas/view.schema';
import { ViewsService } from './views.service';
import { ViewsController } from './views.controller';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: View.name, schema: ViewSchema }]),
    // The canonical read/write rules (ADR 0003–0006) — a view's scope is
    // decided by the project/workspace access it wraps.
    ProjectAccessModule,
  ],
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
