import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  TelegramLink,
  TelegramLinkDocument,
} from '../schemas/telegram-link.schema';
import {
  ChatChannel,
  ChatChannelDocument,
} from '../schemas/chat-channel.schema';
import { ChatAccessService } from '../access/chat-access.service';
import { InstanceService } from '../../instance/instance.service';
import { TelegramApiService } from './telegram-api.service';
import type { UpdateTelegramLinkDto } from '../dto/chat.dto';

/** Status returned to the web link panel. Never includes the bot token. */
export interface TelegramLinkStatus {
  linked: boolean;
  active: boolean;
  direction: 'both' | 'to-telegram' | 'from-telegram';
  chatTitle: string;
  chatId: string | null;
  pendingCode: string | null;
  pendingCodeExpiresAt: string | null;
  botUsername: string | null;
  lastError: string | null;
}

const CODE_TTL_MS = 15 * 60_000;

function genCode(): string {
  // 8 unambiguous uppercase chars — easy to retype into a Telegram group.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

@Injectable()
export class TelegramLinkService {
  private readonly logger = new Logger(TelegramLinkService.name);
  private botUsernameCache: string | null = null;

  constructor(
    @InjectModel(TelegramLink.name)
    private linkModel: Model<TelegramLinkDocument>,
    @InjectModel(ChatChannel.name)
    private channelModel: Model<ChatChannelDocument>,
    private access: ChatAccessService,
    private instance: InstanceService,
    private api: TelegramApiService,
  ) {}

  /** The bot's @username, cached, for the linking instructions. */
  async botUsername(): Promise<string | null> {
    if (this.botUsernameCache) return this.botUsernameCache;
    const { botToken } = await this.instance.getTelegramConfig();
    if (!botToken) return null;
    try {
      const me = await this.api.getMe(botToken);
      this.botUsernameCache = me.username ?? null;
      return this.botUsernameCache;
    } catch {
      return null;
    }
  }

  async status(userId: string, channelId: string): Promise<TelegramLinkStatus> {
    const channel = await this.access.assertCanRead(userId, channelId);
    const link = await this.linkModel.findOne({ channelId: channel._id }).lean();
    return {
      linked: Boolean(link?.chatId),
      active: link?.active ?? false,
      direction: link?.direction ?? 'both',
      chatTitle: link?.chatTitle ?? '',
      chatId: link?.chatId ?? null,
      pendingCode: link?.pendingCode ?? null,
      pendingCodeExpiresAt: link?.pendingCodeExpiresAt
        ? new Date(link.pendingCodeExpiresAt).toISOString()
        : null,
      botUsername: await this.botUsername(),
      lastError: link?.lastError ?? null,
    };
  }

  /**
   * Mint (or refresh) a pending link code. Owner-only: linking moves data off the
   * instance (ADR 0007). Returns the code + bot username for the instructions.
   */
  async startLink(
    userId: string,
    channelId: string,
  ): Promise<{ code: string; expiresAt: string; botUsername: string | null }> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM cannot be linked to Telegram');
    }
    await this.access.assertWorkspaceOwner(userId, channel.workspaceId);

    const { enabled, botToken } = await this.instance.getTelegramConfig();
    if (!enabled || !botToken) {
      throw new BadRequestException('Telegram is not configured on this instance');
    }

    const code = genCode();
    const expires = new Date(Date.now() + CODE_TTL_MS);
    await this.linkModel.updateOne(
      { channelId: channel._id },
      {
        $set: {
          pendingCode: code,
          pendingCodeExpiresAt: expires,
          linkedBy: new Types.ObjectId(userId),
        },
        $setOnInsert: {
          workspaceId: channel.workspaceId,
          direction: 'both',
          active: false,
          consecutiveFailures: 0,
        },
      },
      { upsert: true },
    );

    return {
      code,
      expiresAt: expires.toISOString(),
      botUsername: await this.botUsername(),
    };
  }

  async update(
    userId: string,
    channelId: string,
    dto: UpdateTelegramLinkDto,
  ): Promise<TelegramLinkStatus> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    await this.access.assertWorkspaceOwner(userId, channel.workspaceId);
    const link = await this.linkModel.findOne({ channelId: channel._id });
    if (!link) throw new NotFoundException();
    if (dto.direction !== undefined) link.direction = dto.direction;
    if (dto.active !== undefined) link.active = dto.active;
    await link.save();
    return this.status(userId, channelId);
  }

  async unlink(userId: string, channelId: string): Promise<{ ok: true }> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    await this.access.assertWorkspaceOwner(userId, channel.workspaceId);
    await this.linkModel.deleteOne({ channelId: channel._id });
    return { ok: true };
  }

  // ── Called from the inbound handler when a `/link <code>` arrives ──

  /**
   * Complete a link from inside the Telegram group. The code proves intent; the
   * real gate is that the SENDER must be a group admin (anyone could retype a
   * leaked code). Returns a confirmation string to post back, or null if no
   * pending link matched.
   */
  async completeLinkFromGroup(input: {
    code: string;
    chatId: string;
    chatTitle: string;
    threadId?: number;
    senderTelegramId: string;
  }): Promise<{ channelId: string; message: string } | null> {
    const link = await this.linkModel.findOne({
      pendingCode: input.code.toUpperCase(),
    });
    if (!link) return null;
    if (
      link.pendingCodeExpiresAt &&
      link.pendingCodeExpiresAt.getTime() < Date.now()
    ) {
      link.pendingCode = null;
      link.pendingCodeExpiresAt = null;
      await link.save();
      return { channelId: String(link.channelId), message: 'That link code has expired. Generate a new one in Prism.' };
    }

    const { botToken } = await this.instance.getTelegramConfig();
    // Sender-must-be-admin is the actual proof of control over the group.
    let isAdmin = false;
    try {
      const admins = await this.api.getChatAdministrators(botToken, input.chatId);
      isAdmin = admins.some(
        (a) => String(a.user.id) === input.senderTelegramId,
      );
    } catch (err) {
      this.logger.warn(`getChatAdministrators failed: ${String(err)}`);
    }
    if (!isAdmin) {
      return {
        channelId: String(link.channelId),
        message: 'Only a group administrator can link this group.',
      };
    }

    // Enforce the one-group-one-channel rule before activating.
    const clash = await this.linkModel.findOne({
      _id: { $ne: link._id },
      chatId: input.chatId,
      threadId: input.threadId ?? null,
      active: true,
    });
    if (clash) {
      return {
        channelId: String(link.channelId),
        message: 'This Telegram group is already linked to another Prism channel.',
      };
    }

    link.chatId = input.chatId;
    link.threadId = input.threadId ?? null;
    link.chatTitle = input.chatTitle;
    link.active = true;
    link.linkedAt = new Date();
    link.pendingCode = null;
    link.pendingCodeExpiresAt = null;
    link.consecutiveFailures = 0;
    link.lastError = null;
    await link.save();

    return {
      channelId: String(link.channelId),
      message: '✅ Linked to Prism. Messages will now sync both ways.',
    };
  }

  /** The active link for a channel, or null. Used by the outbound relay. */
  activeLinkForChannel(channelId: Types.ObjectId | string) {
    return this.linkModel
      .findOne({ channelId, active: true, chatId: { $ne: null } })
      .lean();
  }

  /** The channel a Telegram chat feeds into, if any. Used by the inbound handler. */
  channelForChat(chatId: string, threadId?: number) {
    return this.linkModel
      .findOne({
        chatId,
        threadId: threadId ?? null,
        active: true,
      })
      .lean();
  }
}
