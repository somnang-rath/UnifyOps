import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  WikiPage,
  WikiPageSchema,
} from '../wiki/schemas/wiki-page.schema';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/**
 * Public Space (ADR 0002) — anonymous, read-only resolution of published
 * content by public anchor. Registers its own WikiPage model binding so it
 * does not depend on WikiModule internals.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WikiPage.name, schema: WikiPageSchema },
    ]),
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
