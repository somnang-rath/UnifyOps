import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  IssueTemplate,
  IssueTemplateSchema,
} from './schemas/issue-template.schema';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IssueTemplate.name, schema: IssueTemplateSchema },
    ]),
    ProjectAccessModule,
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [MongooseModule],
})
export class TemplatesModule {}
