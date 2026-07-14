import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InstanceDocument = HydratedDocument<Instance>;

/**
 * Singleton document describing this Prism instance (server-wide identity).
 * There is exactly one of these; the service lazily creates it on first read.
 */
@Schema({ timestamps: true })
export class Instance {
  @Prop({ required: true, unique: true, index: true })
  instanceId: string;

  @Prop({ required: true, trim: true, default: 'Prism' })
  instanceName: string;

  @Prop({ default: '0.1.0' })
  currentVersion: string;

  /** Flipped true once the first instance admin claims the instance. */
  @Prop({ default: false })
  isSetupDone: boolean;
}

export const InstanceSchema = SchemaFactory.createForClass(Instance);
