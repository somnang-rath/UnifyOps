import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  TelegramIdentity,
  TelegramIdentityDocument,
} from '../schemas/telegram-identity.schema';
import {
  TelegramVerification,
  TelegramVerificationDocument,
} from '../schemas/telegram-verification.schema';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../schemas/chat-message.schema';
import { TelegramLinkService } from './telegram-link.service';
import type { TelegramUser } from './telegram-api.service';

export interface MyTelegramIdentity {
  linked: boolean;
  telegramUsername: string | null;
  telegramName: string | null;
  pendingCode: string | null;
  pendingCodeExpiresAt: string | null;
  botUsername: string | null;
}

const CODE_TTL_MS = 15 * 60_000;

function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Personal Telegram-account linking for attribution (ADR 0007): once a user proves
 * a Telegram account is theirs, their messages in any linked group are attributed
 * to their Prism identity instead of showing as an external author.
 */
@Injectable()
export class TelegramIdentityService {
  private readonly logger = new Logger(TelegramIdentityService.name);

  constructor(
    @InjectModel(TelegramIdentity.name)
    private identityModel: Model<TelegramIdentityDocument>,
    @InjectModel(TelegramVerification.name)
    private verificationModel: Model<TelegramVerificationDocument>,
    @InjectModel(ChatMessage.name)
    private messageModel: Model<ChatMessageDocument>,
    private links: TelegramLinkService,
  ) {}

  async status(userId: string): Promise<MyTelegramIdentity> {
    const me = new Types.ObjectId(userId);
    const [identity, pending] = await Promise.all([
      this.identityModel.findOne({ userId: me, verifiedAt: { $ne: null } }).lean(),
      this.verificationModel.findOne({ userId: me }).lean(),
    ]);
    return {
      linked: Boolean(identity),
      telegramUsername: identity?.username ?? null,
      telegramName: identity
        ? [identity.firstName, identity.lastName].filter(Boolean).join(' ') || null
        : null,
      pendingCode: pending?.code ?? null,
      pendingCodeExpiresAt: pending?.expiresAt
        ? new Date(pending.expiresAt).toISOString()
        : null,
      botUsername: await this.links.botUsername(),
    };
  }

  /** Mint (or refresh) a personal verification code for the current user. */
  async startLink(
    userId: string,
  ): Promise<{ code: string; expiresAt: string; botUsername: string | null }> {
    const code = genCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.verificationModel.updateOne(
      { userId: new Types.ObjectId(userId) },
      { $set: { code, expiresAt } },
      { upsert: true },
    );
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      botUsername: await this.links.botUsername(),
    };
  }

  async unlink(userId: string): Promise<{ ok: true }> {
    const me = new Types.ObjectId(userId);
    await Promise.all([
      this.verificationModel.deleteOne({ userId: me }),
      // Detach the mapping but keep the identity row (it may be re-used to track
      // the Telegram profile); future messages fall back to external author.
      this.identityModel.updateMany(
        { userId: me },
        { $set: { userId: null, verifiedAt: null } },
      ),
    ]);
    return { ok: true };
  }

  /**
   * Complete a personal claim from a `/verify <code>` the user DM'd to the bot.
   * Returns a message to post back. On success, maps the Telegram id to the Prism
   * user and backfills that sender's past group messages to the real author.
   */
  async verifyFromTelegram(
    code: string,
    from: TelegramUser,
  ): Promise<string> {
    const pending = await this.verificationModel.findOne({
      code: code.toUpperCase(),
    });
    if (!pending) return "That code doesn't match a pending link.";
    if (pending.expiresAt.getTime() < Date.now()) {
      await this.verificationModel.deleteOne({ _id: pending._id });
      return 'That code has expired. Generate a new one in Prism settings.';
    }

    const telegramUserId = String(from.id);
    // Guard: don't let one Telegram account be claimed by two Prism users.
    const claimed = await this.identityModel.findOne({
      telegramUserId,
      userId: { $ne: null, $exists: true },
      verifiedAt: { $ne: null },
    });
    if (claimed && String(claimed.userId) !== String(pending.userId)) {
      return 'This Telegram account is already linked to another Prism user.';
    }

    await this.identityModel.updateOne(
      { telegramUserId },
      {
        $set: {
          userId: pending.userId,
          username: from.username,
          firstName: from.first_name,
          lastName: from.last_name ?? '',
          verifiedAt: new Date(),
          verificationCode: null,
          verificationCodeExpiresAt: null,
        },
        $setOnInsert: { telegramUserId },
      },
      { upsert: true },
    );
    await this.verificationModel.deleteOne({ _id: pending._id });

    // Backfill: attribute this sender's past group messages to the Prism user
    // (ADR 0007 risk #6 — one updateMany).
    const res = await this.messageModel.updateMany(
      { 'externalAuthor.telegramUserId': telegramUserId, authorId: null },
      { $set: { authorId: pending.userId } },
    );
    if (res.modifiedCount) {
      this.logger.log(
        `Backfilled ${res.modifiedCount} messages for Telegram ${telegramUserId}`,
      );
    }

    return '✅ Linked. Your messages in connected groups will now show as you.';
  }
}
