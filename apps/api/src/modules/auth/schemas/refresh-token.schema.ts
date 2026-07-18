import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AUD_WEB, type RestAudience } from '../../../common/auth/audience';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

/**
 * One row per issued refresh token. Tokens are chained into a *family*: a login
 * starts a family, each rotation appends to it. Presenting a token that was
 * already rotated (outside the grace window) means the token leaked, so the
 * whole family is revoked. See docs/plan/01-security-model.md §3.1.
 */
@Schema({ timestamps: true })
export class RefreshToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  tokenHash: string;

  /** Groups every rotation of one login together, so reuse can revoke the lot. */
  @Prop({ required: true, index: true })
  familyId: string;

  /** Which app this session belongs to — `web` and `admin` are separate sessions. */
  @Prop({ type: String, required: true, default: AUD_WEB })
  audience: RestAudience;

  /** Set the moment this token is rotated away; presence marks it spent. */
  @Prop({ type: Date, default: null })
  usedAt: Date | null;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: false })
  revoked: boolean;

  // --- Session metadata, surfaced by GET /auth/sessions ---

  // `type` is explicit on every nullable field: Mongoose infers the type from
  // TS metadata, and a `string | null` union gives it nothing to infer from —
  // it throws CannotDetermineTypeError at boot, which compilation cannot catch.
  @Prop({ type: String, default: null })
  ip: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  @Prop({ type: Date, default: Date.now })
  lastUsedAt: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshTokenSchema.index({ userId: 1, audience: 1 });
