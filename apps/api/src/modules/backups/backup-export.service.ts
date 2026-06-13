import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { gzipSync } from 'node:zlib';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { NoteFolder, NoteFolderDocument } from '../notes/schemas/note-folder.schema';
import { WikiPage, WikiPageDocument } from '../wiki/schemas/wiki-page.schema';
import { Workbook, WorkbookDocument } from '../workbooks/schemas/workbook.schema';
import { MergeRequest, MergeRequestDocument } from '../mrs/schemas/mr.schema';
import { Automation, AutomationDocument } from '../automations/schemas/automation.schema';
import { ReportTemplate, ReportTemplateDocument } from '../reports/schemas/report-template.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import type { BackupScope } from './schemas/backup-schedule.schema';
import type { BackupMeta, BackupPayload } from './dto/backup.dto';

/** Strips Mongoose internals and renames _id → _oid for dedup tracking at import time. */
function sanitize(docs: Record<string, unknown>[]): Record<string, unknown>[] {
  return docs.map((d) => {
    const { _id, __v, ...rest } = d as { _id: unknown; __v?: unknown; [k: string]: unknown };
    return { _oid: String(_id), ...rest };
  });
}

@Injectable()
export class BackupExportService {
  constructor(
    @InjectModel(Project.name)       private projectModel:  Model<ProjectDocument>,
    @InjectModel(Issue.name)         private issueModel:    Model<IssueDocument>,
    @InjectModel(Note.name)          private noteModel:     Model<NoteDocument>,
    @InjectModel(NoteFolder.name)    private folderModel:   Model<NoteFolderDocument>,
    @InjectModel(WikiPage.name)      private wikiModel:     Model<WikiPageDocument>,
    @InjectModel(Workbook.name)      private workbookModel: Model<WorkbookDocument>,
    @InjectModel(MergeRequest.name)  private mrModel:       Model<MergeRequestDocument>,
    @InjectModel(Automation.name)    private autoModel:     Model<AutomationDocument>,
    @InjectModel(ReportTemplate.name) private reportModel:  Model<ReportTemplateDocument>,
    @InjectModel(User.name)          private userModel:     Model<UserDocument>,
  ) {}

  async exportForUser(
    userId: string,
    scopes: BackupScope[],
    exportedBy: string,
    fileName: string,
  ): Promise<Buffer> {
    const oid = new Types.ObjectId(userId);
    const scopeSet = new Set(scopes);
    const data: Record<string, unknown[]> = {};

    const fetch = async (scope: BackupScope, model: Model<unknown>, filter: Record<string, unknown>) => {
      if (!scopeSet.has(scope)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docs = await (model as Model<any>).find(filter).lean();
      data[scope] = sanitize(docs as Record<string, unknown>[]);
    };

    await Promise.all([
      fetch('projects',    this.projectModel  as Model<unknown>, { ownerId: oid }),
      fetch('issues',      this.issueModel    as Model<unknown>, { ownerId: oid }),
      fetch('notes',       this.noteModel     as Model<unknown>, { ownerId: oid }),
      fetch('noteFolders', this.folderModel   as Model<unknown>, { ownerId: oid }),
      fetch('wiki',        this.wikiModel     as Model<unknown>, { ownerId: oid }),
      fetch('workbooks',   this.workbookModel as Model<unknown>, { ownerId: oid }),
      fetch('mrs',         this.mrModel       as Model<unknown>, { ownerId: oid }),
      fetch('automations', this.autoModel     as Model<unknown>, { ownerId: oid }),
      fetch('reports',     this.reportModel   as Model<unknown>, { ownerId: oid }),
    ]);

    const meta: BackupMeta = {
      version:    '1',
      app:        'Prism',
      exportedAt: new Date().toISOString(),
      exportedBy,
      fileName,
      encrypted:  false,
      scopes,
    };

    const payload: BackupPayload = { meta, data };
    return gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  }

  /** Fetch user email for embedding in meta. */
  async getEmailById(userId: string): Promise<string> {
    const user = await this.userModel.findById(userId).select('email').lean();
    return (user as { email?: string })?.email ?? userId;
  }
}
