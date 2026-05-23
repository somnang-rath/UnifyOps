import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ApiTokenDocument = HydratedDocument<ApiToken>;

@Schema({ timestamps: true })
export class ApiToken {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true, maxlength: 60 })
  name: string;

  @Prop({ required: true, unique: true, index: true, select: false })
  tokenHash: string;

  @Prop({ required: true, maxlength: 16 })
  prefix: string;

  @Prop({ type: Date, default: null })
  lastUsedAt?: Date | null;

  @Prop({ type: Date, default: null })
  expiresAt?: Date | null;
}

export const ApiTokenSchema = SchemaFactory.createForClass(ApiToken);
