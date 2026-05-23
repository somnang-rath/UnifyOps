import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FileCategory = 'image' | 'pdf' | 'doc' | 'link' | 'other';

@Schema({ timestamps: true })
export class FileItem {
  @Prop({ required: true, trim: true }) name: string;
  @Prop({ required: true })              storageKey: string;
  @Prop({ required: true })              mimeType: string;
  @Prop({ required: true })              size: number;

  @Prop({
    enum: ['image', 'pdf', 'doc', 'link', 'other'],
    default: 'other',
  })
  category: FileCategory;

  @Prop({ type: Types.ObjectId, ref: 'Folder', default: null, index: true })
  folderId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop()
  url?: string;

  // Readable by any viewer via /files/public/:id — used for comment attachments
  // that need to be served to <img> tags without an Authorization header.
  @Prop({ default: false, index: true })
  public: boolean;
}
export type FileItemDocument = HydratedDocument<FileItem>;
export const FileItemSchema = SchemaFactory.createForClass(FileItem);
FileItemSchema.index({ ownerId: 1, folderId: 1 });
