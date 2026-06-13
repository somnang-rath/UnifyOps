import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BackupFrequency = 'daily' | 'weekly' | 'monthly';
export type BackupPasswordMode = 'none' | 'custom';

export const ALL_BACKUP_SCOPES = [
  'projects',
  'issues',
  'notes',
  'noteFolders',
  'wiki',
  'workbooks',
  'reports',
  'automations',
  'mrs',
] as const;

export type BackupScope = (typeof ALL_BACKUP_SCOPES)[number];

export type BackupScheduleDocument = HydratedDocument<BackupSchedule>;

@Schema({ timestamps: true })
export class BackupSchedule {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: Types.ObjectId;

  @Prop({ default: false })
  enabled: boolean;

  @Prop({ default: 'weekly' })
  frequency: BackupFrequency;

  /** HH:MM in 24-hour format, e.g. "02:00" */
  @Prop({ default: '02:00' })
  time: string;

  /** 0 = Sunday … 6 = Saturday — only used when frequency = 'weekly' */
  @Prop({ default: 0 })
  dayOfWeek: number;

  /** 1–31 — only used when frequency = 'monthly' */
  @Prop({ default: 1 })
  dayOfMonth: number;

  @Prop({ default: 'UTC' })
  timezone: string;

  @Prop({ type: [String], default: [...ALL_BACKUP_SCOPES] })
  scopes: BackupScope[];

  @Prop({ default: 'none' })
  passwordMode: BackupPasswordMode;

  @Prop({ default: 'Backup UnifyOps' })
  fileName: string;

  @Prop()
  nextRunAt?: Date;

  @Prop()
  lastRunAt?: Date;
}

export const BackupScheduleSchema = SchemaFactory.createForClass(BackupSchedule);
