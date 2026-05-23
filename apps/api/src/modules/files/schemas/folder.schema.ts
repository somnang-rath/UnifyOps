import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../../common/decorators/roles.decorator';

export type GrantLevel = 'none' | 'read' | 'upload' | 'edit';

/**
 * A grant targets either a specific user (userId) or a role (role) — exactly one
 * is set. Service-layer validation enforces the XOR; the schema keeps both fields
 * optional so Mongoose can roundtrip either shape.
 */
@Schema({ _id: false })
export class FolderGrant {
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
export const FolderGrantSchema = SchemaFactory.createForClass(FolderGrant);

@Schema({ timestamps: true })
export class Folder {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Folder', default: null, index: true })
  parentId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ type: [FolderGrantSchema], default: [] })
  grants: FolderGrant[];
}
export type FolderDocument = HydratedDocument<Folder>;
export const FolderSchema = SchemaFactory.createForClass(Folder);
FolderSchema.index({ 'grants.userId': 1 });
FolderSchema.index({ 'grants.role': 1 });
