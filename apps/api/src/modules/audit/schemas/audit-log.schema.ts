import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * Append-only record of privileged actions (docs/plan/01-security-model.md §1 S6).
 *
 * Written by AuditInterceptor for any route marked @Audit(). Nothing updates or
 * deletes these rows — "who changed the SMTP password" must survive the person
 * who changed it.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actorId: Types.ObjectId;

  // Explicit `type` on every nullable field — Mongoose cannot infer a type
  // from a `string | null` union and throws at boot if left to guess.
  @Prop({ type: String, default: null })
  actorEmail: string | null;

  /** Dot-separated action, e.g. `instance.config.update`. */
  @Prop({ required: true, index: true })
  action: string;

  /** Token audience the action was performed with — `admin` for God Mode. */
  @Prop({ type: String, default: null })
  audience: string | null;

  /** Route params/query/body with secrets stripped. */
  @Prop({ type: Object, default: {} })
  detail: Record<string, unknown>;

  @Prop({ type: String, default: null })
  ip: string | null;

  @Prop({ type: String, default: null })
  userAgent: string | null;

  /** false when the handler threw — a failed attempt is worth keeping. */
  @Prop({ default: true, index: true })
  success: boolean;

  @Prop({ type: String, default: null })
  error: string | null;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ createdAt: -1 });
