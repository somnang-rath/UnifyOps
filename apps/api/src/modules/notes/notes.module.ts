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
import { InternalNotesController } from './internal-notes.controller';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Note.name, schema: NoteSchema },
      { name: NoteFolder.name, schema: NoteFolderSchema },
    ]),
    UsersModule,
    NotificationsModule,
    // Mints the scoped collab tokens handed to apps/live (ADR 0009 §5).
    AuthModule,
  ],
  controllers: [NotesController, InternalNotesController],
  providers: [NotesService, NotesPdfService, InternalTokenGuard],
})
export class NotesModule {}
