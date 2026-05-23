import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FileCategory,
  FileItem,
  FileItemDocument,
} from './schemas/file.schema';
import { Folder, FolderDocument, GrantLevel } from './schemas/folder.schema';
import { MongoStorage } from './storage/mongo.storage';
import { UsersService } from '../users/users.service';
import {
  AddLinkDto,
  CreateFolderDto,
  ListFilesDto,
  ShareFolderDto,
} from './dto/files.dto';

const oid = (v?: string | null) => (v ? new Types.ObjectId(v) : null);

const inferCategory = (mime: string): FileCategory => {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (
    mime.startsWith('text/') ||
    mime.includes('document') ||
    mime.includes('msword') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation')
  )
    return 'doc';
  return 'other';
};

export type EffectiveAccess = 'owner' | 'edit' | 'upload' | 'read' | null;

const LEVEL_RANK: Record<Exclude<EffectiveAccess, null>, number> = {
  read: 1,
  upload: 2,
  edit: 3,
  owner: 4,
};

const meets = (a: EffectiveAccess, min: Exclude<EffectiveAccess, null>) =>
  a !== null && LEVEL_RANK[a] >= LEVEL_RANK[min];

@Injectable()
export class FilesService {
  constructor(
    @InjectModel(FileItem.name) private fileModel: Model<FileItemDocument>,
    @InjectModel(Folder.name) private folderModel: Model<FolderDocument>,
    private storage: MongoStorage,
    private users: UsersService,
  ) {}

  // ---------- Permission resolution ----------

  /**
   * Walk a single folder + its ancestors looking for the nearest folder that has
   * any grant matching the viewer (by user id OR by role). On the first folder
   * with matches, take the highest-ranked level among them.
   */
  private walkForGrant(
    viewer: { id: string; role: string },
    folder: any,
    byId: Map<string, any>,
  ): EffectiveAccess {
    const rank = (l: GrantLevel) => (l === 'none' ? 0 : LEVEL_RANK[l]);
    let cur = folder;
    while (cur) {
      const matching = (cur.grants || []).filter(
        (g: any) =>
          (g.userId && String(g.userId) === viewer.id) ||
          (g.role && g.role === viewer.role),
      );
      if (matching.length > 0) {
        const best = matching.reduce((a: any, b: any) =>
          rank(a.level) >= rank(b.level) ? a : b,
        );
        return best.level === 'none'
          ? null
          : (best.level as Exclude<GrantLevel, 'none'>);
      }
      if (!cur.parentId) return null;
      cur = byId.get(String(cur.parentId));
    }
    return null;
  }

  async resolveAccess(
    viewer: { id: string; role: string },
    folder: any,
  ): Promise<EffectiveAccess> {
    if (!folder) return null;
    if (String(folder.ownerId) === viewer.id) return 'owner';
    const ownerTree = await this.folderModel
      .find({ ownerId: folder.ownerId })
      .lean();
    const byId = new Map<string, any>();
    for (const f of ownerTree) byId.set(String(f._id), f);
    return this.walkForGrant(
      viewer,
      byId.get(String(folder._id)) ?? folder,
      byId,
    );
  }

  private async loadFolderOrThrow(id: string) {
    const folder = await this.folderModel.findById(id);
    if (!folder) throw new NotFoundException();
    return folder;
  }

  // ---------- Folders ----------

  /**
   * Returns the viewer's own folders + folders they have any grant on (directly or
   * via their role), and the descendants of those in the owner's tree. Each entry
   * is annotated with `_access` and `_isShared`.
   */
  async listFolders(viewer: { id: string; role: string }) {
    const vOid = new Types.ObjectId(viewer.id);

    const own = await this.folderModel
      .find({ ownerId: vOid })
      .sort({ name: 1 })
      .lean();
    const ownAnnotated = own.map((f) => ({
      ...f,
      _access: 'owner' as const,
      _isShared: false,
    }));

    const directShared = await this.folderModel
      .find({
        ownerId: { $ne: vOid },
        $or: [{ 'grants.userId': vOid }, { 'grants.role': viewer.role }],
      })
      .lean();
    if (directShared.length === 0) return ownAnnotated;

    const otherOwnerIds = [
      ...new Set(directShared.map((f) => String(f.ownerId))),
    ];
    const treesByOwner = new Map<string, any[]>();
    for (const oId of otherOwnerIds) {
      const tree = await this.folderModel
        .find({ ownerId: new Types.ObjectId(oId) })
        .lean();
      treesByOwner.set(oId, tree);
    }

    const visible = new Map<string, any>();
    for (const root of directShared) {
      const tree = treesByOwner.get(String(root.ownerId))!;
      const byId = new Map<string, any>();
      const byParent = new Map<string, any[]>();
      for (const f of tree) {
        byId.set(String(f._id), f);
        const k = String(f.parentId ?? 'root');
        const arr = byParent.get(k) ?? [];
        arr.push(f);
        byParent.set(k, arr);
      }
      const queue: any[] = [byId.get(String(root._id)) ?? root];
      while (queue.length) {
        const cur = queue.shift();
        const key = String(cur._id);
        if (visible.has(key)) continue;
        const access = this.walkForGrant(viewer, cur, byId);
        if (!access) continue;
        visible.set(key, { ...cur, _access: access, _isShared: true });
        const kids = byParent.get(key) ?? [];
        queue.push(...kids);
      }
    }

    return [...ownAnnotated, ...visible.values()];
  }

  async createFolder(viewerId: string, dto: CreateFolderDto) {
    if (dto.parentId) {
      const parent = await this.folderModel.findById(dto.parentId).lean();
      if (!parent) throw new NotFoundException();
      if (String(parent.ownerId) !== viewerId)
        throw new ForbiddenException('Only the folder owner can add subfolders');
    }
    return this.folderModel.create({
      name: dto.name,
      parentId: oid(dto.parentId),
      ownerId: new Types.ObjectId(viewerId),
      grants: [],
    });
  }

  async renameFolder(viewerId: string, id: string, name: string) {
    const folder = await this.loadFolderOrThrow(id);
    if (String(folder.ownerId) !== viewerId) throw new ForbiddenException();
    folder.name = name;
    return folder.save();
  }

  async deleteFolder(viewerId: string, id: string) {
    const folder = await this.loadFolderOrThrow(id);
    if (String(folder.ownerId) !== viewerId) throw new ForbiddenException();

    const all = await this.folderModel
      .find({ ownerId: folder.ownerId })
      .lean();
    const byParent = new Map<string, string[]>();
    all.forEach((f) => {
      const k = String(f.parentId ?? 'root');
      const arr = byParent.get(k) ?? [];
      arr.push(String(f._id));
      byParent.set(k, arr);
    });
    const ids: string[] = [String(folder._id)];
    for (let i = 0; i < ids.length; i++) {
      const kids = byParent.get(ids[i]);
      if (kids) ids.push(...kids);
    }

    const files = await this.fileModel.find({ folderId: { $in: ids } }).lean();
    await Promise.all(files.map((f) => this.storage.remove(f.storageKey)));
    await this.fileModel.deleteMany({ folderId: { $in: ids } });
    await this.folderModel.deleteMany({ _id: { $in: ids } });
    return { ok: true, removedFiles: files.length };
  }

  // ---------- Grants (sharing) ----------

  async listGrants(viewerId: string, folderId: string) {
    const folder = await this.folderModel.findById(folderId).lean();
    if (!folder) throw new NotFoundException();
    if (String(folder.ownerId) !== viewerId) throw new ForbiddenException();

    const grants = folder.grants ?? [];
    if (grants.length === 0) return [];
    const users = await this.users.list();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return grants.map((g) =>
      g.userId
        ? {
            userId: String(g.userId),
            role: null,
            level: g.level,
            user: byId.get(String(g.userId)) ?? null,
          }
        : {
            userId: null,
            role: g.role ?? null,
            level: g.level,
            user: null,
          },
    );
  }

  async setGrant(viewerId: string, folderId: string, dto: ShareFolderDto) {
    const folder = await this.loadFolderOrThrow(folderId);
    if (String(folder.ownerId) !== viewerId) throw new ForbiddenException();
    if (dto.userId && dto.userId === viewerId)
      throw new ForbiddenException('Cannot share folder with yourself');

    const idx = folder.grants.findIndex((g) =>
      dto.userId
        ? g.userId && String(g.userId) === dto.userId
        : g.role === dto.role,
    );
    if (idx >= 0) {
      folder.grants[idx].level = dto.level;
    } else if (dto.userId) {
      folder.grants.push({
        userId: new Types.ObjectId(dto.userId),
        level: dto.level,
      } as any);
    } else {
      folder.grants.push({
        role: dto.role,
        level: dto.level,
      } as any);
    }
    await folder.save();
    return this.listGrants(viewerId, folderId);
  }

  /**
   * Removes a grant. `target` is a user ObjectId (24-hex) or a role string.
   */
  async removeGrant(viewerId: string, folderId: string, target: string) {
    const folder = await this.loadFolderOrThrow(folderId);
    if (String(folder.ownerId) !== viewerId) throw new ForbiddenException();
    const isOid = /^[0-9a-fA-F]{24}$/.test(target);
    folder.grants = folder.grants.filter((g) =>
      isOid ? !(g.userId && String(g.userId) === target) : g.role !== target,
    ) as any;
    await folder.save();
    return this.listGrants(viewerId, folderId);
  }

  // ---------- Files ----------

  async listFiles(viewer: { id: string; role: string }, q: ListFilesDto) {
    // Comment attachments live as public, folder-less FileItems owned by the
    // uploader. They must not show up in the personal Storage view.
    const filter: Record<string, unknown> = { public: { $ne: true } };

    if (q.folderId) {
      const folder = await this.folderModel.findById(q.folderId).lean();
      if (!folder) throw new NotFoundException();
      const access = await this.resolveAccess(viewer, folder);
      if (!access) throw new ForbiddenException();
      filter.folderId = new Types.ObjectId(q.folderId);
    } else if (q.folderId === null) {
      filter.folderId = null;
      filter.ownerId = new Types.ObjectId(viewer.id);
    } else {
      filter.ownerId = new Types.ObjectId(viewer.id);
    }

    if (q.q) filter.name = { $regex: q.q, $options: 'i' };
    return this.fileModel.find(filter).sort({ updatedAt: -1 }).lean();
  }

  async upload(
    viewer: { id: string; role: string },
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    folderId?: string | null,
  ) {
    if (folderId) {
      const folder = await this.folderModel.findById(folderId).lean();
      if (!folder) throw new NotFoundException();
      const access = await this.resolveAccess(viewer, folder);
      if (!meets(access, 'upload'))
        throw new ForbiddenException('No upload permission on this folder');
    }
    const stored = await this.storage.put(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return this.fileModel.create({
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      category: inferCategory(file.mimetype),
      folderId: oid(folderId),
      ownerId: new Types.ObjectId(viewer.id),
      storageKey: stored.key,
    });
  }

  async uploadForComment(
    viewerId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
  ) {
    const stored = await this.storage.put(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return this.fileModel.create({
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      category: inferCategory(file.mimetype),
      folderId: null,
      ownerId: new Types.ObjectId(viewerId),
      storageKey: stored.key,
      public: true,
    });
  }

  async streamPublic(id: string) {
    const f = await this.fileModel.findById(id).lean();
    if (!f) throw new NotFoundException();
    if (!f.public) throw new ForbiddenException();
    const meta = await this.storage.findOne(f.storageKey);
    if (!meta) throw new NotFoundException('File missing in storage');
    const open = (): NodeJS.ReadableStream =>
      this.storage.openDownloadStream(f.storageKey);
    return { file: f, length: meta.length, open };
  }

  async addLink(viewer: { id: string; role: string }, dto: AddLinkDto) {
    if (dto.folderId) {
      const folder = await this.folderModel.findById(dto.folderId).lean();
      if (!folder) throw new NotFoundException();
      const access = await this.resolveAccess(viewer, folder);
      if (!meets(access, 'upload'))
        throw new ForbiddenException('No upload permission on this folder');
    }
    return this.fileModel.create({
      name: dto.name,
      url: dto.url,
      mimeType: 'text/url',
      size: 0,
      category: 'link',
      storageKey: '',
      folderId: oid(dto.folderId),
      ownerId: new Types.ObjectId(viewer.id),
    });
  }

  /**
   * File mutation rule: viewer can mutate (rename/delete/move-from) a file when
   * - they uploaded it AND have at least `upload` on its folder (or root, owner only), OR
   * - they have `edit` on its folder, OR
   * - they own the containing folder.
   */
  private async canMutateFile(
    viewer: { id: string; role: string },
    file: { ownerId: any; folderId: any },
  ): Promise<boolean> {
    const isUploader = String(file.ownerId) === viewer.id;
    if (!file.folderId) return isUploader; // root file: only uploader
    const folder = await this.folderModel.findById(file.folderId).lean();
    if (!folder) return false;
    const access = await this.resolveAccess(viewer, folder);
    if (access === 'owner' || access === 'edit') return true;
    if (access === 'upload' && isUploader) return true;
    return false;
  }

  async rename(viewer: { id: string; role: string }, id: string, name: string) {
    const f = await this.fileModel.findById(id);
    if (!f) throw new NotFoundException();
    if (!(await this.canMutateFile(viewer, f))) throw new ForbiddenException();
    f.name = name;
    return f.save();
  }

  async move(
    viewer: { id: string; role: string },
    id: string,
    folderId: string | null,
  ) {
    const f = await this.fileModel.findById(id);
    if (!f) throw new NotFoundException();
    if (!(await this.canMutateFile(viewer, f))) throw new ForbiddenException();

    if (folderId) {
      const dest = await this.folderModel.findById(folderId).lean();
      if (!dest) throw new NotFoundException('Destination folder not found');
      const destAccess = await this.resolveAccess(viewer, dest);
      if (!meets(destAccess, 'upload'))
        throw new ForbiddenException('No upload permission on destination');
    } else if (String(f.ownerId) !== viewer.id) {
      throw new ForbiddenException(
        'Only the uploader can move a file to their root',
      );
    }

    f.folderId = oid(folderId);
    return f.save();
  }

  async remove(viewer: { id: string; role: string }, id: string) {
    const f = await this.fileModel.findById(id);
    if (!f) throw new NotFoundException();
    if (!(await this.canMutateFile(viewer, f))) throw new ForbiddenException();
    if (f.storageKey) await this.storage.remove(f.storageKey);
    await f.deleteOne();
    return { ok: true };
  }

  async stream(viewer: { id: string; role: string }, id: string) {
    const f = await this.fileModel.findById(id).lean();
    if (!f) throw new NotFoundException();

    if (f.folderId) {
      const folder = await this.folderModel.findById(f.folderId).lean();
      const access = await this.resolveAccess(viewer, folder);
      if (!meets(access, 'read')) throw new ForbiddenException();
    } else if (String(f.ownerId) !== viewer.id) {
      throw new ForbiddenException();
    }

    const meta = await this.storage.findOne(f.storageKey);
    if (!meta) throw new NotFoundException('File missing in storage');
    const open = (): NodeJS.ReadableStream =>
      this.storage.openDownloadStream(f.storageKey);
    return { file: f, length: meta.length, open };
  }

  async stats(viewerId: string) {
    const r = await this.fileModel.aggregate<{
      _id: null;
      total: number;
      size: number;
    }>([
      {
        $match: {
          ownerId: new Types.ObjectId(viewerId),
          category: { $ne: 'link' },
          public: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          size: { $sum: '$size' },
        },
      },
    ]);
    const folders = await this.folderModel.countDocuments({
      ownerId: new Types.ObjectId(viewerId),
    });
    return {
      files: r[0]?.total ?? 0,
      size: r[0]?.size ?? 0,
      folders,
    };
  }
}
