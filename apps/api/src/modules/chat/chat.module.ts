import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatChannel, ChatChannelSchema } from './schemas/chat-channel.schema';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import {
  ChatReadState,
  ChatReadStateSchema,
} from './schemas/chat-read-state.schema';
import {
  TelegramLink,
  TelegramLinkSchema,
} from './schemas/telegram-link.schema';
import {
  TelegramIdentity,
  TelegramIdentitySchema,
} from './schemas/telegram-identity.schema';
import {
  TelegramVerification,
  TelegramVerificationSchema,
} from './schemas/telegram-verification.schema';
import { ChatController } from './chat.controller';
import { ChatChannelsService } from './chat-channels.service';
import { ChatMessagesService } from './chat-messages.service';
import { ChatAccessService } from './access/chat-access.service';
import { ChatGateway } from './chat.gateway';
import { TelegramApiService } from './telegram/telegram-api.service';
import { TelegramLinkService } from './telegram/telegram-link.service';
import { TelegramIdentityService } from './telegram/telegram-identity.service';
import { TelegramInboundService } from './telegram/telegram-inbound.service';
import { TelegramAssistantService } from './telegram/telegram-assistant.service';
import { TelegramOutboundService } from './telegram/telegram-outbound.service';
import { TelegramTransportService } from './telegram/telegram-transport.service';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';
import { ProjectAccessModule } from '../projects/access/project-access.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InstanceModule } from '../instance/instance.module';
import { AssistantModule } from '../assistant/assistant.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatChannel.name, schema: ChatChannelSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: ChatReadState.name, schema: ChatReadStateSchema },
      { name: TelegramLink.name, schema: TelegramLinkSchema },
      { name: TelegramIdentity.name, schema: TelegramIdentitySchema },
      { name: TelegramVerification.name, schema: TelegramVerificationSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
      }),
    }),
    ProjectAccessModule,
    UsersModule,
    WorkspacesModule,
    InstanceModule,
    // `@prism …` in a bridged group runs the assistant as the *linked* sender,
    // scoped to the channel's project (ADR 0015 §2.4).
    AssistantModule,
  ],
  controllers: [ChatController, TelegramWebhookController],
  providers: [
    ChatAccessService,
    ChatGateway,
    ChatChannelsService,
    ChatMessagesService,
    TelegramApiService,
    TelegramLinkService,
    TelegramIdentityService,
    TelegramInboundService,
    TelegramAssistantService,
    TelegramOutboundService,
    TelegramTransportService,
  ],
  exports: [
    MongooseModule,
    ChatAccessService,
    ChatMessagesService,
    ChatGateway,
  ],
})
export class ChatModule {}
