import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InstanceConfigurationDocument =
  HydratedDocument<InstanceConfiguration>;

/**
 * Key/value instance settings edited from the admin app (God Mode).
 * Categories: auth | smtp | ai | images | general.
 * `isEncrypted` marks secrets (SMTP password, API keys) that must never be
 * returned to the client — the service masks them on read.
 */
@Schema({ timestamps: true })
export class InstanceConfiguration {
  @Prop({ required: true, unique: true, index: true, trim: true })
  key: string;

  @Prop({ type: String, default: null })
  value: string | null;

  @Prop({ default: 'general', index: true })
  category: string;

  @Prop({ default: false })
  isEncrypted: boolean;
}

export const InstanceConfigurationSchema = SchemaFactory.createForClass(
  InstanceConfiguration,
);
