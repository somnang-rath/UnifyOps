import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type { NotificationDocument } from './schemas/notification.schema';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

const _wsOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

@WebSocketGateway({
  namespace: '/ws/notifications',
  cors: {
    origin: _wsOrigins.length === 1 ? _wsOrigins[0] : _wsOrigins,
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private jwt: JwtService,
    private cfg: ConfigService,
  ) {}

  onModuleInit() {
    this.logger.log('Notifications WS gateway ready at /ws/notifications');
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

  handleDisconnect() {
    // socket.io cleans rooms automatically
  }

  emitNew(userId: string, notif: NotificationDocument) {
    const ts = notif as unknown as { createdAt?: Date; updatedAt?: Date };
    this.server.to(`user:${userId}`).emit('notif:new', {
      _id: String(notif._id),
      type: notif.type,
      title: notif.title,
      subject: notif.subject,
      link: notif.link,
      read: notif.read,
      count: notif.count ?? 1,
      actorId: notif.actorId ? String(notif.actorId) : undefined,
      actorIds: (notif.actorIds ?? []).map((id) => String(id)),
      entityRef: notif.entityRef
        ? {
            kind: notif.entityRef.kind,
            id: String(notif.entityRef.id),
          }
        : undefined,
      createdAt:
        ts.createdAt?.toISOString() ?? new Date().toISOString(),
      updatedAt: ts.updatedAt?.toISOString(),
    });
  }
}
