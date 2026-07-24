import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InstanceAdminDocument = HydratedDocument<InstanceAdmin>;

/**
 * Server-wide instance administrators. Deliberately SEPARATE from workspace
 * roles (User.role) — instance admin governs the whole deployment, not a
 * single workspace (see PLANE-CONVERSION-PLAN.md pitfall #6).
 */
@Schema({ timestamps: true })
export class InstanceAdmin {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({ default: 'admin' })
  role: string;
}

export const InstanceAdminSchema = SchemaFactory.createForClass(InstanceAdmin);
