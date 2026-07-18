import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import {
  AuthUserPayload,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodQueryPipe, ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from '../auth/auth.service';
import { WikiService } from './wiki.service';
import {
  ListWikiQuery,
  ListWikiQuerySchema,
  SaveWikiDto,
  SaveWikiSchema,
  UpdateWikiDto,
  UpdateWikiSchema,
} from './dto/wiki.dto';

@Controller('wiki')
export class WikiController {
  constructor(
    private wiki: WikiService,
    private auth: AuthService,
  ) {}

  @Get()
  list(@Query(new ZodQueryPipe(ListWikiQuerySchema)) q: ListWikiQuery) {
    return this.wiki.list(q);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.wiki.byId(id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(SaveWikiSchema))
  create(@CurrentUser() u: { id: string }, @Body() dto: SaveWikiDto) {
    return this.wiki.create(u.id, dto);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateWikiSchema))
  update(
    @CurrentUser() u: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateWikiDto,
  ) {
    return this.wiki.update(u.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.wiki.remove(u.id, u.role, id);
  }

  /**
   * Mint a short-lived token for the live server (docs/plan/01 §2, ADR 0007).
   *
   * The browser never hands its own session token to apps/live: it asks here,
   * we re-check read access, and return a token that is good for this one
   * document for five minutes and is rejected outright by the REST API.
   */
  @HttpCode(200)
  @Post(':id/collab-token')
  async collabToken(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    const { canRead, canWrite } = await this.wiki.accessFor(u.id, id);
    if (!canRead) throw new ForbiddenException('No access to this page');
    const { token, expiresIn } = await this.auth.mintCollabToken(u.id, `wiki:${id}`);
    return { token, expiresIn, canWrite };
  }

  // ── Phase 3: publish to the public Space (ADR 0002 §3) ──
  @Post(':id/publish')
  publish(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.wiki.publish(u.id, id);
  }

  @Delete(':id/publish')
  unpublish(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.wiki.unpublish(u.id, id);
  }
}
