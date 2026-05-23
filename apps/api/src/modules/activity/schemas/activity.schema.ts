import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Activity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', index: true })
  projectId?: Types.ObjectId;

  @Prop({ required: true })
  entityType: string; // 'issue' | 'project' | 'mr' | 'note' | …

  @Prop({ required: true })
  entityId: string;

  @Prop({ required: true })
  action: string; // 'created' | 'updated' | 'commented' | 'closed' | …

  @Prop({ required: true })
  title: string;

  @Prop({ type: Object, default: {} })
  meta: Record<string, unknown>;
}
export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ projectId: 1, createdAt: -1 });
