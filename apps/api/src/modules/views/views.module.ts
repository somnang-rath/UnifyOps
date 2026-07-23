import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { View, ViewSchema } from './schemas/view.schema';
import { ViewsService } from './views.service';
import { ViewsController } from './views.controller';
import { ProjectAccessModule } from '../projects/access/project-access.module';
import {
  WikiPage,
  WikiPageSchema,
} from '../wiki/schemas/wiki-page.schema';
import {
  Project,
  ProjectSchema,
} from '../projects/schemas/project.schema';

@Module({
  imports: [
    // WikiPage + Project bindings exist only for anchor-collision checks at
    // publish time (ADR 0012 §2) — own registration, no WikiModule dependency.
    MongooseModule.forFeature([
      { name: View.name, schema: ViewSchema },
      { name: WikiPage.name, schema: WikiPageSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    // The canonical read/write rules (ADR 0003–0006) — a view's scope is
    // decided by the project/workspace access it wraps.
    ProjectAccessModule,
  ],
  controllers: [ViewsController],
  providers: [ViewsService],
  exports: [ViewsService],
})
export class ViewsModule {}
