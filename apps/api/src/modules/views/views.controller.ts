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
import { ViewsService } from './views.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  CreateViewDto,
  CreateViewSchema,
  ListViewsQuery,
  ListViewsQuerySchema,
  ReorderViewsDto,
  ReorderViewsSchema,
  UpdateViewDto,
  UpdateViewSchema,
} from './dto/view.dto';

@Controller('views')
export class ViewsController {
  constructor(private views: ViewsService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListViewsQuerySchema)) q: ListViewsQuery,
  ) {
    return this.views.list(user.id, q);
  }

  @Get(':id')
  byId(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.views.byId(user.id, id);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateViewSchema))
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateViewDto) {
    return this.views.create(user.id, dto);
  }

  @Post('reorder')
  @UsePipes(new ZodValidationPipe(ReorderViewsSchema))
  reorder(@CurrentUser() user: { id: string }, @Body() dto: ReorderViewsDto) {
    return this.views.reorder(user.id, dto.ids);
  }

  /** Publish to the public Space (ADR 0012 §3) → { anchor, isPublic, publishedAt }. */
  @Post(':id/publish')
  publish(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.views.publish(user.id, id);
  }

  /** Unpublish (anchor preserved, ADR 0012 §3) → { isPublic: false }. */
  @Post(':id/unpublish')
  unpublish(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.views.unpublish(user.id, id);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateViewSchema))
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateViewDto,
  ) {
    return this.views.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.views.remove(user.id, id);
  }
}
