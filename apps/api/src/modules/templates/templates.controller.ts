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
import { TemplatesService } from './templates.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  CreateTemplateDto,
  CreateTemplateSchema,
  ListTemplatesQuery,
  ListTemplatesQuerySchema,
  UpdateTemplateDto,
  UpdateTemplateSchema,
} from './dto/template.dto';

@Controller('templates')
export class TemplatesController {
  constructor(private templates: TemplatesService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListTemplatesQuerySchema)) q: ListTemplatesQuery,
  ) {
    return this.templates.list(user.id, q);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateTemplateSchema))
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateTemplateDto,
  ) {
    return this.templates.create(user.id, dto);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateTemplateSchema))
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.templates.remove(user.id, id);
  }
}
