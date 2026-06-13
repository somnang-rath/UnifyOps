import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BackupSchedule, BackupScheduleSchema } from './schemas/backup-schedule.schema';
import { BackupFile, BackupFileSchema } from './schemas/backup-file.schema';

import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { Note, NoteSchema } from '../notes/schemas/note.schema';
import { NoteFolder, NoteFolderSchema } from '../notes/schemas/note-folder.schema';
import { WikiPage, WikiPageSchema } from '../wiki/schemas/wiki-page.schema';
import { Workbook, WorkbookSchema } from '../workbooks/schemas/workbook.schema';
import { MergeRequest, MergeRequestSchema } from '../mrs/schemas/mr.schema';
import { Automation, AutomationSchema } from '../automations/schemas/automation.schema';
import { ReportTemplate, ReportTemplateSchema } from '../reports/schemas/report-template.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

import { BackupExportService }    from './backup-export.service';
import { BackupCryptoService }    from './backup-crypto.service';
import { BackupStorageService }   from './backup-storage.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupImportService }    from './backup-import.service';
import { BackupController }       from './backup.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BackupSchedule.name, schema: BackupScheduleSchema },
      { name: BackupFile.name,     schema: BackupFileSchema     },
      { name: Project.name,        schema: ProjectSchema        },
      { name: Issue.name,          schema: IssueSchema          },
      { name: Note.name,           schema: NoteSchema           },
      { name: NoteFolder.name,     schema: NoteFolderSchema     },
      { name: WikiPage.name,       schema: WikiPageSchema       },
      { name: Workbook.name,       schema: WorkbookSchema       },
      { name: MergeRequest.name,   schema: MergeRequestSchema   },
      { name: Automation.name,     schema: AutomationSchema     },
      { name: ReportTemplate.name, schema: ReportTemplateSchema },
      { name: User.name,           schema: UserSchema           },
    ]),
  ],
  controllers: [BackupController],
  providers: [
    BackupExportService,
    BackupCryptoService,
    BackupStorageService,
    BackupSchedulerService,
    BackupImportService,
  ],
})
export class BackupsModule {}
