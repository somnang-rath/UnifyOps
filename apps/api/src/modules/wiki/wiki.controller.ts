import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
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
  constructor(private wiki: WikiService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListWikiQuerySchema)) q: ListWikiQuery) {
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
}
