import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TelegramVerificationDocument =
  HydratedDocument<TelegramVerification>;

/**
 * A pending personal Telegram-account claim (attribution — ADR 0007). Holds the
 * short code a user must DM to the bot as `/verify <code>`. Keyed by the Prism
 * user because we don't yet know their Telegram id; on verify we learn it and
 * write the mapping into {@link TelegramIdentity}, then delete this row.
 */
@Schema({ timestamps: true })
export class TelegramVerification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  code: string;

  @Prop({ required: true })
  expiresAt: Date;
}

export const TelegramVerificationSchema =
  SchemaFactory.createForClass(TelegramVerification);

TelegramVerificationSchema.index({ code: 1 });
