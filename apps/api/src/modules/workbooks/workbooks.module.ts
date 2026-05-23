import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Workbook, WorkbookSchema } from './schemas/workbook.schema';
import {
  WorkbookComment,
  WorkbookCommentSchema,
} from './schemas/workbook-comment.schema';
import { WorkbooksService } from './workbooks.service';
import { WorkbookCommentsService } from './workbook-comments.service';
import { WorkbooksController } from './workbooks.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workbook.name, schema: WorkbookSchema },
      { name: WorkbookComment.name, schema: WorkbookCommentSchema },
    ]),
    UsersModule,
  ],
  controllers: [WorkbooksController],
  providers: [WorkbooksService, WorkbookCommentsService],
})
export class WorkbooksModule {}
