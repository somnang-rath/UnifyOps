/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { gunzipSync } from 'node:zlib';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { NoteFolder, NoteFolderDocument } from '../notes/schemas/note-folder.schema';
import { WikiPage, WikiPageDocument } from '../wiki/schemas/wiki-page.schema';
import { Workbook, WorkbookDocument } from '../workbooks/schemas/workbook.schema';
import { MergeRequest, MergeRequestDocument } from '../mrs/schemas/mr.schema';
import { Automation, AutomationDocument } from '../automations/schemas/automation.schema';
import { ReportTemplate, ReportTemplateDocument } from '../reports/schemas/report-template.schema';
import { BackupCryptoService } from './backup-crypto.service';
import type { BackupPayload, ImportOptionsDto, ImportResult } from './dto/backup.dto';
import type { BackupScope } from './schemas/backup-schedule.schema';

type Doc = Record<string, unknown>;

function remap(idMap: Map<string, Types.ObjectId>, oldId: unknown): Types.ObjectId | null {
  if (!oldId) return null;
  return idMap.get(String(oldId)) ?? null;
}

function prepare(doc: Doc, ownerId: Types.ObjectId, idMap: Map<string, Types.ObjectId>): Doc {
  const { _oid, _id: _removed, __v, ...rest } = doc;
  void _removed; void __v;
  const newId = new Types.ObjectId();
  if (_oid) idMap.set(String(_oid), newId);
  return { _id: newId, ownerId, ...rest };
}

type AnyModel = Model<any>;

@Injectable()
export class BackupImportService {
  constructor(
    @InjectModel(Project.name)        private projectModel:  Model<ProjectDocument>,
    @InjectModel(Issue.name)          private issueModel:    Model<IssueDocument>,
    @InjectModel(Note.name)           private noteModel:     Model<NoteDocument>,
    @InjectModel(NoteFolder.name)     private folderModel:   Model<NoteFolderDocument>,
    @InjectModel(WikiPage.name)       private wikiModel:     Model<WikiPageDocument>,
    @InjectModel(Workbook.name)       private workbookModel: Model<WorkbookDocument>,
    @InjectModel(MergeRequest.name)   private mrModel:       Model<MergeRequestDocument>,
    @InjectModel(Automation.name)     private autoModel:     Model<AutomationDocument>,
    @InjectModel(ReportTemplate.name) private reportModel:   Model<ReportTemplateDocument>,
    private cryptoSvc: BackupCryptoService,
  ) {}

  // ── Parse ─────────────────────────────────────────────────────────────────

  parseBuffer(buffer: Buffer): BackupPayload {
    let json: string;
    try {
      json = gunzipSync(buffer).toString('utf8');
    } catch {
      json = buffer.toString('utf8');
    }
    try {
      return JSON.parse(json) as BackupPayload;
    } catch {
      throw new BadRequestException('Invalid backup file format');
    }
  }

  decryptData(payload: BackupPayload, password?: string | null): Record<string, Doc[]> {
    if (!payload.meta.encrypted) {
      return payload.data as Record<string, Doc[]>;
    }
    if (!password) throw new BadRequestException('This backup is password-protected');
    if (!payload.meta.iv || !payload.meta.salt) {
      throw new BadRequestException('Corrupt encrypted backup: missing iv/salt');
    }
    const decrypted = this.cryptoSvc.decrypt(
      { iv: payload.meta.iv, salt: payload.meta.salt, ciphertext: payload.data as string },
      password,
    );
    try {
      return JSON.parse(gunzipSync(decrypted).toString('utf8')) as Record<string, Doc[]>;
    } catch {
      return JSON.parse(decrypted.toString('utf8')) as Record<string, Doc[]>;
    }
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  async importForUser(userId: string, buffer: Buffer, opts: ImportOptionsDto): Promise<ImportResult> {
    const payload = this.parseBuffer(buffer);
    const rawData = this.decryptData(payload, opts.password);
    const ownerId = new Types.ObjectId(userId);
    const idMap   = new Map<string, Types.ObjectId>();

    const available = Object.keys(rawData) as BackupScope[];
    const scopes: BackupScope[] = opts.scopes
      ? available.filter((s) => opts.scopes!.includes(s))
      : available;

    const result: ImportResult = { inserted: {}, skipped: {} };

    if (opts.strategy === 'replace') {
      await this.deleteScopes(ownerId, scopes);
    }

    // Pass 1 — parents
    if (scopes.includes('projects') && rawData.projects?.length) {
      const r = await this.importProjects(rawData.projects, ownerId, idMap, opts.strategy);
      result.inserted.projects = r.inserted;
      result.skipped.projects  = r.skipped;
    }
    if (scopes.includes('noteFolders') && rawData.noteFolders?.length) {
      const r = await this.importFolders(rawData.noteFolders, ownerId, idMap, opts.strategy);
      result.inserted.noteFolders = r.inserted;
      result.skipped.noteFolders  = r.skipped;
    }

    // Pass 2 — children
    const pass2: Array<{ scope: BackupScope; model: AnyModel; dedup: 'name' | 'titleProject' | 'noteTitle' }> = [
      { scope: 'issues',      model: this.issueModel    as AnyModel, dedup: 'titleProject' },
      { scope: 'notes',       model: this.noteModel     as AnyModel, dedup: 'noteTitle'    },
      { scope: 'wiki',        model: this.wikiModel     as AnyModel, dedup: 'name'         },
      { scope: 'workbooks',   model: this.workbookModel as AnyModel, dedup: 'name'         },
      { scope: 'mrs',         model: this.mrModel       as AnyModel, dedup: 'titleProject' },
      { scope: 'automations', model: this.autoModel     as AnyModel, dedup: 'name'         },
      { scope: 'reports',     model: this.reportModel   as AnyModel, dedup: 'name'         },
    ];

    for (const { scope, model, dedup } of pass2) {
      if (!scopes.includes(scope) || !rawData[scope]?.length) continue;
      const r = await this.importGeneric(model, rawData[scope], ownerId, idMap, opts.strategy, dedup);
      result.inserted[scope] = r.inserted;
      result.skipped[scope]  = r.skipped;
    }

    return result;
  }

  // ── Delete (replace strategy) ─────────────────────────────────────────────

  private async deleteScopes(ownerId: Types.ObjectId, scopes: BackupScope[]): Promise<void> {
    const modelMap: Partial<Record<BackupScope, AnyModel>> = {
      projects:    this.projectModel  as AnyModel,
      issues:      this.issueModel    as AnyModel,
      notes:       this.noteModel     as AnyModel,
      noteFolders: this.folderModel   as AnyModel,
      wiki:        this.wikiModel     as AnyModel,
      workbooks:   this.workbookModel as AnyModel,
      mrs:         this.mrModel       as AnyModel,
      automations: this.autoModel     as AnyModel,
      reports:     this.reportModel   as AnyModel,
    };
    for (const scope of scopes) {
      const m = modelMap[scope];
      if (m) await m.deleteMany({ ownerId });
    }
  }

  // ── Pass-1 importers ──────────────────────────────────────────────────────

  private async importProjects(
    docs: Doc[], ownerId: Types.ObjectId, idMap: Map<string, Types.ObjectId>, strategy: string,
  ) {
    let inserted = 0, skipped = 0;
    const m = this.projectModel as AnyModel;
    for (const raw of docs) {
      if (strategy === 'merge' && await m.exists({ ownerId, name: raw.name })) { skipped++; continue; }
      await m.create(prepare(raw, ownerId, idMap));
      inserted++;
    }
    return { inserted, skipped };
  }

  private async importFolders(
    docs: Doc[], ownerId: Types.ObjectId, idMap: Map<string, Types.ObjectId>, strategy: string,
  ) {
    const sorted = this.topoSortFolders(docs);
    let inserted = 0, skipped = 0;
    const m = this.folderModel as AnyModel;
    for (const raw of sorted) {
      const mappedParent = raw.parentId ? remap(idMap, raw.parentId) : null;
      if (strategy === 'merge' && await m.exists({ ownerId, name: raw.name, parentId: mappedParent })) {
        skipped++; continue;
      }
      const doc = prepare(raw, ownerId, idMap);
      doc.parentId = mappedParent;
      await m.create(doc);
      inserted++;
    }
    return { inserted, skipped };
  }

  // ── Generic pass-2 importer ───────────────────────────────────────────────

  private async importGeneric(
    model: AnyModel,
    docs: Doc[],
    ownerId: Types.ObjectId,
    idMap: Map<string, Types.ObjectId>,
    strategy: string,
    dedup: 'name' | 'titleProject' | 'noteTitle',
  ) {
    let inserted = 0, skipped = 0;

    for (const raw of docs) {
      if (strategy === 'merge') {
        const isDupe = await this.isDuplicate(model, raw, ownerId, idMap, dedup);
        if (isDupe) { skipped++; continue; }
      }
      const doc = prepare(raw, ownerId, idMap);
      if (raw.projectId) doc.projectId = remap(idMap, raw.projectId);
      if (raw.folderId)  doc.folderId  = remap(idMap, raw.folderId);
      await model.create(doc);
      inserted++;
    }
    return { inserted, skipped };
  }

  private async isDuplicate(
    model: AnyModel,
    raw: Doc,
    ownerId: Types.ObjectId,
    idMap: Map<string, Types.ObjectId>,
    dedup: 'name' | 'titleProject' | 'noteTitle',
  ): Promise<boolean> {
    if (dedup === 'name') {
      return !!(await model.exists({ ownerId, name: raw.name }));
    }
    if (dedup === 'titleProject') {
      const pid = raw.projectId ? remap(idMap, raw.projectId) : null;
      const filter: Record<string, unknown> = { ownerId, title: raw.title };
      if (pid) filter.projectId = pid;
      return !!(await model.exists(filter));
    }
    // noteTitle
    const fid = raw.folderId ? remap(idMap, raw.folderId) : null;
    return !!(await model.exists({ ownerId, title: raw.title, folderId: fid }));
  }

  // ── Topological sort for folders ──────────────────────────────────────────

  private topoSortFolders(docs: Doc[]): Doc[] {
    const byOid = new Map(docs.map((d) => [String(d._oid), d]));
    const result: Doc[] = [];
    const visited = new Set<string>();

    const visit = (doc: Doc) => {
      const key = String(doc._oid);
      if (visited.has(key)) return;
      visited.add(key);
      const parentOid = String(doc.parentId ?? '');
      if (parentOid && byOid.has(parentOid)) visit(byOid.get(parentOid)!);
      result.push(doc);
    };

    for (const doc of docs) visit(doc);
    return result;
  }
}
