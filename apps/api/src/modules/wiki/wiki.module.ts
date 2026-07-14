import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WikiPage, WikiPageSchema } from './schemas/wiki-page.schema';
import {
  YjsDocument,
  YjsDocumentSchema,
} from './schemas/yjs-document.schema';
import { WikiService } from './wiki.service';
import { WikiController } from './wiki.controller';
import { InternalWikiController } from './internal-wiki.controller';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ProjectAccessModule } from '../projects/access/project-access.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WikiPage.name, schema: WikiPageSchema },
      // Declared so the API's connection manages the collection + unique index.
      // The live server owns the read/write path (ADR §3).
      { name: YjsDocument.name, schema: YjsDocumentSchema },
    ]),
    NotificationsModule,
    UsersModule,
    // The shared project-access rule (ADR 0004) — used by accessFor authz.
    ProjectAccessModule,
  ],
  controllers: [WikiController, InternalWikiController],
  providers: [WikiService, InternalTokenGuard],
  exports: [WikiService],
})
export class WikiModule {}
