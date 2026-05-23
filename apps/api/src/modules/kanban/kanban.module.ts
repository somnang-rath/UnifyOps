import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  KanbanBoard,
  KanbanBoardSchema,
} from './schemas/kanban-board.schema';
import {
  KanbanPosition,
  KanbanPositionSchema,
} from './schemas/kanban-position.schema';
import { KanbanService } from './kanban.service';
import { KanbanController } from './kanban.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KanbanBoard.name, schema: KanbanBoardSchema },
      { name: KanbanPosition.name, schema: KanbanPositionSchema },
    ]),
    UsersModule,
  ],
  controllers: [KanbanController],
  providers: [KanbanService],
  exports: [KanbanService],
})
export class KanbanModule {}
