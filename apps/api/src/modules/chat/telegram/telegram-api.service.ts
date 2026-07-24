import { Injectable, Logger } from '@nestjs/common';

/** Subset of the Telegram Bot API responses we consume. */
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  is_forum?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramChatMember {
  user: TelegramUser;
  status: string; // creator | administrator | member | ...
}

/** A typed Telegram API error, so callers can branch on 429 / 403 specifically. */
export class TelegramApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

/**
 * A thin, stateless wrapper over the Telegram Bot HTTP API. Holds no token itself —
 * the token is passed per call by the transport/relay, which reads it from
 * InstanceService — so rotating the token needs no restart and no cached secret.
 */
@Injectable()
export class TelegramApiService {
  private readonly logger = new Logger(TelegramApiService.name);

  /**
   * Bot API host. Defaults to Telegram's, but is overridable via `TELEGRAM_API_BASE`
   * — Telegram officially supports self-hosted Bot API servers, and it lets tests
   * point the relay at a local mock. No trailing slash.
   */
  private readonly base = (
    process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org'
  ).replace(/\/$/, '');

  private async call<T>(
    token: string,
    method: string,
    body?: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(
        `${this.base}/bot${token}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        result?: T;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      if (!data.ok) {
        throw new TelegramApiError(
          data.error_code ?? res.status,
          data.description ?? 'Telegram API error',
          data.parameters?.retry_after,
        );
      }
      return data.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  getMe(token: string) {
    return this.call<TelegramUser>(token, 'getMe');
  }

  /** Long-poll for updates. `timeout` is seconds Telegram holds the request open. */
  getUpdates(
    token: string,
    offset: number,
    timeout = 30,
    allowedUpdates = ['message', 'edited_message'],
  ) {
    return this.call<TelegramUpdate[]>(
      token,
      'getUpdates',
      { offset, timeout, allowed_updates: allowedUpdates },
      (timeout + 10) * 1000,
    );
  }

  setWebhook(token: string, url: string, secretToken: string) {
    return this.call<boolean>(token, 'setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'edited_message'],
    });
  }

  deleteWebhook(token: string) {
    return this.call<boolean>(token, 'deleteWebhook', { drop_pending_updates: false });
  }

  sendMessage(
    token: string,
    chatId: string,
    text: string,
    opts: { messageThreadId?: number | null } = {},
  ) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      // Relayed link-backs shouldn't unfurl into big previews in the group.
      disable_web_page_preview: true,
    };
    if (opts.messageThreadId) body.message_thread_id = opts.messageThreadId;
    return this.call<TelegramMessage>(token, 'sendMessage', body);
  }

  editMessageText(
    token: string,
    chatId: string,
    messageId: number,
    text: string,
  ) {
    return this.call<TelegramMessage | boolean>(token, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  deleteMessage(token: string, chatId: string, messageId: number) {
    return this.call<boolean>(token, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  getChatAdministrators(token: string, chatId: string) {
    return this.call<TelegramChatMember[]>(token, 'getChatAdministrators', {
      chat_id: chatId,
    });
  }
}
