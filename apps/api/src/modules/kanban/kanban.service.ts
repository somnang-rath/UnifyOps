import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  KanbanBoard,
  KanbanBoardDocument,
} from './schemas/kanban-board.schema';
import {
  KanbanPosition,
  KanbanPositionDocument,
} from './schemas/kanban-position.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { KB_BOARDS_BY_ROLE, inferBoardRole } from './role-boards';

@Injectable()
export class KanbanService {
  constructor(
    @InjectModel(KanbanBoard.name)
    private boardModel: Model<KanbanBoardDocument>,
    @InjectModel(KanbanPosition.name)
    private posModel: Model<KanbanPositionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async getOrSeedBoard(userId: string) {
    const oid = new Types.ObjectId(userId);
    const existing = await this.boardModel.findOne({ userId: oid }).lean();
    if (existing) return existing;
    const user = await this.userModel.findById(userId).lean();
    const role = user ? inferBoardRole(user.email) : 'default';
    const cols = KB_BOARDS_BY_ROLE[role].map((c) => ({ ...c }));
    // Atomic upsert avoids the race where two concurrent reads both seed
    // and the second insert trips the unique userId index (E11000).
    const board = await this.boardModel
      .findOneAndUpdate(
        { userId: oid },
        { $setOnInsert: { userId: oid, columns: cols } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();
    return board;
  }

  async setColumns(userId: string, columns: KanbanBoardDocument['columns']) {
    const oid = new Types.ObjectId(userId);
    return this.boardModel
      .findOneAndUpdate(
        { userId: oid },
        { $set: { columns } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .lean();
  }

  async positions(userId: string): Promise<Record<string, string>> {
    const oid = new Types.ObjectId(userId);
    const rows = await this.posModel
      .find({ userId: oid }, { issueId: 1, columnId: 1 })
      .lean();
    const map: Record<string, string> = {};
    rows.forEach((r) => {
      map[String(r.issueId)] = r.columnId;
    });
    return map;
  }

  async setPosition(userId: string, issueId: string, columnId: string) {
    return this.posModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          issueId: new Types.ObjectId(issueId),
        },
        { $set: { columnId } },
        { upsert: true, new: true },
      )
      .lean();
  }
}
