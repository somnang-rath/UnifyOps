import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type Visibility = 'private' | 'internal' | 'public';
export type ProjectDocument = HydratedDocument<Project>;

@Schema({ timestamps: true })
export class Project {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '' })
  desc: string;

  @Prop({ default: '', lowercase: true, trim: true })
  namespace: string;

  @Prop({
    enum: ['private', 'internal', 'public'],
    default: 'private',
  })
  visibility: Visibility;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members: Types.ObjectId[];

  @Prop({ default: '#6366f1' })
  color: string;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);
ProjectSchema.index({ ownerId: 1, members: 1 });
