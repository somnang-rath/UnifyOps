import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WikiPage,
  WikiPageSchema,
} from '../wiki/schemas/wiki-page.schema';
import { View, ViewSchema } from '../views/schemas/view.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/**
 * Public Space (ADR 0002, extended by ADR 0012) — anonymous, read-only
 * resolution of published content by public anchor. Registers its own model
 * bindings so it does not depend on the feature modules' internals.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WikiPage.name, schema: WikiPageSchema },
      { name: View.name, schema: ViewSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
