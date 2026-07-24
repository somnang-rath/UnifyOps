import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { InstanceService } from '../../instance/instance.service';
import { TelegramInboundService } from './telegram-inbound.service';
import type { TelegramUpdate } from './telegram-api.service';

/**
 * The one unauthenticated route in the chat module — kept in its own controller so
 * it can be reviewed in isolation (same reasoning as the intake public routes).
 *
 * Verification is defence in depth: a random secret path segment AND the
 * X-Telegram-Bot-Api-Secret-Token header, compared with timingSafeEqual. IP
 * allowlisting is deliberately not relied upon.
 *
 * Returns 200 immediately and processes asynchronously: Telegram retries on any
 * non-2xx, so a slow synchronous handler would manufacture duplicate deliveries.
 */
@Controller('telegram')
export class TelegramWebhookController {
  constructor(
    private instance: InstanceService,
    private inbound: TelegramInboundService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('webhook/:secret')
  @HttpCode(200)
  async webhook(
    @Param('secret') secretPath: string,
    @Headers('x-telegram-bot-api-secret-token') headerToken: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const { webhookSecret } = await this.instance.getTelegramConfig();

    // Both the path segment and the header must match the stored secret.
    if (
      !webhookSecret ||
      !safeEqual(secretPath, webhookSecret) ||
      !safeEqual(headerToken ?? '', webhookSecret)
    ) {
      // Still 200 so a probing client learns nothing from the status code, but do
      // no work.
      return { ok: true };
    }

    // Fire-and-forget; never block the ack on processing.
    void this.inbound
      .handleUpdate(update)
      .catch(() => undefined);
    return { ok: true };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
