import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { BackupScope } from './backup-schedule.schema';

export type BackupFileStatus = 'generating' | 'ready' | 'failed';
export type BackupTriggeredBy = 'manual' | 'schedule';

export type BackupFileDocument = HydratedDocument<BackupFile>;

@Schema({ timestamps: true })
export class BackupFile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  fileName: string;

  /** Compressed size in bytes */
  @Prop({ default: 0 })
  size: number;

  @Prop({ type: [String], default: [] })
  scopes: BackupScope[];

  @Prop({ default: 'manual' })
  triggeredBy: BackupTriggeredBy;

  @Prop({ default: 'generating' })
  status: BackupFileStatus;

  @Prop()
  error?: string;

  /** GridFS file id in the 'backups' bucket */
  @Prop({ type: Types.ObjectId })
  gridfsId?: Types.ObjectId;

  @Prop({ default: false })
  encrypted: boolean;

  /** Auto-deleted by MongoDB TTL index after 30 days */
  @Prop({ required: true })
  expiresAt: Date;
}

export const BackupFileSchema = SchemaFactory.createForClass(BackupFile);

// TTL index — MongoDB removes expired documents automatically
BackupFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
