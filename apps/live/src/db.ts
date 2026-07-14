import { Binary, MongoClient, type Collection, type Db } from 'mongodb';

/**
 * Shape of the `yjsdocuments` collection (ADR 0001 §3 — LOCKED separate
 * collection, owned by apps/live). `state` is the opaque Yjs binary blob.
 */
export interface YjsDocumentRow {
  documentName: string;
  state: Binary;
  updatedAt: Date;
}

const COLLECTION = 'yjsdocuments';

let client: MongoClient | null = null;
let collection: Collection<YjsDocumentRow> | null = null;

/**
 * Connect the live server's own Mongo client (independent of Nest) and ensure
 * the unique index on documentName.
 */
export async function connectMongo(uri: string): Promise<void> {
  client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db();
  collection = db.collection<YjsDocumentRow>(COLLECTION);
  await collection.createIndex({ documentName: 1 }, { unique: true });
}

function requireCollection(): Collection<YjsDocumentRow> {
  if (!collection) {
    throw new Error('Mongo not connected — call connectMongo() first');
  }
  return collection;
}

/**
 * Return the persisted Yjs update, or null for a brand-new doc.
 * (Database extension `fetch` contract.)
 */
export async function fetchState(
  documentName: string,
): Promise<Uint8Array | null> {
  const row = await requireCollection().findOne({ documentName });
  if (!row?.state) return null;
  // Native driver returns BSON Binary; expose the underlying bytes.
  return row.state.buffer;
}

/**
 * Upsert the full encoded state. (Database extension `store` contract.)
 */
export async function storeState(
  documentName: string,
  state: Uint8Array,
): Promise<void> {
  await requireCollection().updateOne(
    { documentName },
    { $set: { state: new Binary(state), updatedAt: new Date() } },
    { upsert: true },
  );
}

export async function closeMongo(): Promise<void> {
  await client?.close();
  client = null;
  collection = null;
}
