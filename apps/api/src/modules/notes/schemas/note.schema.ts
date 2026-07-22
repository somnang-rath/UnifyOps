import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NoteBlockType =
  | 'text'
  | 'heading'
  | 'check'
  | 'code'
  | 'image'
  | 'video'
  | 'divider'
  | 'table'
  | 'file';

export interface TableData {
  cols: number;
  rows: string[][];
  headerRow?: boolean;
}

@Schema({ _id: false })
class NoteBlock {
  @Prop({
    enum: [
      'text',
      'heading',
      'check',
      'code',
      'image',
      'video',
      'divider',
      'table',
      'file',
    ],
    required: true,
  })
  type: NoteBlockType;

  @Prop({ default: '' })
  value: string;

  @Prop({ default: false })
  checked: boolean;

  @Prop()
  lang?: string;

  @Prop()
  color?: string;

  @Prop({ type: Object })
  table?: TableData;

  @Prop()
  fileId?: string;

  @Prop()
  fileViewSize?: string;
}
const NoteBlockSchema = SchemaFactory.createForClass(NoteBlock);

@Schema({ timestamps: true })
export class Note {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'NoteFolder', default: null, index: true })
  folderId: Types.ObjectId | null;

  @Prop({ default: '', trim: true })
  title: string;

  @Prop({ default: '📄' })
  emoji: string;

  @Prop({ type: [NoteBlockSchema], default: [] })
  blocks: NoteBlock[];

  /**
   * HTML representation of the note (ADR 0009 §3) — the Yjs seed source and
   * the snapshot-back target. Authoritative once `migratedToDoc` is true.
   */
  @Prop({ default: '' })
  contentHTML: string;

  /**
   * One-time lazy `blocks[]` → `contentHTML` conversion done (ADR 0009 §3).
   * After this flips, `blocks[]` is retained read-only as a rollback copy.
   */
  @Prop({ default: false })
  migratedToDoc: boolean;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: false })
  pinned: boolean;
}
export type NoteDocument = HydratedDocument<Note>;
export const NoteSchema = SchemaFactory.createForClass(Note);
NoteSchema.index({ ownerId: 1, folderId: 1, updatedAt: -1 });
