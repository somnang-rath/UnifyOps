import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { Issue, IssueSchema } from '../issues/schemas/issue.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Note, NoteSchema } from '../notes/schemas/note.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Issue.name, schema: IssueSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Note.name, schema: NoteSchema },
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
