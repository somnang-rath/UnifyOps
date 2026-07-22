import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ChatChannelsService } from './chat-channels.service';
import { ChatMessagesService } from './chat-messages.service';
import { TelegramLinkService } from './telegram/telegram-link.service';
import { TelegramIdentityService } from './telegram/telegram-identity.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  ChannelMembersDto,
  ChannelMembersSchema,
  CreateChannelDto,
  CreateChannelSchema,
  EditMessageDto,
  EditMessageSchema,
  ListChannelQuery,
  ListChannelQuerySchema,
  ListMessageQuery,
  ListMessageQuerySchema,
  MarkReadDto,
  MarkReadSchema,
  OpenDmDto,
  OpenDmSchema,
  ReactionDto,
  ReactionSchema,
  SendMessageDto,
  SendMessageSchema,
  UpdateChannelDto,
  UpdateChannelSchema,
  UpdateTelegramLinkDto,
  UpdateTelegramLinkSchema,
} from './dto/chat.dto';

/**
 * Workspace membership and channel access are asserted in the service layer (via
 * ChatAccessService), matching how webhooks and issues do it. There is no
 * WorkspaceMemberGuard in this codebase and this module does not add one.
 *
 * Typing indicators are deliberately absent here — they go over the gateway only,
 * so a keystroke-rate signal never spends the global ThrottlerGuard budget.
 */
@Controller('chat')
export class ChatController {
  constructor(
    private channels: ChatChannelsService,
    private messages: ChatMessagesService,
    private telegram: TelegramLinkService,
    private telegramIdentity: TelegramIdentityService,
  ) {}

  // ── Channels ──────────────────────────────────────────────────────

  @Get('channels')
  listChannels(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListChannelQuerySchema)) q: ListChannelQuery,
  ) {
    return this.channels.list(user.id, q);
  }

  @Post('channels')
  createChannel(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateChannelSchema)) dto: CreateChannelDto,
  ) {
    return this.channels.create(user.id, dto);
  }

  @Get('channels/:id')
  channelById(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.channels.byId(user.id, id);
  }

  @Patch('channels/:id')
  updateChannel(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateChannelSchema)) dto: UpdateChannelDto,
  ) {
    return this.channels.update(user.id, id, dto);
  }

  /** Archives — never hard-deletes. Relayed messages must stay resolvable. */
  @Delete('channels/:id')
  archiveChannel(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.channels.archive(user.id, id);
  }

  @Post('channels/:id/join')
  join(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.channels.join(user.id, id);
  }

  @Post('channels/:id/leave')
  leave(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.channels.leave(user.id, id);
  }

  @Post('channels/:id/members')
  addMembers(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChannelMembersSchema)) dto: ChannelMembersDto,
  ) {
    return this.channels.addMembers(user.id, id, dto);
  }

  @Delete('channels/:id/members/:userId')
  removeMember(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Param('userId') targetId: string,
  ) {
    return this.channels.removeMember(user.id, id, targetId);
  }

  /** Find-or-create; idempotent via the unique dmKey index. */
  @Post('dm')
  openDm(
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(OpenDmSchema)) dto: OpenDmDto,
  ) {
    return this.channels.openDm(user.id, dto);
  }

  // ── Messages ──────────────────────────────────────────────────────

  @Get('channels/:id/messages')
  listMessages(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query(new ZodQueryPipe(ListMessageQuerySchema)) q: ListMessageQuery,
  ) {
    return this.messages.list(user.id, id, q);
  }

  @Post('channels/:id/messages')
  send(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendMessageSchema)) dto: SendMessageDto,
  ) {
    return this.messages.send(user.id, id, dto);
  }

  @Post('channels/:id/read')
  markRead(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MarkReadSchema)) dto: MarkReadDto,
  ) {
    return this.messages.markRead(user.id, id, dto);
  }

  @Patch('messages/:id')
  edit(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(EditMessageSchema)) dto: EditMessageDto,
  ) {
    return this.messages.edit(user.id, id, dto);
  }

  @Delete('messages/:id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.messages.remove(user.id, id);
  }

  @Post('messages/:id/reactions')
  react(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReactionSchema)) dto: ReactionDto,
  ) {
    return this.messages.toggleReaction(user.id, id, dto);
  }

  // ── Telegram bridge (per-channel; link mutations are workspace-owner only) ──

  @Get('channels/:id/telegram')
  telegramStatus(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.telegram.status(user.id, id);
  }

  @Post('channels/:id/telegram/link')
  telegramLink(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.telegram.startLink(user.id, id);
  }

  @Patch('channels/:id/telegram')
  telegramUpdate(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTelegramLinkSchema)) dto: UpdateTelegramLinkDto,
  ) {
    return this.telegram.update(user.id, id, dto);
  }

  @Delete('channels/:id/telegram')
  telegramUnlink(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.telegram.unlink(user.id, id);
  }

  // ── Personal Telegram identity (attribution — any authenticated user) ──

  @Get('telegram/identity')
  myTelegramIdentity(@CurrentUser() user: { id: string }) {
    return this.telegramIdentity.status(user.id);
  }

  @Post('telegram/identity/link')
  linkMyTelegram(@CurrentUser() user: { id: string }) {
    return this.telegramIdentity.startLink(user.id);
  }

  @Delete('telegram/identity')
  unlinkMyTelegram(@CurrentUser() user: { id: string }) {
    return this.telegramIdentity.unlink(user.id);
  }
}
