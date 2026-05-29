import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReportRunStatus = 'pending' | 'generating' | 'done' | 'error';
export type ReportRunTrigger = 'manual' | 'schedule';

/**
 * @deprecated Inline delivery type kept only for backward-compat with old
 * embedded-deliveries runs.  New runs use the ReportDeliveryLog collection.
 */
export type ReportDeliveryStatus = 'success' | 'failed' | 'blocked';
export interface ReportDelivery {
  email: string;
  userId?: string;
  status: ReportDeliveryStatus;
  error?: string;
  sentAt: string;
  filteredRows?: number;
}

export type ReportRunDocument = HydratedDocument<ReportRun>;

@Schema({ timestamps: true })
export class ReportRun {
  @Prop({ type: Types.ObjectId, ref: 'ReportTemplate', required: true, index: true })
  templateId: Types.ObjectId;

  @Prop({ default: 'manual' })
  triggeredBy: ReportRunTrigger;

  @Prop({ default: 'pending' })
  status: ReportRunStatus;

  @Prop({ type: String, default: null })
  fileId: string | null;

  // ── Summary counters (written incrementally as deliveries complete) ────────

  @Prop({ default: 0 })
  totalRecipients: number;

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ default: 0 })
  failedCount: number;

  @Prop({ default: 0 })
  blockedCount: number;

  // ── Error ─────────────────────────────────────────────────────────────────

  @Prop({ type: String, default: null })
  error: string | null;

  // ── Legacy fields (backward-compat for old embedded-delivery runs) ────────

  /** @deprecated Use ReportDeliveryLog collection. */
  @Prop({ type: Object, default: [] })
  deliveries: ReportDelivery[];

  /** @deprecated */
  @Prop({ type: [Types.ObjectId], default: [] })
  sentTo: Types.ObjectId[];

  /** @deprecated */
  @Prop({ type: [String], default: [] })
  sentToEmails: string[];
}

export const ReportRunSchema = SchemaFactory.createForClass(ReportRun);
