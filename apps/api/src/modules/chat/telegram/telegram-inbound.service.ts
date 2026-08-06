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
import {
  ASSISTANT_AUTHOR_NAME,
  TelegramAssistantService,
} from './telegram-assistant.service';
import {
  fromTelegramText,
  splitForTelegram,
  toTelegramHtml,
} from './telegram-format.util';

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
    private assistant: TelegramAssistantService,
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
    const ingested = await this.messages.ingestFromTelegram({
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

    // `@prism …` → the assistant (ADR 0015 §2.4). Gated on `ingested` so a
    // redelivered update cannot make the bot answer the same question twice.
    const prompt = TelegramAssistantService.mentionIn(text);
    if (prompt !== null && ingested) {
      const answer = await this.assistant.reply({
        channel,
        prompt,
        senderUserId: authorId,
      });
      if (answer) {
        const { botToken } = await this.instance.getTelegramConfig();
        const sent = await this.reply(botToken, msg, answer);
        if (sent) await this.recordAssistantReply(channel, chatId, answer, sent);
      }
    }
  }

  /**
   * Mirror the assistant's reply back into the Prism channel, so the half of the
   * conversation the bot spoke does not exist only in Telegram.
   *
   * It goes through `ingestFromTelegram` rather than the normal send path for two
   * reasons: that path relays outward, which would post the reply to the group a
   * second time; and recording the Telegram message id it was actually sent as
   * puts it under the same unique {chatId, messageId} dedupe as any inbound
   * message, so a redelivery can never double it. `kind: 'system'` is the
   * structural belt to that braces — the outbound relay drops anything that is
   * not a prism-origin `'user'` message.
   */
  private async recordAssistantReply(
    channel: ChatChannelDocument,
    chatId: string,
    answer: string,
    sent: TelegramMessage,
  ): Promise<void> {
    try {
      await this.messages.ingestFromTelegram({
        channel,
        body: answer,
        authorId: null,
        externalAuthor: {
          name: ASSISTANT_AUTHOR_NAME,
          username: sent.from?.username,
          // Required by the schema, and the bot is a real Telegram account —
          // prefer the id Telegram just echoed over the cached one.
          telegramUserId: String(sent.from?.id ?? (await this.botId()) ?? 'bot'),
        },
        kind: 'system',
        telegram: {
          chatId,
          messageId: sent.message_id,
          fromId: sent.from ? String(sent.from.id) : undefined,
          fromUsername: sent.from?.username,
        },
      });
    } catch (err) {
      // The group already has the answer. Failing to mirror it is worth a log,
      // never an exception that aborts handling the update.
      this.logger.warn(`Failed to record assistant reply: ${String(err)}`);
    }
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

  /**
   * Post one of the bot's own messages into the group it is replying in, and
   * return the first message Telegram accepted (null if none was).
   *
   * Everything here is written as Prism's markdown subset and rendered through
   * {@link toTelegramHtml}, because `sendMessage` runs with `parse_mode: HTML`:
   * an unescaped `<` or `&` in an assistant answer — or in the literal
   * `/verify <code>` of a usage hint — is a 400 that drops the message silently.
   */
  private async reply(
    token: string,
    msg: TelegramMessage,
    text: string,
  ): Promise<TelegramMessage | null> {
    let first: TelegramMessage | null = null;
    try {
      for (const chunk of splitForTelegram(toTelegramHtml(text))) {
        const sent = await this.api.sendMessage(token, String(msg.chat.id), chunk, {
          messageThreadId: msg.message_thread_id,
        });
        first ??= sent;
      }
    } catch (err) {
      this.logger.warn(`Failed to reply in group: ${String(err)}`);
    }
    return first;
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
