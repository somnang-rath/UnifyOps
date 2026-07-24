import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TelegramIdentityDocument = HydratedDocument<TelegramIdentity>;

/**
 * Maps a Telegram user to a Prism user. `userId` stays null until the person claims
 * the identity — an unclaimed Telegram sender is a first-class case (their messages
 * are stored with `authorId: null` + `externalAuthor`), never an error, and never a
 * reason to auto-provision a Prism account.
 */
@Schema({ timestamps: true })
export class TelegramIdentity {
  @Prop({ type: String, required: true, unique: true })
  telegramUserId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  userId: Types.ObjectId | null;

  @Prop()
  username?: string;

  @Prop({ default: '' })
  firstName: string;

  @Prop({ default: '' })
  lastName: string;

  @Prop({ type: Date, default: null })
  verifiedAt?: Date | null;

  @Prop({ type: String, default: null })
  verificationCode?: string | null;

  @Prop({ type: Date, default: null })
  verificationCodeExpiresAt?: Date | null;
}

export const TelegramIdentitySchema =
  SchemaFactory.createForClass(TelegramIdentity);

TelegramIdentitySchema.index({ verificationCode: 1 }, { sparse: true });
