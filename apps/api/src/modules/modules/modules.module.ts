import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProjectModule as ProjectModuleSchemaClass,
  ProjectModuleSchema,
} from './schemas/module.schema';
import { ModulesService } from './modules.service';
import { ModulesController } from './modules.controller';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { ProjectAccessModule } from '../projects/access/project-access.module';

/**
 * The schema class is aliased on import because this file needs BOTH Nest's
 * `Module` decorator and the entity — the entity is already named
 * `ProjectModule` to dodge that collision, and the alias keeps the remaining
 * near-miss (`ProjectModule` entity vs `ProjectAccessModule`) unambiguous.
 */
@Module({
  imports: [
    // Direct Issue model registration rather than importing IssuesModule:
    // modules only need the raw collection (progress rollup, assign/unassign),
    // and IssuesModule would drag in notifications/activity/automations/
    // webhooks. Same leaf pattern as ViewsModule and CyclesModule.
    MongooseModule.forFeature([
      { name: ProjectModuleSchemaClass.name, schema: ProjectModuleSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
    ProjectAccessModule,
  ],
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
