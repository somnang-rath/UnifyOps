import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../../common/decorators/roles.decorator';

export type GrantLevel = 'none' | 'read' | 'upload' | 'edit';

@Schema({ _id: false })
export class NoteFolderGrant {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: ['admin', 'cpo', 'marketing', 'sales', 'dev'],
    default: null,
  })
  role?: UserRole | null;

  @Prop({
    type: String,
    enum: ['none', 'read', 'upload', 'edit'],
    required: true,
  })
  level: GrantLevel;
}
export const NoteFolderGrantSchema =
  SchemaFactory.createForClass(NoteFolderGrant);

@Schema({ timestamps: true })
export class NoteFolder {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'NoteFolder', default: null, index: true })
  parentId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ type: [NoteFolderGrantSchema], default: [] })
  grants: NoteFolderGrant[];
}
export type NoteFolderDocument = HydratedDocument<NoteFolder>;
export const NoteFolderSchema = SchemaFactory.createForClass(NoteFolder);
NoteFolderSchema.index({ 'grants.userId': 1 });
NoteFolderSchema.index({ 'grants.role': 1 });
