import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ErrorSource = 'frontend' | 'backend';
export type ErrorLogType = 'error' | 'debug' | 'warning' | 'info';

@Schema({ timestamps: true })
export class ErrorLog {
  @Prop({ required: true, enum: ['frontend', 'backend'], index: true })
  source: ErrorSource;

  @Prop({ required: true, enum: ['error', 'debug', 'warning', 'info'], index: true })
  logType: ErrorLogType;

  @Prop({ index: true })
  statusCode?: number;

  @Prop({ required: true })
  errorTitle: string;

  @Prop({ required: true })
  errorMessage: string;

  @Prop()
  stackTrace?: string;

  @Prop()
  endpointUrl?: string;

  @Prop()
  pageRoute?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop({ index: true })
  userEmail?: string;

  @Prop()
  browser?: string;

  @Prop()
  operatingSystem?: string;

  @Prop()
  deviceType?: string;

  @Prop({ default: '1.0.0' })
  applicationVersion?: string;

  @Prop({ type: Object })
  requestPayload?: Record<string, unknown>;

  @Prop({ type: Object })
  responsePayload?: Record<string, unknown>;

  @Prop({ default: false, index: true })
  resolvedStatus: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop()
  resolvedAt?: Date;
}

export type ErrorLogDocument = HydratedDocument<ErrorLog>;
export const ErrorLogSchema = SchemaFactory.createForClass(ErrorLog);

ErrorLogSchema.index({ source: 1, logType: 1, createdAt: -1 });
ErrorLogSchema.index({ resolvedStatus: 1, createdAt: -1 });
ErrorLogSchema.index({ userEmail: 1, createdAt: -1 });
ErrorLogSchema.index({ statusCode: 1, createdAt: -1 });
ErrorLogSchema.index({ createdAt: -1 });
