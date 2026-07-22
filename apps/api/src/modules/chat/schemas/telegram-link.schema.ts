import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RelayDirection = 'both' | 'to-telegram' | 'from-telegram';
export type TelegramLinkDocument = HydratedDocument<TelegramLink>;

/** A per-channel bridge to one Telegram group (ADR 0007 §5). At most one per channel. */
@Schema({ timestamps: true })
export class TelegramLink {
  @Prop({
    type: Types.ObjectId,
    ref: 'ChatChannel',
    required: true,
    unique: true,
  })
  channelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', required: true, index: true })
  workspaceId: Types.ObjectId;

  /** String, not number: supergroup ids exceed 32-bit and JS numbers are lossy past 2^53. */
  @Prop({ type: String, default: null })
  chatId: string | null;

  /** Forum topic id, when the group uses topics. */
  @Prop({ type: Number, default: null })
  threadId?: number | null;

  @Prop({ default: '' })
  chatTitle: string;

  @Prop({
    enum: ['both', 'to-telegram', 'from-telegram'],
    default: 'both',
  })
  direction: RelayDirection;

  @Prop({ default: false })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  linkedBy: Types.ObjectId;

  @Prop({ type: Date, default: null })
  linkedAt?: Date | null;

  /** Short-lived code the workspace owner types as `/link <code>` in the group. */
  @Prop({ type: String, default: null })
  pendingCode?: string | null;

  @Prop({ type: Date, default: null })
  pendingCodeExpiresAt?: Date | null;

  // Health, mirroring webhook.schema.ts.
  @Prop({ type: Date, default: null })
  lastRelayAt?: Date | null;

  @Prop({ type: String, default: null })
  lastError?: string | null;

  @Prop({ default: 0 })
  consecutiveFailures: number;
}

export const TelegramLinkSchema = SchemaFactory.createForClass(TelegramLink);

// One Telegram group cannot fan into two Prism channels. This is cross-workspace
// leak prevention, not a convenience constraint (ADR 0007 §5).
TelegramLinkSchema.index(
  { chatId: 1, threadId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
TelegramLinkSchema.index({ pendingCode: 1 }, { sparse: true });
