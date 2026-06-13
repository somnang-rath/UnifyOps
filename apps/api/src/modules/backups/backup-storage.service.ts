import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { mongo } from 'mongoose';
import { Readable } from 'node:stream';
import { BackupFile, BackupFileDocument } from './schemas/backup-file.schema';
import type { BackupScope } from './schemas/backup-schedule.schema';
import type { BackupTriggeredBy } from './schemas/backup-file.schema';

const BACKUP_BUCKET = 'backups';
const MAX_STORED_PER_USER = 10;
const EXPIRE_DAYS = 30;

export interface StoreBackupInput {
  userId:      string;
  fileName:    string;
  scopes:      BackupScope[];
  triggeredBy: BackupTriggeredBy;
  encrypted:   boolean;
  buffer:      Buffer;
}

@Injectable()
export class BackupStorageService {
  private readonly log = new Logger(BackupStorageService.name);
  private _bucket: mongo.GridFSBucket | null = null;

  constructor(
    @InjectModel(BackupFile.name) private fileModel: Model<BackupFileDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  private bucket(): mongo.GridFSBucket {
    if (!this._bucket) {
      const db = this.connection.db;
      if (!db) throw new Error('Mongo connection not ready');
      this._bucket = new mongo.GridFSBucket(db, { bucketName: BACKUP_BUCKET });
    }
    return this._bucket;
  }

  async store(input: StoreBackupInput): Promise<BackupFileDocument> {
    const userId = new Types.ObjectId(input.userId);

    // Create a metadata record in 'generating' state first
    const expiresAt = new Date(Date.now() + EXPIRE_DAYS * 86_400_000);
    const record = await this.fileModel.create({
      userId,
      fileName:    input.fileName,
      scopes:      input.scopes,
      triggeredBy: input.triggeredBy,
      encrypted:   input.encrypted,
      status:      'generating',
      size:        0,
      expiresAt,
    });

    try {
      // Upload buffer to GridFS
      const gridfsId = await this.uploadToGridFS(input.buffer, input.fileName);

      await this.fileModel.updateOne(
        { _id: record._id },
        { status: 'ready', size: input.buffer.length, gridfsId },
      );
      record.status  = 'ready';
      record.size    = input.buffer.length;
      record.gridfsId = gridfsId;

      // Enforce per-user cap — delete oldest beyond MAX_STORED_PER_USER
      await this.trimOldest(input.userId);

      return record;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.fileModel.updateOne({ _id: record._id }, { status: 'failed', error: msg });
      throw err;
    }
  }

  private uploadToGridFS(buffer: Buffer, fileName: string): Promise<Types.ObjectId> {
    return new Promise((resolve, reject) => {
      const upload = this.bucket().openUploadStream(fileName, {
        contentType: 'application/octet-stream',
      });
      upload.once('error', reject);
      upload.once('finish', () => resolve(upload.id as Types.ObjectId));
      Readable.from(buffer).pipe(upload);
    });
  }

  /** Stream a stored backup file to the caller. Enforces ownership. */
  openDownloadStream(fileId: string, requestingUserId: string) {
    return this.fileModel.findById(fileId).lean().then((record) => {
      if (!record) throw new NotFoundException('Backup file not found');
      if (String(record.userId) !== requestingUserId) throw new ForbiddenException();
      if (!record.gridfsId) throw new NotFoundException('Backup content missing');
      return this.bucket().openDownloadStream(new mongo.ObjectId(String(record.gridfsId)));
    });
  }

  async list(userId: string): Promise<BackupFileDocument[]> {
    return this.fileModel
      .find({ userId: new Types.ObjectId(userId), status: { $ne: 'failed' } })
      .sort({ createdAt: -1 })
      .lean() as unknown as BackupFileDocument[];
  }

  async remove(fileId: string, requestingUserId: string): Promise<void> {
    const record = await this.fileModel.findById(fileId).lean();
    if (!record) throw new NotFoundException('Backup file not found');
    if (String(record.userId) !== requestingUserId) throw new ForbiddenException();

    if (record.gridfsId) {
      try {
        await this.bucket().delete(new mongo.ObjectId(String(record.gridfsId)));
      } catch {
        /* already gone */
      }
    }
    await this.fileModel.deleteOne({ _id: record._id });
  }

  private async trimOldest(userId: string): Promise<void> {
    const all = await this.fileModel
      .find({ userId: new Types.ObjectId(userId), status: 'ready' })
      .sort({ createdAt: 1 })
      .lean();

    if (all.length <= MAX_STORED_PER_USER) return;

    const toDelete = all.slice(0, all.length - MAX_STORED_PER_USER);
    for (const rec of toDelete) {
      if (rec.gridfsId) {
        try {
          await this.bucket().delete(new mongo.ObjectId(String(rec.gridfsId)));
        } catch {
          /* ignore */
        }
      }
      await this.fileModel.deleteOne({ _id: rec._id });
      this.log.log(`Trimmed old backup ${String(rec._id)} for user ${userId}`);
    }
  }
}
