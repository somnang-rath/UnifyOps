import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';
import { Readable } from 'node:stream';

export interface StoragePut {
  key: string;
}

@Injectable()
export class MongoStorage {
  private _bucket: mongo.GridFSBucket | null = null;

  constructor(@InjectConnection() private connection: Connection) {}

  private bucket(): mongo.GridFSBucket {
    if (!this._bucket) {
      const db = this.connection.db;
      if (!db) throw new Error('Mongo connection is not ready');
      this._bucket = new mongo.GridFSBucket(db, { bucketName: 'uploads' });
    }
    return this._bucket;
  }

  put(buffer: Buffer, originalName: string, mimeType?: string): Promise<StoragePut> {
    return new Promise((resolve, reject) => {
      const upload = this.bucket().openUploadStream(originalName, {
        contentType: mimeType,
      });
      upload.once('error', reject);
      upload.once('finish', () => resolve({ key: upload.id.toString() }));
      Readable.from(buffer).pipe(upload);
    });
  }

  async remove(key: string) {
    if (!key) return;
    try {
      await this.bucket().delete(new mongo.ObjectId(key));
    } catch {
      /* missing or already removed */
    }
  }

  openDownloadStream(key: string) {
    return this.bucket().openDownloadStream(new mongo.ObjectId(key));
  }

  async findOne(key: string) {
    if (!key) return null;
    let oid: mongo.ObjectId;
    try {
      oid = new mongo.ObjectId(key);
    } catch {
      return null;
    }
    const arr = await this.bucket().find({ _id: oid }).limit(1).toArray();
    return arr[0] ?? null;
  }
}
