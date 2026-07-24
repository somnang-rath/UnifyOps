import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageKind = 'user' | 'system';
export type MessageSource = 'prism' | 'telegram';
export type ChatMessageDocument = HydratedDocument<ChatMessage>;

/** Identity of a Telegram sender who has no linked Prism account. */
@Schema({ _id: false })
class ExternalAuthor {
  @Prop({ required: true })
  name: string;

  @Prop()
  username?: string;

  @Prop({ required: true })
  telegramUserId: string;
}
const ExternalAuthorSchema = SchemaFactory.createForClass(ExternalAuthor);

@Schema({ _id: false })
class MessageAttachment {
  @Prop({ type: Types.ObjectId, ref: 'File', required: true })
  fileId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  mime: string;

  @Prop({ default: 0 })
  size: number;
}
const MessageAttachmentSchema = SchemaFactory.createForClass(MessageAttachment);

@Schema({ _id: false })
class MessageReaction {
  @Prop({ required: true })
  emoji: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  userIds: Types.ObjectId[];
}
const MessageReactionSchema = SchemaFactory.createForClass(MessageReaction);

/** Where an inbound Telegram message came from. */
@Schema({ _id: false })
class TelegramOrigin {
  @Prop({ required: true })
  chatId: string;

  @Prop({ required: true })
  messageId: number;

  @Prop()
  fromId?: string;

  @Prop()
  fromUsername?: string;

  @Prop()
  updateId?: number;
}
const TelegramOriginSchema = SchemaFactory.createForClass(TelegramOrigin);

/** Receipt for a message we relayed out, so edits and deletes can follow it. */
@Schema({ _id: false })
class RelayReceipt {
  @Prop({ required: true })
  chatId: string;

  @Prop({ required: true })
  messageId: number;

  @Prop({ default: () => new Date() })
  sentAt: Date;
}
const RelayReceiptSchema = SchemaFactory.createForClass(RelayReceipt);

@Schema({ timestamps: true })
export class ChatMessage {
  @Prop({
    type: Types.ObjectId,
    ref: 'ChatChannel',
    required: true,
    index: true,
  })
  channelId: Types.ObjectId;

  /** Denormalized from the channel so no read path needs a join to be workspace-scoped. */
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true })
  workspaceId: Types.ObjectId;

  /** Null for a Telegram sender with no linked Prism account — see `externalAuthor`. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  authorId: Types.ObjectId | null;

  @Prop({ type: ExternalAuthorSchema })
  externalAuthor?: ExternalAuthor;

  /**
   * Markdown subset (ADR 0007 §4) — bold/italic/code/link/mention. Round-trips to
   * Telegram. Not `required`: a soft-deleted message blanks its body, and an
   * attachment-only message has none. Non-emptiness is enforced at the API
   * boundary by SendMessageSchema instead.
   */
  @Prop({ default: '' })
  body: string;

  @Prop({ enum: ['user', 'system'], default: 'user' })
  kind: MessageKind;

  /**
   * The structural anti-echo discriminator (ADR 0007 §6). The outbound relay's
   * query filter IS `source: 'prism'`, so a Telegram-origin message cannot match it.
   */
  @Prop({ enum: ['prism', 'telegram'], default: 'prism', index: true })
  source: MessageSource;

  /** Client-generated uuid: optimistic-UI reconciliation and POST retry idempotency. */
  @Prop({ type: String })
  clientId?: string;

  @Prop({ type: [MessageAttachmentSchema], default: [] })
  attachments: MessageAttachment[];

  @Prop({ type: [MessageReactionSchema], default: [] })
  reactions: MessageReaction[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  mentions: Types.ObjectId[];

  /** Stored in v1 and rendered as a quote; thread panes are deferred. */
  @Prop({ type: Types.ObjectId, ref: 'ChatMessage' })
  replyToId?: Types.ObjectId;

  @Prop()
  editedAt?: Date;

  /** Soft delete — a relayed message must stay resolvable to relay its own deletion. */
  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;

  @Prop({ type: TelegramOriginSchema })
  telegram?: TelegramOrigin;

  @Prop({ type: [RelayReceiptSchema], default: [] })
  relayedTo: RelayReceipt[];
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

// The pagination index. Cursor on `_id`, not `createdAt`: ObjectId is monotonic,
// so `_id < cursor` is a correct "older than" with no tie-break problem when two
// messages share a timestamp.
ChatMessageSchema.index({ channelId: 1, _id: -1 });
ChatMessageSchema.index({ workspaceId: 1, createdAt: -1 });
// Inbound dedupe is enforced by this index, not by application logic: insert,
// catch E11000, drop. Telegram retries deliver the same message more than once.
ChatMessageSchema.index(
  { 'telegram.chatId': 1, 'telegram.messageId': 1 },
  { unique: true, sparse: true },
);
// Partial, NOT sparse: channelId is always present, so a sparse compound index
// would index every message and make two clientId-less messages in one channel
// collide on (channelId, null). Restrict uniqueness to messages that actually
// carry a clientId (optimistic-send idempotency).
ChatMessageSchema.index(
  { channelId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);
ChatMessageSchema.index({ channelId: 1, mentions: 1 }, { sparse: true });
