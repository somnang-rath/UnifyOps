import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  AuthUserPayload,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
import {
  ChatDto,
  ChatSchema,
  RenameConversationDto,
  RenameConversationSchema,
} from './dto/assistant.dto';

@Controller('assistant')
export class AssistantController {
  constructor(private assistant: AssistantService) {}

  /** Non-secret assistant settings (enabled/provider/model) for the web UI. */
  @Get('config')
  config() {
    return this.assistant.publicConfig();
  }

  /** Remaining per-user rate budget (+ optional conversation token totals). */
  @Get('usage')
  usage(
    @CurrentUser() u: AuthUserPayload,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.assistant.usage(u.id, conversationId);
  }

  @Get('conversations')
  list(@CurrentUser() u: AuthUserPayload) {
    return this.assistant.listConversations(u.id);
  }

  @Get('conversations/:id')
  getOne(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.assistant.getConversation(u.id, id);
  }

  @Patch('conversations/:id')
  rename(
    @CurrentUser() u: AuthUserPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RenameConversationSchema))
    dto: RenameConversationDto,
  ) {
    return this.assistant.renameConversation(u.id, id, dto.title);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() u: AuthUserPayload, @Param('id') id: string) {
    return this.assistant.deleteConversation(u.id, id);
  }

  /**
   * Streamed chat (Server-Sent Events). Rate limiting is enforced inside the
   * service using the admin-configured `ASSISTANT_RATE_LIMIT_PER_MIN` per user.
   */
  @Post('chat')
  chat(
    @CurrentUser() u: AuthUserPayload,
    @Body(new ZodValidationPipe(ChatSchema)) dto: ChatDto,
    @Res() res: Response,
  ) {
    return this.assistant.chat(u, dto, res);
  }
}
