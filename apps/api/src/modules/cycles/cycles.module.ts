import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Cycle, CycleSchema } from './schemas/cycle.schema';
import { CyclesService } from './cycles.service';
import { CyclesController } from './cycles.controller';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    // The Issue binding is a direct model registration, NOT an IssuesModule
    // import: cycles need the raw collection (progress rollup, assign/unassign)
    // and importing IssuesModule would drag in notifications/activity/
    // automations/webhooks and risk a cycle. Same leaf pattern as ViewsModule.
    MongooseModule.forFeature([
      { name: Cycle.name, schema: CycleSchema },
      { name: Issue.name, schema: IssueSchema },
    ]),
    // Canonical read/write rules (ADR 0003–0006) — a cycle inherits the access
    // of the project it belongs to.
    ProjectAccessModule,
  ],
  controllers: [CyclesController],
  providers: [CyclesService],
  exports: [CyclesService],
})
export class CyclesModule {}
