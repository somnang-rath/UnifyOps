import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatChannel,
  ChatChannelDocument,
} from '../schemas/chat-channel.schema';
import {
  TelegramIdentity,
  TelegramIdentityDocument,
} from '../schemas/telegram-identity.schema';
import { ChatMessagesService } from '../chat-messages.service';
import { InstanceService } from '../../instance/instance.service';
import { TelegramApiService, TelegramMessage, TelegramUpdate } from './telegram-api.service';
import { TelegramLinkService } from './telegram-link.service';
import { TelegramIdentityService } from './telegram-identity.service';
import { fromTelegramText } from './telegram-format.util';

/**
 * The single entry point for every inbound Telegram update, whichever transport
 * delivered it (webhook or long polling). Keeping dedupe, identity mapping, the
 * `/link` command, and echo prevention in one place makes them testable together.
 */
@Injectable()
export class TelegramInboundService {
  private readonly logger = new Logger(TelegramInboundService.name);
  private botIdCache: number | null = null;

  constructor(
    @InjectModel(ChatChannel.name)
    private channelModel: Model<ChatChannelDocument>,
    @InjectModel(TelegramIdentity.name)
    private identityModel: Model<TelegramIdentityDocument>,
    private messages: ChatMessagesService,
    private instance: InstanceService,
    private api: TelegramApiService,
    private links: TelegramLinkService,
    private identities: TelegramIdentityService,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message ?? update.edited_message;
    if (!msg) return;

    // Echo guard layer 2: never re-ingest the bot's own posts (ADR §6).
    const botId = await this.botId();
    if (msg.from?.is_bot && botId !== null && msg.from.id === botId) return;

    const text = fromTelegramText(msg);

    // `/verify <code>` claims a personal account for attribution. Handled anywhere
    // (usually a private DM to the bot) and never stored as a chat message.
    if (text.startsWith('/verify')) {
      await this.handleVerifyCommand(msg, text);
      return;
    }

    // `/link <code>` connects a group to a channel; never stored as a message.
    if (text.startsWith('/link') || text.startsWith('/connect')) {
      await this.handleLinkCommand(msg, text);
      return;
    }

    const chatId = String(msg.chat.id);
    const link = await this.links.channelForChat(chatId, msg.message_thread_id);
    if (!link) return; // Message from an unlinked group — ignore.
    if (link.direction === 'to-telegram') return; // Inbound relay disabled.

    const channel = await this.channelModel.findById(link.channelId);
    if (!channel) return;
    if (!text) return; // Non-text (sticker/photo without caption) — v1 skips.

    const { authorId, externalAuthor } = await this.resolveSender(msg);

    // Dedupe is the unique {telegram.chatId, telegram.messageId} index — ingest
    // catches E11000 and returns null for a duplicate delivery.
    await this.messages.ingestFromTelegram({
      channel,
      body: text,
      authorId,
      externalAuthor,
      telegram: {
        chatId,
        messageId: msg.message_id,
        fromId: msg.from ? String(msg.from.id) : undefined,
        fromUsername: msg.from?.username,
        updateId: update.update_id,
      },
    });
  }

  private async handleVerifyCommand(
    msg: TelegramMessage,
    text: string,
  ): Promise<void> {
    const code = text.replace(/^\/verify(@\w+)?\s*/i, '').trim();
    const { botToken } = await this.instance.getTelegramConfig();
    if (!code || !msg.from) {
      await this.reply(botToken, msg, 'Usage: /verify <code> — get a code from Prism settings.');
      return;
    }
    const reply = await this.identities.verifyFromTelegram(code, msg.from);
    await this.reply(botToken, msg, reply);
  }

  private async handleLinkCommand(
    msg: TelegramMessage,
    text: string,
  ): Promise<void> {
    const code = text.replace(/^\/(link|connect)(@\w+)?\s*/i, '').trim();
    const { botToken } = await this.instance.getTelegramConfig();
    if (!code || !msg.from) {
      await this.reply(botToken, msg, 'Usage: /link <code> — get a code from the channel in Prism.');
      return;
    }
    const result = await this.links.completeLinkFromGroup({
      code,
      chatId: String(msg.chat.id),
      chatTitle: msg.chat.title ?? '',
      threadId: msg.message_thread_id,
      senderTelegramId: String(msg.from.id),
    });
    if (!result) {
      await this.reply(botToken, msg, "That code doesn't match a pending link.");
      return;
    }
    await this.reply(botToken, msg, result.message);
  }

  /** Map a Telegram sender to a Prism user, or fall back to an external author. */
  private async resolveSender(msg: TelegramMessage): Promise<{
    authorId: Types.ObjectId | null;
    externalAuthor?: { name: string; username?: string; telegramUserId: string };
  }> {
    const from = msg.from;
    if (!from) return { authorId: null };

    const telegramUserId = String(from.id);
    const identity = await this.identityModel
      .findOne({ telegramUserId })
      .lean();

    // Keep the identity's profile fresh so a later claim has current data.
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
    await this.identityModel.updateOne(
      { telegramUserId },
      {
        $set: { username: from.username, firstName: from.first_name, lastName: from.last_name ?? '' },
        $setOnInsert: { telegramUserId, userId: identity?.userId ?? null },
      },
      { upsert: true },
    );

    if (identity?.userId) {
      return { authorId: identity.userId as Types.ObjectId };
    }
    return {
      authorId: null,
      externalAuthor: { name: name || 'Telegram user', username: from.username, telegramUserId },
    };
  }

  private async reply(
    token: string,
    msg: TelegramMessage,
    text: string,
  ): Promise<void> {
    try {
      await this.api.sendMessage(token, String(msg.chat.id), text, {
        messageThreadId: msg.message_thread_id,
      });
    } catch (err) {
      this.logger.warn(`Failed to reply in group: ${String(err)}`);
    }
  }

  private async botId(): Promise<number | null> {
    if (this.botIdCache !== null) return this.botIdCache;
    const { botToken } = await this.instance.getTelegramConfig();
    if (!botToken) return null;
    try {
      const me = await this.api.getMe(botToken);
      this.botIdCache = me.id;
      return me.id;
    } catch {
      return null;
    }
  }
}
