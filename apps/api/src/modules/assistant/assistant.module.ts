import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AssistantConversation,
  AssistantConversationSchema,
} from './schemas/assistant-conversation.schema';
import {
  AssistantMessage,
  AssistantMessageSchema,
} from './schemas/assistant-message.schema';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { InstanceModule } from '../instance/instance.module';
import { IssuesModule } from '../issues/issues.module';
import { WikiModule } from '../wiki/wiki.module';
import { CyclesModule } from '../cycles/cycles.module';
import { ModulesModule } from '../modules/modules.module';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  Workspace,
  WorkspaceSchema,
} from '../workspaces/schemas/workspace.schema';
import { DigestService } from './digest.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: AssistantConversation.name,
        schema: AssistantConversationSchema,
      },
      { name: AssistantMessage.name, schema: AssistantMessageSchema },
    ]),
    InstanceModule,
    // One import per service a tool calls into: a tool runs the *same* method
    // the HTTP route runs, so it inherits that route's authorization rather
    // than re-implementing it (ADR 0015 §2.1). AuditService comes from the
    // global AuditModule — no import needed.
    IssuesModule,
    WikiModule,
    CyclesModule,
    ModulesModule,
    ProjectsModule,
    // The weekly digest delivers through the ordinary notification path, and
    // reads recipients from the workspace roster (ADR 0015 §2.6).
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
    ]),
  ],
  controllers: [AssistantController],
  providers: [AssistantService, DigestService],
  // The Telegram bridge and the digest scheduler drive the assistant too.
  exports: [AssistantService],
})
export class AssistantModule {}
