import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatChannel,
  ChatChannelDocument,
} from './schemas/chat-channel.schema';
import {
  ChatMessage,
  ChatMessageDocument,
} from './schemas/chat-message.schema';
import {
  ChatReadState,
  ChatReadStateDocument,
} from './schemas/chat-read-state.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ChatAccessService } from './access/chat-access.service';
import { ChatGateway } from './chat.gateway';
import { TelegramOutboundService } from './telegram/telegram-outbound.service';
import { extractMentionTokens } from '../notifications/mentions.util';
import type {
  EditMessageDto,
  ListMessageQuery,
  MarkReadDto,
  ReactionDto,
  SendMessageDto,
} from './dto/chat.dto';

export interface MessageView {
  _id: string;
  channelId: string;
  body: string;
  kind: 'user' | 'system';
  source: 'prism' | 'telegram';
  clientId?: string;
  author: { _id: string; name: string; avatar?: string } | null;
  externalAuthor?: { name: string; username?: string };
  attachments: { fileId: string; name: string; mime: string; size: number }[];
  reactions: { emoji: string; userIds: string[] }[];
  mentions: string[];
  replyToId?: string;
  editedAt?: string;
  deleted: boolean;
  createdAt: string;
}

export interface MessagePage {
  items: MessageView[];
  /** Pass back as `before` to page further into history. Null when exhausted. */
  nextCursor: string | null;
}

@Injectable()
export class ChatMessagesService implements OnModuleInit {
  private readonly logger = new Logger(ChatMessagesService.name);

  constructor(
    @InjectModel(ChatChannel.name)
    private channelModel: Model<ChatChannelDocument>,
    @InjectModel(ChatMessage.name)
    private messageModel: Model<ChatMessageDocument>,
    @InjectModel(ChatReadState.name)
    private readStateModel: Model<ChatReadStateDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private access: ChatAccessService,
    private gateway: ChatGateway,
    private outbound: TelegramOutboundService,
  ) {}

  /**
   * One-shot migration: an early build indexed {channelId, clientId} as `sparse`,
   * which (because channelId is always present) collides for any two clientId-less
   * messages in one channel. Drop that stale index so Mongoose can recreate it as
   * the correct partial index. Safe to run every boot — a no-op once migrated.
   */
  async onModuleInit(): Promise<void> {
    try {
      const indexes = await this.messageModel.collection.indexes();
      const stale = indexes.find(
        (ix) =>
          ix.key?.channelId === 1 &&
          ix.key?.clientId === 1 &&
          ix.sparse === true &&
          !ix.partialFilterExpression,
      );
      if (stale?.name) {
        await this.messageModel.collection.dropIndex(stale.name);
        this.logger.warn(`Dropped stale sparse index ${stale.name}; it will be recreated as partial`);
        await this.messageModel.syncIndexes();
      }
    } catch (err) {
      this.logger.error(`chat index migration failed: ${String(err)}`);
    }
  }

  // ── Read ──────────────────────────────────────────────────────────

  async list(
    userId: string,
    channelId: string,
    query: ListMessageQuery,
  ): Promise<MessagePage> {
    await this.access.assertCanRead(userId, channelId);

    const filter: Record<string, unknown> = {
      channelId: new Types.ObjectId(channelId),
    };
    // `_id` is monotonic, so it doubles as the time cursor with no tie-break.
    if (query.before) filter._id = { $lt: new Types.ObjectId(query.before) };
    if (query.after) filter._id = { $gt: new Types.ObjectId(query.after) };

    const rows = await this.messageModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .lean();

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await this.toViews(page as ChatMessage[]);

    return {
      // Oldest-first for rendering; the cursor still comes off the oldest row.
      items: items.reverse(),
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    };
  }

  // ── Write ─────────────────────────────────────────────────────────

  async send(
    userId: string,
    channelId: string,
    dto: SendMessageDto,
  ): Promise<MessageView> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    const body = dto.body.trim();
    if (!body && !dto.attachmentIds.length) {
      throw new BadRequestException('Message is empty');
    }

    const mentions = await this.resolveMentions(body, channel);

    // A retried POST must not double-post. The unique {channelId, clientId} index
    // is what enforces it; this catch turns the duplicate into the original.
    let message: ChatMessageDocument;
    try {
      message = await this.messageModel.create({
        channelId: channel._id,
        workspaceId: channel.workspaceId,
        authorId: new Types.ObjectId(userId),
        body,
        kind: 'user',
        source: 'prism',
        clientId: dto.clientId,
        attachments: dto.attachmentIds.map((id) => ({
          fileId: new Types.ObjectId(id),
          name: '',
          mime: '',
          size: 0,
        })),
        mentions,
        replyToId: dto.replyToId ? new Types.ObjectId(dto.replyToId) : undefined,
      });
    } catch (err) {
      const existing =
        dto.clientId &&
        (await this.messageModel.findOne({
          channelId: channel._id,
          clientId: dto.clientId,
        }));
      if (existing) {
        const [view] = await this.toViews([existing.toObject()]);
        return view;
      }
      throw err;
    }

    const view = await this.afterPost(channel, message, userId);
    // Relay out to a linked Telegram group, off the request path.
    void this.outbound.enqueueSend(message).catch((e) =>
      this.logger.error(`Telegram relay enqueue failed: ${String(e)}`),
    );
    return view;
  }

  /**
   * Persist a message that arrived from Telegram. Kept here (not in the Telegram
   * module) so both origins share one write path — counters, previews and read
   * state can't drift between them.
   *
   * Returns null when the message is a duplicate: Telegram retries deliveries, and
   * the unique {telegram.chatId, telegram.messageId} index is the dedupe.
   */
  async ingestFromTelegram(input: {
    channel: ChatChannelDocument;
    body: string;
    authorId: Types.ObjectId | null;
    externalAuthor?: { name: string; username?: string; telegramUserId: string };
    telegram: {
      chatId: string;
      messageId: number;
      fromId?: string;
      fromUsername?: string;
      updateId?: number;
    };
  }): Promise<ChatMessageDocument | null> {
    try {
      const message = await this.messageModel.create({
        channelId: input.channel._id,
        workspaceId: input.channel.workspaceId,
        authorId: input.authorId,
        externalAuthor: input.externalAuthor,
        body: input.body,
        kind: 'user',
        source: 'telegram',
        telegram: input.telegram,
      });
      await this.afterPost(
        input.channel,
        message,
        input.authorId ? String(input.authorId) : null,
      );
      return message;
    } catch (err) {
      const e = err as { code?: number; keyPattern?: unknown };
      if (e.code === 11000) {
        this.logger.debug(
          `Duplicate Telegram message ${input.telegram.chatId}/${input.telegram.messageId} dropped (key ${JSON.stringify(e.keyPattern)})`,
        );
        return null;
      }
      throw err;
    }
  }

  async edit(
    userId: string,
    messageId: string,
    dto: EditMessageDto,
  ): Promise<MessageView> {
    const message = await this.loadOwn(userId, messageId);
    if (message.source === 'telegram') {
      // Ambiguous ownership — inbound is read-only (ADR 0007, out of scope).
      throw new ForbiddenException('Telegram messages cannot be edited here');
    }
    const channel = await this.access.assertCanWrite(
      userId,
      String(message.channelId),
    );
    message.body = dto.body.trim();
    message.mentions = await this.resolveMentions(message.body, channel);
    message.editedAt = new Date();
    await message.save();
    const [view] = await this.toViews([message.toObject()]);
    this.gateway.emitMessageUpdate(String(message.channelId), view);
    void this.outbound.enqueueEdit(message).catch(() => undefined);
    return view;
  }

  /** Soft delete — a relayed message must stay resolvable to relay its own deletion. */
  async remove(userId: string, messageId: string): Promise<{ ok: true }> {
    const message = await this.loadOwn(userId, messageId);
    // Relay the delete before blanking the body — enqueueDelete only needs the
    // relayedTo receipts, but do it first to keep intent obvious.
    void this.outbound.enqueueDelete(message).catch(() => undefined);
    message.deletedAt = new Date();
    message.body = '';
    message.attachments = [];
    await message.save();
    this.gateway.emitMessageDelete(
      String(message.channelId),
      String(message._id),
    );
    return { ok: true };
  }

  async toggleReaction(
    userId: string,
    messageId: string,
    dto: ReactionDto,
  ): Promise<MessageView> {
    const message = await this.messageModel.findById(messageId);
    if (!message) throw new NotFoundException();
    await this.access.assertCanWrite(userId, String(message.channelId));

    const me = new Types.ObjectId(userId);
    const existing = message.reactions.find((r) => r.emoji === dto.emoji);
    if (!existing) {
      message.reactions.push({ emoji: dto.emoji, userIds: [me] });
    } else if (existing.userIds.some((u) => String(u) === String(userId))) {
      existing.userIds = existing.userIds.filter(
        (u) => String(u) !== String(userId),
      );
      if (!existing.userIds.length) {
        message.reactions = message.reactions.filter(
          (r) => r.emoji !== dto.emoji,
        );
      }
    } else {
      existing.userIds.push(me);
    }
    await message.save();
    const [view] = await this.toViews([message.toObject()]);
    this.gateway.emitMessageUpdate(String(message.channelId), view);
    return view;
  }

  async markRead(
    userId: string,
    channelId: string,
    dto: MarkReadDto,
  ): Promise<{ unreadCount: number }> {
    const channel = await this.access.assertCanRead(userId, channelId);
    await this.readStateModel.updateOne(
      { userId: new Types.ObjectId(userId), channelId: channel._id },
      {
        $set: {
          lastReadMessageId: new Types.ObjectId(dto.lastReadMessageId),
          lastReadAt: new Date(),
          unreadCount: 0,
          unreadMentionCount: 0,
        },
        $setOnInsert: { workspaceId: channel.workspaceId },
      },
      { upsert: true },
    );
    return { unreadCount: 0 };
  }

  /** Total unread across every channel in every workspace — for the sidebar badge. */
  async unreadTotal(userId: string): Promise<number> {
    const rows = await this.readStateModel.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          muted: false,
          unreadCount: { $gt: 0 },
        },
      },
      { $group: { _id: null, total: { $sum: '$unreadCount' } } },
    ]);
    return rows[0]?.total ?? 0;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async loadOwn(
    userId: string,
    messageId: string,
  ): Promise<ChatMessageDocument> {
    if (!Types.ObjectId.isValid(messageId)) throw new NotFoundException();
    const message = await this.messageModel.findById(messageId);
    if (!message || message.deletedAt) throw new NotFoundException();
    // Prove channel access before revealing anything about the message.
    await this.access.assertCanRead(userId, String(message.channelId));
    if (String(message.authorId) !== String(userId)) {
      throw new ForbiddenException('Not your message');
    }
    return message;
  }

  /** Resolve `@token` to workspace members who are actually in this channel. */
  private async resolveMentions(
    body: string,
    channel: ChatChannelDocument,
  ): Promise<Types.ObjectId[]> {
    const tokens = extractMentionTokens(body);
    if (!tokens.length) return [];
    const users = await this.userModel
      .find(
        {
          _id: { $in: channel.memberIds },
          $or: [
            { email: { $in: tokens.map((t) => new RegExp(`^${t}@`, 'i')) } },
            { name: { $in: tokens.map((t) => new RegExp(`^${t}$`, 'i')) } },
          ],
        },
        { _id: 1 },
      )
      .lean();
    return users.map((u) => u._id);
  }

  /**
   * Counters, preview, unread fan-out, and realtime emission. Shared by both
   * message origins so the two can't drift apart.
   */
  private async afterPost(
    channel: ChatChannelDocument,
    message: ChatMessageDocument,
    authorId: string | null,
  ): Promise<MessageView> {
    const preview = (message.body || '[attachment]').slice(0, 140);
    await this.channelModel.updateOne(
      { _id: channel._id },
      {
        $set: { lastMessageAt: new Date(), lastMessagePreview: preview },
        $inc: { messageCount: 1 },
      },
    );

    const [view] = await this.toViews([message.toObject()]);
    this.gateway.emitMessage(String(channel._id), view);

    const recipients = channel.memberIds.filter(
      (m) => !authorId || String(m) !== String(authorId),
    );
    if (!recipients.length) return view;

    const mentioned = new Set(message.mentions.map(String));
    await this.readStateModel.bulkWrite(
      recipients.map((uid) => ({
        updateOne: {
          filter: { userId: uid, channelId: channel._id },
          update: {
            $inc: {
              unreadCount: 1,
              unreadMentionCount: mentioned.has(String(uid)) ? 1 : 0,
            },
            $setOnInsert: { workspaceId: channel.workspaceId, muted: false },
          },
          upsert: true,
        },
      })),
    );

    // Unread goes to each recipient's user room so it lands even when they don't
    // have the channel open. Read back rather than recomputing, so a concurrent
    // post can't report a stale count.
    const states = await this.readStateModel
      .find(
        { channelId: channel._id, userId: { $in: recipients } },
        { userId: 1, unreadCount: 1, unreadMentionCount: 1 },
      )
      .lean();
    for (const s of states) {
      this.gateway.emitUnread(String(s.userId), {
        channelId: String(channel._id),
        unreadCount: s.unreadCount,
        unreadMentionCount: s.unreadMentionCount,
        preview,
      });
    }
    return view;
  }

  async toViews(messages: ChatMessage[]): Promise<MessageView[]> {
    if (!messages.length) return [];
    const authorIds = [
      ...new Set(
        messages
          .map((m) => m.authorId)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const authors = authorIds.length
      ? await this.userModel
          .find({ _id: { $in: authorIds } }, { name: 1, avatar: 1 })
          .lean()
      : [];
    const authorBy = new Map(authors.map((a) => [String(a._id), a]));

    return messages.map((m) => {
      const doc = m as ChatMessageDocument;
      const author = m.authorId ? authorBy.get(String(m.authorId)) : undefined;
      const ts = m as unknown as { createdAt?: Date };
      return {
        _id: String(doc._id),
        channelId: String(m.channelId),
        body: m.body,
        kind: m.kind,
        source: m.source,
        clientId: m.clientId,
        author: author
          ? { _id: String(author._id), name: author.name, avatar: author.avatar }
          : null,
        externalAuthor: m.externalAuthor
          ? { name: m.externalAuthor.name, username: m.externalAuthor.username }
          : undefined,
        attachments: (m.attachments ?? []).map((a) => ({
          fileId: String(a.fileId),
          name: a.name,
          mime: a.mime,
          size: a.size,
        })),
        reactions: (m.reactions ?? []).map((r) => ({
          emoji: r.emoji,
          userIds: r.userIds.map(String),
        })),
        mentions: (m.mentions ?? []).map(String),
        replyToId: m.replyToId ? String(m.replyToId) : undefined,
        editedAt: m.editedAt?.toISOString(),
        deleted: Boolean(m.deletedAt),
        createdAt: (ts.createdAt ?? new Date()).toISOString(),
      };
    });
  }
}
