import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WikiPage, WikiPageSchema } from './schemas/wiki-page.schema';
import { WikiService } from './wiki.service';
import { WikiController } from './wiki.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WikiPage.name, schema: WikiPageSchema },
    ]),
    NotificationsModule,
    UsersModule,
  ],
  controllers: [WikiController],
  providers: [WikiService],
})
export class WikiModule {}
