import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ timestamps: true })
export class Role {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  key: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: 'indigo' })
  color: string;

  @Prop({ default: false })
  builtin: boolean;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
