import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const NOTIF_TYPES = [
  'issue',
  'mr',
  'mention',
  'done',
  'issue_assigned',
  'issue_status',
  'issue_commented',
  'mr_review',
  'mr_decided',
  'mr_commented',
  'wiki_mention',
  'note_shared',
  'project_member',
  'due_soon',
  /** The weekly AI digest (ADR 0015 §2.6). */
  'digest',
] as const;
export type NotifType = (typeof NOTIF_TYPES)[number];

export type EntityKind =
  | 'issue'
  | 'mr'
  | 'comment'
  | 'project'
  | 'wiki'
  | 'note';

@Schema({ _id: false })
class EntityRef {
  @Prop({
    enum: ['issue', 'mr', 'comment', 'project', 'wiki', 'note'],
    required: true,
  })
  kind: EntityKind;

  @Prop({ type: Types.ObjectId, required: true })
  id: Types.ObjectId;
}
const EntityRefSchema = SchemaFactory.createForClass(EntityRef);

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  actorId?: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  actorIds: Types.ObjectId[];

  @Prop({ default: 1 })
  count: number;

  @Prop({ enum: NOTIF_TYPES, required: true })
  type: NotifType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  subject: string;

  @Prop()
  link?: string;

  @Prop({ type: EntityRefSchema })
  entityRef?: EntityRef;

  @Prop({ default: false, index: true })
  read: boolean;
}
export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
