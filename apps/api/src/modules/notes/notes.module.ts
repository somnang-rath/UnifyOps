import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Note, NoteSchema } from './schemas/note.schema';
import {
  NoteFolder,
  NoteFolderSchema,
} from './schemas/note-folder.schema';
import { NotesService } from './notes.service';
import { NotesPdfService } from './notes-pdf.service';
import { NotesController } from './notes.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: NoteFolder.name, schema: NoteFolderSchema },
    ]),
    UsersModule,
    NotificationsModule,
  ],
  controllers: [NotesController],
  providers: [NotesService, NotesPdfService],
})
export class NotesModule {}
