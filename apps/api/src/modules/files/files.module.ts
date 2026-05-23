import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { MongoStorage } from './storage/mongo.storage';
import { FileItem, FileItemSchema } from './schemas/file.schema';
import { Folder, FolderSchema } from './schemas/folder.schema';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileItem.name, schema: FileItemSchema },
      { name: Folder.name, schema: FolderSchema },
    ]),
    UsersModule,
  ],
  controllers: [FilesController],
  providers: [FilesService, MongoStorage],
})
export class FilesModule {}
