import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatAccessService } from './access/chat-access.service';
import type { MessageView } from './chat-messages.service';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

const _wsOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

/** Server-side typing throttle: one broadcast per user per channel per window. */
const TYPING_THROTTLE_MS = 3000;

/**
 * A second gateway rather than an extension of NotificationsGateway (ADR 0007 §3).
 * Notifications has one room shape and no client→server handlers; chat needs
 * dynamic per-room authorization and high-frequency typing traffic. A separate
 * namespace keeps a chat reconnect storm from taking notifications down with it.
 *
 * ⚠️ Single-replica only: without the socket.io Redis adapter, two API instances
 * means users in different processes silently stop seeing each other's messages.
 */
@WebSocketGateway({
  namespace: '/ws/chat',
  cors: {
    origin: _wsOrigins.length === 1 ? _wsOrigins[0] : _wsOrigins,
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);
  /** `${userId}:${channelId}` → last broadcast timestamp. */
  private lastTypingAt = new Map<string, number>();

  constructor(
    private jwt: JwtService,
    private cfg: ConfigService,
    private access: ChatAccessService,
  ) {}

  onModuleInit() {
    this.logger.log('Chat WS gateway ready at /ws/chat');
  }

  handleConnection(socket: Socket) {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.t as string | undefined);
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const secret = this.cfg.getOrThrow<string>('JWT_ACCESS_SECRET');
      const payload = this.jwt.verify<JwtPayload>(token, { secret });
      socket.data.userId = payload.sub;
      socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    const uid = socket.data.userId as string | undefined;
    if (!uid) return;
    for (const key of this.lastTypingAt.keys()) {
      if (key.startsWith(`${uid}:`)) this.lastTypingAt.delete(key);
    }
  }

  // ── Client → server ───────────────────────────────────────────────

  /**
   * Authorization is re-checked on every join. The client's claim about which
   * channel it may read is never trusted — a socket that guesses a channel id
   * must not be able to subscribe to it.
   */
  @SubscribeMessage('chat:join')
  async onJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId?: string },
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId || !body?.channelId) return { error: 'unauthorized' };
    try {
      await this.access.assertCanRead(userId, body.channelId);
    } catch {
      return { error: 'forbidden' };
    }
    await socket.join(`channel:${body.channelId}`);
    return { ok: true };
  }

  @SubscribeMessage('chat:leave')
  async onLeave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId?: string },
  ) {
    if (!body?.channelId) return { error: 'bad_request' };
    await socket.leave(`channel:${body.channelId}`);
    return { ok: true };
  }

  /**
   * Never persisted, and throttled server-side: a client that ignores its own
   * debounce must not be able to flood the room.
   */
  @SubscribeMessage('chat:typing')
  onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { channelId?: string; name?: string },
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId || !body?.channelId) return;
    // Room membership was proven at join time; a socket that never joined can't
    // reach the room here.
    if (!socket.rooms.has(`channel:${body.channelId}`)) return;

    const key = `${userId}:${body.channelId}`;
    const now = Date.now();
    if (now - (this.lastTypingAt.get(key) ?? 0) < TYPING_THROTTLE_MS) return;
    this.lastTypingAt.set(key, now);

    socket.to(`channel:${body.channelId}`).emit('chat:typing', {
      channelId: body.channelId,
      userId,
      name: body.name ?? '',
    });
  }

  // ── Server → client ───────────────────────────────────────────────

  emitMessage(channelId: string, message: MessageView) {
    this.server.to(`channel:${channelId}`).emit('chat:message', message);
  }

  emitMessageUpdate(channelId: string, message: MessageView) {
    this.server.to(`channel:${channelId}`).emit('chat:message:update', message);
  }

  emitMessageDelete(channelId: string, messageId: string) {
    this.server
      .to(`channel:${channelId}`)
      .emit('chat:message:delete', { channelId, messageId });
  }

  /** Unread goes to the user room, so it lands even when the channel isn't open. */
  emitUnread(
    userId: string,
    payload: {
      channelId: string;
      unreadCount: number;
      unreadMentionCount: number;
      preview: string;
    },
  ) {
    this.server.to(`user:${userId}`).emit('chat:unread', payload);
  }

  emitTelegramStatus(
    channelId: string,
    payload: { linked: boolean; active: boolean; chatTitle: string },
  ) {
    this.server
      .to(`channel:${channelId}`)
      .emit('chat:telegram:status', { channelId, ...payload });
  }
}
