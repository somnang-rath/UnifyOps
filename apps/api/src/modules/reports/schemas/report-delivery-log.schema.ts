import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReportDeliveryStatus = 'success' | 'failed' | 'blocked';
export type ReportDeliveryLogDocument = HydratedDocument<ReportDeliveryLog>;

/**
 * One document per recipient per run — stored in its own collection so
 * a 10,000-recipient run never hits MongoDB's 16 MB document ceiling.
 *
 * Indexed on runId so we can stream deliveries page-by-page from the
 * history UI without loading the entire run.
 */
@Schema({ timestamps: true })
export class ReportDeliveryLog {
  @Prop({ type: Types.ObjectId, ref: 'ReportRun', required: true, index: true })
  runId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ReportTemplate', required: true, index: true })
  templateId: Types.ObjectId;

  @Prop({ required: true })
  email: string;

  @Prop({ type: String, default: null })
  userId: string | null;

  @Prop({ default: 'success' })
  status: ReportDeliveryStatus;

  /** Only populated when status === 'failed'. */
  @Prop({ type: String, default: null })
  error: string | null;

  /** ISO timestamp of the send attempt (set by the service, not Mongoose). */
  @Prop({ required: true })
  sentAt: string;

  /**
   * How many rows from the external API were included in this recipient's PDF.
   * Null when per-recipient filtering is disabled.
   */
  @Prop({ type: Number, default: null })
  filteredRows: number | null;
}

export const ReportDeliveryLogSchema = SchemaFactory.createForClass(ReportDeliveryLog);

// Compound index: fast "all deliveries for this run, paginated"
ReportDeliveryLogSchema.index({ runId: 1, createdAt: -1 });
