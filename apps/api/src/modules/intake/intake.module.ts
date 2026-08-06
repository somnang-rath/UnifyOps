import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IntakeForm,
  IntakeFormSchema,
  IntakeSubmission,
  IntakeSubmissionSchema,
} from './schemas/intake.schema';
import { IntakeService } from './intake.service';
import { IntakeController } from './intake.controller';
import { ProjectAccessModule } from '../projects/access/project-access.module';
import { IssuesModule } from '../issues/issues.module';
import { ProjectsModule } from '../projects/projects.module';
import { AssistantModule } from '../assistant/assistant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IntakeForm.name, schema: IntakeFormSchema },
      { name: IntakeSubmission.name, schema: IntakeSubmissionSchema },
    ]),
    ProjectAccessModule,
    // Accepting a submission mints a real work item via IssuesService.
    IssuesModule,
    // The AI triage suggestion (ADR 0015 §2.5) proposes a priority/labels/
    // assignee; ProjectsService supplies the member list it may choose from.
    ProjectsModule,
    AssistantModule,
    // WebhooksService (intake.received dispatch) comes from the global
    // WebhooksModule — no import needed.
  ],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
