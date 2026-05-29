import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReportTemplate,
  ReportTemplateSchema,
} from './schemas/report-template.schema';
import { ReportRun, ReportRunSchema } from './schemas/report-run.schema';
import {
  ReportDeliveryLog,
  ReportDeliveryLogSchema,
} from './schemas/report-delivery-log.schema';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ReportDataService } from './report-data.service';
import { ReportGeneratorService } from './report-generator.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { EmailService } from '../notifications/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportTemplate.name,    schema: ReportTemplateSchema    },
      { name: ReportRun.name,         schema: ReportRunSchema         },
      { name: ReportDeliveryLog.name, schema: ReportDeliveryLogSchema },
      { name: Issue.name,             schema: IssueSchema             },
      { name: Project.name,           schema: ProjectSchema           },
      { name: User.name,              schema: UserSchema              },
    ]),
  ],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportDataService,
    ReportGeneratorService,
    ReportSchedulerService,
    EmailService,
  ],
})
export class ReportsModule {}
