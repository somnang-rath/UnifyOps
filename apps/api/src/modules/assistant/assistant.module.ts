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
    IssuesModule,
    WikiModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
