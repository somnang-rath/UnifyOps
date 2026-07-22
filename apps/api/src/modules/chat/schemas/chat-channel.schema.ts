import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChannelKind = 'channel' | 'dm';
export type ChannelVisibility = 'public' | 'private';
export type ChatChannelDocument = HydratedDocument<ChatChannel>;

/**
 * Channels and DMs share one collection, discriminated by `kind` (ADR 0007).
 * One collection means one message model, one gateway room type, and one
 * read-state model; group DMs then cost nothing to add.
 */
@Schema({ timestamps: true })
export class ChatChannel {
  /** The tenant boundary. Every read and write is scoped by this (ADR 0003-0006). */
  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  @Prop({ enum: ['channel', 'dm'], default: 'channel' })
  kind: ChannelKind;

  /** Channels only — a DM's display name is derived from its participants at read time. */
  @Prop({ trim: true, default: '' })
  name: string;

  @Prop({ lowercase: true, trim: true })
  slug?: string;

  @Prop({ default: '' })
  topic: string;

  /** `public` = any workspace member may read and join. `private` = memberIds is the access list. */
  @Prop({ enum: ['public', 'private'], default: 'public' })
  visibility: ChannelVisibility;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ default: false, index: true })
  archived: boolean;

  /**
   * DM: exactly the participants. Private channel: the access list.
   * Public channel: who has joined — for the sidebar and fan-out, NOT an access gate.
   */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  memberIds: Types.ObjectId[];

  /**
   * `${workspaceId}:${sortedUserIds.join('|')}` for DMs only. The unique index on
   * this is what makes find-or-create race-safe when both users open the DM at once.
   */
  @Prop({ type: String })
  dmKey?: string;

  @Prop({ type: Date, default: () => new Date() })
  lastMessageAt: Date;

  /** Denormalized so the channel list doesn't N+1 into messages. */
  @Prop({ default: '', maxlength: 140 })
  lastMessagePreview: string;

  @Prop({ default: 0 })
  messageCount: number;
}

export const ChatChannelSchema = SchemaFactory.createForClass(ChatChannel);

ChatChannelSchema.index({ workspaceId: 1, kind: 1, archived: 1 });
ChatChannelSchema.index(
  { workspaceId: 1, slug: 1 },
  { unique: true, partialFilterExpression: { kind: 'channel' } },
);
ChatChannelSchema.index({ dmKey: 1 }, { unique: true, sparse: true });
// "my channels, newest first" in a single index scan.
ChatChannelSchema.index({ memberIds: 1, lastMessageAt: -1 });
