import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  name: string;

  // Role is validated against the Role collection in the service layer so
  // admins can add custom roles at runtime.
  @Prop({ required: true, lowercase: true, trim: true, default: 'dev' })
  role: string;

  @Prop({ default: false, index: true })
  blocked: boolean;

  @Prop()
  avatar?: string;

  @Prop({
    type: String,
    enum: ['male', 'female', 'other', null],
    default: null,
  })
  gender?: 'male' | 'female' | 'other' | null;

  @Prop({ type: Date, default: null })
  dateOfBirth?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  nationality?: string | null;

  @Prop({ type: String, trim: true, default: null })
  jobTitle?: string | null;

  @Prop({ type: String, trim: true, default: null })
  department?: string | null;

  @Prop({
    type: String,
    enum: ['full-time', 'part-time', 'contract', null],
    default: null,
  })
  employmentType?: 'full-time' | 'part-time' | 'contract' | null;

  @Prop({ default: 'indigo' })
  accent: string;

  @Prop({ enum: ['dark', 'light'], default: 'dark' })
  theme: 'dark' | 'light';

  // Compact is the product default (docs/plan/02-design-system.md §2.4).
  // Existing rows keep whatever the user already chose.
  @Prop({ enum: ['comfy', 'compact'], default: 'compact' })
  density: 'comfy' | 'compact';

  /**
   * UI language (ADR 0016 §2.1). The *cross-device default*, not the answer for
   * a given request — the `pr_locale` cookie wins there, and this is what a
   * fresh browser falls back to. English default so existing rows are unchanged.
   */
  @Prop({ enum: ['en', 'km'], default: 'en' })
  locale: 'en' | 'km';

  @Prop({ type: Object, default: {} })
  notifPrefs?: Record<string, { inApp?: boolean; email?: boolean }>;

  @Prop({ type: String, default: null })
  twoFactorPending?: string | null;

  @Prop({ type: String, default: null })
  twoFactorSecret?: string | null;

  @Prop({ default: false })
  twoFactorEnabled: boolean;

  @Prop({ type: [String], default: [], select: false })
  twoFactorRecoveryCodes: string[];

  @Prop({ default: false, index: true })
  invitePending: boolean;

  @Prop({ type: String, default: null, index: true, sparse: true })
  inviteToken?: string | null;

  @Prop({ type: Date, default: null })
  inviteTokenExpiry?: Date | null;

  // OAuth provider ids (ADR 0008 §5). Uniqueness is enforced by the partial
  // indexes below, restricted to string values: a plain unique+sparse index
  // still indexes explicit nulls, and `default: null` would make every
  // password-registered user collide on the second insert.
  @Prop({ type: String, default: null })
  googleId?: string | null;

  @Prop({ type: String, default: null })
  githubId?: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
);
UserSchema.index(
  { githubId: 1 },
  { unique: true, partialFilterExpression: { githubId: { $type: 'string' } } },
);
