import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Raw Yjs CRDT state for a collaborative document (Phase 2 — wiki only).
 *
 * Per ADR 0001 §3 this is a SEPARATE collection (`yjsdocuments`) owned by the
 * live server (`apps/live`), which reads/writes it directly via
 * `@hocuspocus/extension-database` using its own Mongo connection:
 *   fetch  → `YjsDocument.findOne({ documentName }).state`  (Buffer | null)
 *   store  → upsert `{ state, updatedAt }`
 *
 * The API does NOT own the read/write path (there is no service/controller for
 * it). The schema is declared here only so the API's Mongoose connection
 * manages the collection + its unique index, keeping the contract in one place.
 * The Yjs binary is intentionally opaque to the API — do NOT put it on WikiPage.
 */
@Schema({ collection: 'yjsdocuments', timestamps: false })
export class YjsDocument {
  // e.g. "wiki:665f1a2b3c4d5e6f7a8b9c0d" — see ADR §2 documentName grammar.
  @Prop({ required: true, unique: true, index: true })
  documentName: string;

  // Y.encodeStateAsUpdate() blob. `Buffer` maps to BSON binary.
  @Prop({ type: Buffer, required: true })
  state: Buffer;

  // Touched on every store; not managed by Mongoose timestamps because the live
  // server sets it explicitly on upsert.
  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type YjsDocumentDocument = HydratedDocument<YjsDocument>;
export const YjsDocumentSchema = SchemaFactory.createForClass(YjsDocument);
YjsDocumentSchema.index({ documentName: 1 }, { unique: true });
