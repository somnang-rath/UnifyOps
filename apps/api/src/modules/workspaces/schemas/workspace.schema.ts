import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkspaceDocument = HydratedDocument<Workspace>;

/**
 * A workspace — the top-level tenant container an instance admin manages.
 * Deliberately separate from Project (a workspace groups projects/members).
 * Projects are not yet linked to a workspace; that migration is a follow-up.
 */
@Schema({ timestamps: true })
export class Workspace {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  slug: string;

  @Prop({ default: '' })
  desc: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members: Types.ObjectId[];

  @Prop({ default: '#6366f1' })
  color: string;
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);
