import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InstanceService } from '../../instance/instance.service';
import { TelegramApiService } from './telegram-api.service';
import { TelegramInboundService } from './telegram-inbound.service';

const POLL_OFFSET_KEY = 'TELEGRAM_POLL_OFFSET';
const WEBHOOK_SECRET_KEY = 'TELEGRAM_WEBHOOK_SECRET';

/**
 * Chooses the inbound transport at boot (ADR 0007 §7):
 *  - `TELEGRAM_WEBHOOK_URL` set → register a webhook; updates arrive via the
 *    public controller and are verified with a secret token.
 *  - otherwise → long-poll `getUpdates`, persisting the offset so a restart does
 *    not replay history. This is what runs on localhost — no tunnel needed.
 *
 * Telegram permits exactly one consumer per bot token and webhook/getUpdates are
 * mutually exclusive, so this deliberately picks one mode, never both.
 */
@Injectable()
export class TelegramTransportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramTransportService.name);
  private polling = false;
  private stopped = false;

  constructor(
    private instance: InstanceService,
    private api: TelegramApiService,
    private inbound: TelegramInboundService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Defer so the app finishes booting before we start a long poll loop.
    setTimeout(() => this.start().catch((e) => this.logger.error(e)), 2000);
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  private async start(): Promise<void> {
    const cfg = await this.instance.getTelegramConfig();
    if (!cfg.enabled || !cfg.botToken) {
      this.logger.log('Telegram bridge disabled or unconfigured — transport idle');
      return;
    }

    if (cfg.webhookUrl) {
      await this.ensureWebhook(cfg.botToken, cfg.webhookUrl);
    } else {
      this.logger.log('Telegram: no webhook URL — using long polling');
      void this.pollLoop(cfg.botToken);
    }
  }

  /** Register the webhook with a stable secret token (generated once, persisted). */
  private async ensureWebhook(token: string, baseUrl: string): Promise<void> {
    let secret = (await this.instance.getTelegramConfig()).webhookSecret;
    if (!secret) {
      secret = randomBytes(24).toString('hex');
      await this.instance.setConfigValue(WEBHOOK_SECRET_KEY, secret);
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/telegram/webhook/${secret}`;
    try {
      await this.api.setWebhook(token, url, secret);
      this.logger.log(`Telegram webhook registered at ${url}`);
    } catch (err) {
      this.logger.error(`Failed to set Telegram webhook: ${String(err)}`);
    }
  }

  // ── Long polling ────────────────────────────────────────────────────

  private async pollLoop(token: string): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    // Make sure no webhook is set, or getUpdates will 409.
    try {
      await this.api.deleteWebhook(token);
    } catch {
      /* ignore */
    }

    let offset = await this.readOffset();
    while (!this.stopped) {
      try {
        const updates = await this.api.getUpdates(token, offset, 30);
        for (const u of updates) {
          try {
            await this.inbound.handleUpdate(u);
          } catch (err) {
            this.logger.error(`handleUpdate failed: ${String(err)}`);
          }
          offset = u.update_id + 1;
        }
        if (updates.length) await this.writeOffset(offset);
      } catch (err) {
        this.logger.warn(`getUpdates error, backing off: ${String(err)}`);
        await this.sleep(3000);
      }
    }
    this.polling = false;
  }

  private async readOffset(): Promise<number> {
    const raw = await this.instance.readConfigValue(POLL_OFFSET_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private async writeOffset(offset: number): Promise<void> {
    await this.instance.setConfigValue(POLL_OFFSET_KEY, String(offset));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
