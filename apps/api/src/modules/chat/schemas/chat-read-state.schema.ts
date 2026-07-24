import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChatReadStateDocument = HydratedDocument<ChatReadState>;

/**
 * One document per (user, channel). Deliberately its own collection rather than a
 * subdocument on the channel: it is written for every member on every message, and
 * that write volume must not contend with the channel document.
 */
@Schema({ timestamps: true })
export class ChatReadState {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ChatChannel', required: true })
  channelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true })
  workspaceId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ChatMessage', default: null })
  lastReadMessageId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  lastReadAt?: Date | null;

  @Prop({ default: 0 })
  unreadCount: number;

  @Prop({ default: 0 })
  unreadMentionCount: number;

  @Prop({ default: false })
  muted: boolean;
}

export const ChatReadStateSchema = SchemaFactory.createForClass(ChatReadState);

ChatReadStateSchema.index({ userId: 1, channelId: 1 }, { unique: true });
ChatReadStateSchema.index({ userId: 1, unreadCount: -1 });
