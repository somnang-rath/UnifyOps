import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Automation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  trigger: string;

  @Prop({ type: Object, default: {} })
  condition: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  action: Record<string, unknown>;

  @Prop({ default: true })
  enabled: boolean;

  @Prop()
  lastFired?: Date;

  @Prop({ default: 0 })
  timesFired: number;
}
export type AutomationDocument = HydratedDocument<Automation>;
export const AutomationSchema = SchemaFactory.createForClass(Automation);

@Schema({ timestamps: true })
export class AutomationLog {
  @Prop({ type: Types.ObjectId, ref: 'Automation', required: true, index: true })
  automationId: Types.ObjectId;

  @Prop({ required: true })
  trigger: string;

  @Prop({ type: Object, default: {} })
  payload: Record<string, unknown>;

  @Prop({ default: true })
  success: boolean;

  @Prop()
  error?: string;
}
export type AutomationLogDocument = HydratedDocument<AutomationLog>;
export const AutomationLogSchema = SchemaFactory.createForClass(AutomationLog);
