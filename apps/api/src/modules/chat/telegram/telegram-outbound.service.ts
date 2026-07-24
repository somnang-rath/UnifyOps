import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../schemas/chat-message.schema';
import {
  TelegramLink,
  TelegramLinkDocument,
} from '../schemas/telegram-link.schema';
import { InstanceService } from '../../instance/instance.service';
import { TelegramApiService, TelegramApiError } from './telegram-api.service';
import {
  formatRelayedMessage,
  splitForTelegram,
} from './telegram-format.util';

type Job =
  | { kind: 'send'; messageId: string; chatId: string; threadId: number | null; text: string }
  | { kind: 'edit'; chatId: string; messageId: number; text: string }
  | { kind: 'delete'; chatId: string; messageId: number };

/**
 * Relays Prism messages out to linked Telegram groups (ADR 0007 §5). Never runs on
 * the user's send path — jobs are queued and drained here so Telegram latency and
 * rate limits stay off the request.
 *
 * Queue: an in-process, per-chat FIFO with token-bucket rate limiting. This is the
 * Redis-absent degradation the reports module also accepts — ordering holds within
 * the process and is lost on crash. A BullMQ processor (concurrency 1 per chatId)
 * is the horizontal-scale path; it would call {@link runJob} unchanged.
 */
@Injectable()
export class TelegramOutboundService {
  private readonly logger = new Logger(TelegramOutboundService.name);
  /** chatId → serialized job chain, so messages to one group keep their order. */
  private chains = new Map<string, Promise<void>>();
  /** chatId → timestamps of recent sends, for the per-chat rate window. */
  private recent = new Map<string, number[]>();
  private globalRecent: number[] = [];

  // Stay under Telegram's ceilings (~30/s global, ~20/min per group).
  private readonly GLOBAL_PER_SEC = 25;
  private readonly PER_CHAT_PER_MIN = 18;

  constructor(
    @InjectModel(ChatMessage.name)
    private messageModel: Model<ChatMessageDocument>,
    @InjectModel(TelegramLink.name)
    private linkModel: Model<TelegramLinkDocument>,
    private instance: InstanceService,
    private api: TelegramApiService,
  ) {}

  /**
   * Queue a freshly-posted Prism message for relay, if its channel has an active
   * outbound link. Fire-and-forget: the caller (message send) does not await this.
   */
  async enqueueSend(message: ChatMessageDocument): Promise<void> {
    // Structural echo guard: only prism-origin messages are ever relayed (ADR §6).
    if (message.source !== 'prism' || message.kind !== 'user') return;
    const link = await this.linkModel
      .findOne({ channelId: message.channelId, active: true, chatId: { $ne: null } })
      .lean();
    if (!link || !link.chatId) return;
    if (link.direction === 'from-telegram') return;

    const authorName = await this.authorName(message.authorId);
    const html = formatRelayedMessage(authorName, message.body);
    const chunks = splitForTelegram(html);
    for (const text of chunks) {
      this.push(link.chatId, {
        kind: 'send',
        messageId: String(message._id),
        chatId: link.chatId,
        threadId: link.threadId ?? null,
        text,
      });
    }
  }

  /** Relay an edit to every group this message was mirrored into. */
  async enqueueEdit(message: ChatMessageDocument): Promise<void> {
    if (message.source !== 'prism') return;
    const authorName = await this.authorName(message.authorId);
    const html = formatRelayedMessage(authorName, message.body);
    for (const r of message.relayedTo ?? []) {
      this.push(r.chatId, {
        kind: 'edit',
        chatId: r.chatId,
        messageId: r.messageId,
        text: splitForTelegram(html)[0],
      });
    }
  }

  /** Relay a delete to every group this message was mirrored into. */
  async enqueueDelete(message: ChatMessageDocument): Promise<void> {
    for (const r of message.relayedTo ?? []) {
      this.push(r.chatId, {
        kind: 'delete',
        chatId: r.chatId,
        messageId: r.messageId,
      });
    }
  }

  // ── Queue internals ────────────────────────────────────────────────

  private push(chatId: string, job: Job): void {
    const prev = this.chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(() => this.runJob(job));
    this.chains.set(chatId, next);
  }

  private async runJob(job: Job, attempt = 0): Promise<void> {
    const { botToken } = await this.instance.getTelegramConfig();
    if (!botToken) return;

    await this.throttle(job.chatId);

    try {
      if (job.kind === 'send') {
        const sent = await this.api.sendMessage(botToken, job.chatId, job.text, {
          messageThreadId: job.threadId,
        });
        // Record the receipt so a later edit/delete can follow the message.
        await this.messageModel.updateOne(
          { _id: new Types.ObjectId(job.messageId) },
          {
            $push: {
              relayedTo: {
                chatId: job.chatId,
                messageId: sent.message_id,
                sentAt: new Date(),
              },
            },
          },
        );
      } else if (job.kind === 'edit') {
        await this.api.editMessageText(botToken, job.chatId, job.messageId, job.text);
      } else {
        await this.api.deleteMessage(botToken, job.chatId, job.messageId);
      }
      await this.markHealthy(job.chatId);
    } catch (err) {
      await this.handleError(job, err, attempt);
    }
  }

  private async handleError(job: Job, err: unknown, attempt: number): Promise<void> {
    const e = err as TelegramApiError;
    // 429: honour Telegram's own backpressure signal exactly.
    if (e.code === 429 && e.retryAfter && attempt < 5) {
      await this.sleep((e.retryAfter + 1) * 1000);
      return this.runJob(job, attempt + 1);
    }
    // 403: the bot was kicked/blocked — terminal, deactivate rather than retry.
    if (e.code === 403) {
      await this.linkModel.updateOne(
        { chatId: job.chatId },
        {
          $set: {
            active: false,
            lastError: 'Bot was removed from the group',
          },
        },
      );
      this.logger.warn(`Deactivated link for chat ${job.chatId}: 403`);
      return;
    }
    // Transient: exponential backoff, capped attempts.
    if (attempt < 5) {
      await this.sleep(Math.min(2 ** attempt * 1000, 30_000));
      return this.runJob(job, attempt + 1);
    }
    await this.linkModel.updateOne(
      { chatId: job.chatId },
      {
        $set: { lastError: e.message ?? 'relay failed' },
        $inc: { consecutiveFailures: 1 },
      },
    );
    this.logger.error(`Relay to ${job.chatId} failed after retries: ${e.message}`);
  }

  private async markHealthy(chatId: string): Promise<void> {
    await this.linkModel.updateOne(
      { chatId },
      { $set: { lastRelayAt: new Date(), lastError: null, consecutiveFailures: 0 } },
    );
  }

  /** Block until sending to this chat respects both the global and per-chat budgets. */
  private async throttle(chatId: string): Promise<void> {
    // Loop because after sleeping the window may still be saturated.
    for (;;) {
      const now = Date.now();
      this.globalRecent = this.globalRecent.filter((t) => now - t < 1000);
      const chatWindow = (this.recent.get(chatId) ?? []).filter(
        (t) => now - t < 60_000,
      );
      const overGlobal = this.globalRecent.length >= this.GLOBAL_PER_SEC;
      const overChat = chatWindow.length >= this.PER_CHAT_PER_MIN;
      if (!overGlobal && !overChat) {
        this.globalRecent.push(now);
        chatWindow.push(now);
        this.recent.set(chatId, chatWindow);
        return;
      }
      const wait = overChat
        ? 60_000 - (now - chatWindow[0])
        : 1000 - (now - this.globalRecent[0]);
      await this.sleep(Math.max(50, wait));
    }
  }

  private async authorName(authorId: Types.ObjectId | null): Promise<string> {
    if (!authorId) return 'Someone';
    // Author name is denormalized cheaply via the users collection through the
    // message model's ref; a small lookup keeps the relay independent of the
    // message service (no cycle).
    const user = await this.messageModel.db
      .collection('users')
      .findOne({ _id: authorId }, { projection: { name: 1 } });
    return (user?.name as string) ?? 'Someone';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
