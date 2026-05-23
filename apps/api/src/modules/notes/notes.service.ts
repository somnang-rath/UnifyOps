import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from './schemas/note.schema';
import {
  GrantLevel,
  NoteFolder,
  NoteFolderDocument,
} from './schemas/note-folder.schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateFolderDto,
  SaveNoteDto,
  ShareNoteFolderDto,
  UpdateNoteDto,
} from './dto/notes.dto';

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : null;

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
export class NotesService {
  constructor(
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    @InjectModel(NoteFolder.name)
    private folderModel: Model<NoteFolderDocument>,
    private users: UsersService,
    private notifs: NotificationsService,
  ) {}

  // ---------- Permission resolution ----------

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
   * Returns the viewer's own folders + folders they have any grant on (directly
   * or via their role), and the descendants of those in the owner's tree. Each
   * entry is annotated with `_access` and `_isShared`.
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

  async createFolder(
    viewer: { id: string; role: string },
    dto: CreateFolderDto,
  ) {
    if (dto.parentId) {
      const parent = await this.folderModel.findById(dto.parentId).lean();
      if (!parent) throw new NotFoundException();
      if (String(parent.ownerId) !== viewer.id)
        throw new ForbiddenException('Only the folder owner can add subfolders');
    }
    return this.folderModel.create({
      name: dto.name,
      parentId: oid(dto.parentId),
      ownerId: new Types.ObjectId(viewer.id),
      grants: [],
    });
  }

  async renameFolder(viewerId: string, id: string, name: string) {
    const f = await this.loadFolderOrThrow(id);
    if (String(f.ownerId) !== viewerId) throw new ForbiddenException();
    f.name = name;
    return f.save();
  }

  async removeFolder(viewerId: string, id: string) {
    const f = await this.loadFolderOrThrow(id);
    if (String(f.ownerId) !== viewerId) throw new ForbiddenException();

    const all = await this.folderModel
      .find({ ownerId: f.ownerId })
      .lean();
    const byParent = new Map<string, string[]>();
    all.forEach((x) => {
      const k = String(x.parentId ?? 'root');
      const arr = byParent.get(k) ?? [];
      arr.push(String(x._id));
      byParent.set(k, arr);
    });
    const ids: string[] = [String(f._id)];
    for (let i = 0; i < ids.length; i++) {
      const kids = byParent.get(ids[i]);
      if (kids) ids.push(...kids);
    }

    await this.noteModel.updateMany(
      { folderId: { $in: ids } },
      { $set: { folderId: null } },
    );
    await this.folderModel.deleteMany({ _id: { $in: ids } });
    return { ok: true };
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

  async setGrant(
    viewerId: string,
    folderId: string,
    dto: ShareNoteFolderDto,
  ) {
    const folder = await this.loadFolderOrThrow(folderId);
    if (String(folder.ownerId) !== viewerId) throw new ForbiddenException();
    if (dto.userId && dto.userId === viewerId)
      throw new ForbiddenException('Cannot share folder with yourself');

    const idx = folder.grants.findIndex((g) =>
      dto.userId
        ? g.userId && String(g.userId) === dto.userId
        : g.role === dto.role,
    );
    const prevLevel = idx >= 0 ? folder.grants[idx].level : 'none';
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

    if (
      dto.userId &&
      dto.level !== 'none' &&
      dto.level !== prevLevel
    ) {
      await this.notifs.push({
        userId: dto.userId,
        actorId: viewerId,
        type: 'note_shared',
        title: 'Folder shared with you',
        subject: `${folder.name} · ${dto.level} access`,
        link: '/notes',
        entityRef: { kind: 'note', id: String(folder._id) },
      });
    }

    return this.listGrants(viewerId, folderId);
  }

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

  // ---------- Notes ----------

  /**
   * Returns: viewer's own notes + notes whose folder the viewer has read+ access to.
   */
  async list(viewer: { id: string; role: string }) {
    const vOid = new Types.ObjectId(viewer.id);
    const folders = await this.listFolders(viewer);
    const sharedFolderIds = folders
      .filter((f: any) => f._access !== 'owner')
      .map((f: any) => new Types.ObjectId(String(f._id)));

    const filter =
      sharedFolderIds.length > 0
        ? { $or: [{ ownerId: vOid }, { folderId: { $in: sharedFolderIds } }] }
        : { ownerId: vOid };

    return this.noteModel
      .find(filter)
      .sort({ pinned: -1, updatedAt: -1 })
      .lean();
  }

  /**
   * Read access: owner, or read+ on the containing folder.
   */
  async byId(viewer: { id: string; role: string }, id: string) {
    const n = await this.noteModel.findById(id).lean();
    if (!n) throw new NotFoundException();
    if (String(n.ownerId) === viewer.id) return n;
    if (!n.folderId) throw new ForbiddenException();
    const folder = await this.folderModel.findById(n.folderId).lean();
    if (!folder) throw new ForbiddenException();
    const access = await this.resolveAccess(viewer, folder);
    if (!meets(access, 'read')) throw new ForbiddenException();
    return n;
  }

  /**
   * Mutate rule (rename/edit/move/pin):
   *  - owner of note AND (folder owner OR upload+ on folder OR root note)
   *  - OR edit+ on folder
   */
  private async canMutateNote(
    viewer: { id: string; role: string },
    n: { ownerId: any; folderId: any },
  ): Promise<boolean> {
    const isOwner = String(n.ownerId) === viewer.id;
    if (!n.folderId) return isOwner;
    const folder = await this.folderModel.findById(n.folderId).lean();
    if (!folder) return isOwner;
    const access = await this.resolveAccess(viewer, folder);
    if (access === 'owner' || access === 'edit') return true;
    if (access === 'upload' && isOwner) return true;
    return false;
  }

  async create(viewer: { id: string; role: string }, dto: SaveNoteDto) {
    if (dto.folderId) {
      const folder = await this.folderModel.findById(dto.folderId).lean();
      if (!folder) throw new NotFoundException();
      const access = await this.resolveAccess(viewer, folder);
      if (!meets(access, 'upload'))
        throw new ForbiddenException('No upload permission on this folder');
    }
    return this.noteModel.create({
      ...dto,
      folderId: oid(dto.folderId),
      ownerId: new Types.ObjectId(viewer.id),
    });
  }

  async update(
    viewer: { id: string; role: string },
    id: string,
    dto: UpdateNoteDto,
  ) {
    const n = await this.noteModel.findById(id);
    if (!n) throw new NotFoundException();
    if (!(await this.canMutateNote(viewer, n))) throw new ForbiddenException();

    if ('folderId' in dto) {
      if (dto.folderId) {
        const dest = await this.folderModel.findById(dto.folderId).lean();
        if (!dest) throw new NotFoundException('Destination folder not found');
        const destAccess = await this.resolveAccess(viewer, dest);
        if (!meets(destAccess, 'upload'))
          throw new ForbiddenException('No upload permission on destination');
      } else if (String(n.ownerId) !== viewer.id) {
        throw new ForbiddenException(
          'Only the note owner can move a note to their root',
        );
      }
      n.folderId = oid(dto.folderId);
    }
    if (dto.title !== undefined) n.title = dto.title;
    if (dto.emoji !== undefined) n.emoji = dto.emoji;
    if (dto.blocks !== undefined) n.blocks = dto.blocks as any;
    if (dto.tags !== undefined) n.tags = dto.tags;
    if (dto.pinned !== undefined) n.pinned = dto.pinned;
    return n.save();
  }

  async remove(viewer: { id: string; role: string }, id: string) {
    const n = await this.noteModel.findById(id);
    if (!n) throw new NotFoundException();
    if (!(await this.canMutateNote(viewer, n))) throw new ForbiddenException();
    await n.deleteOne();
    return { ok: true };
  }
}
