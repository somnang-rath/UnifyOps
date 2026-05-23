import { Body, Controller, Get, Param, Patch, UsePipes } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { KanbanService } from './kanban.service';
import {
  ColumnsBody,
  ColumnsBodySchema,
  PositionBody,
  PositionBodySchema,
} from './dto/kanban.dto';

@Controller('kanban')
export class KanbanController {
  constructor(private kanban: KanbanService) {}

  @Get('board/me')
  myBoard(@CurrentUser() u: { id: string }) {
    return this.kanban.getOrSeedBoard(u.id);
  }

  @Get('board/:userId')
  board(@Param('userId') userId: string) {
    return this.kanban.getOrSeedBoard(userId);
  }

  @Patch('board/me')
  @UsePipes(new ZodValidationPipe(ColumnsBodySchema))
  saveBoard(
    @CurrentUser() u: { id: string },
    @Body() body: ColumnsBody,
  ) {
    return this.kanban.setColumns(u.id, body.columns as any);
  }

  @Get('positions/me')
  myPositions(@CurrentUser() u: { id: string }) {
    return this.kanban.positions(u.id);
  }

  @Get('positions/:userId')
  positions(@Param('userId') userId: string) {
    return this.kanban.positions(userId);
  }

  @Patch('positions/me')
  @UsePipes(new ZodValidationPipe(PositionBodySchema))
  setPos(
    @CurrentUser() u: { id: string },
    @Body() body: PositionBody,
  ) {
    return this.kanban.setPosition(u.id, body.issueId, body.columnId);
  }
}
