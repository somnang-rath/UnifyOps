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
import { WebhooksService } from './webhooks.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import {
  CreateWebhookDto,
  CreateWebhookSchema,
  ListWebhooksQuery,
  ListWebhooksQuerySchema,
  UpdateWebhookDto,
  UpdateWebhookSchema,
} from './dto/webhook.dto';

@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooks: WebhooksService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string },
    @Query(new ZodQueryPipe(ListWebhooksQuerySchema)) q: ListWebhooksQuery,
  ) {
    return this.webhooks.list(user.id, q.workspaceId);
  }

  @Post()
  @UsePipes(new ZodValidationPipe(CreateWebhookSchema))
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateWebhookDto) {
    return this.webhooks.create(user.id, dto);
  }

  @Get(':id/deliveries')
  deliveries(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.webhooks.deliveries(user.id, id);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(UpdateWebhookSchema))
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooks.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.webhooks.remove(user.id, id);
  }
}
