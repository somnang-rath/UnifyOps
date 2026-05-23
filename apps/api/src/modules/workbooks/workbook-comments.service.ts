import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkbookComment,
  WorkbookCommentDocument,
} from './schemas/workbook-comment.schema';
import { Workbook, WorkbookDocument } from './schemas/workbook.schema';
import {
  CreateCommentDto,
  ReplyCommentDto,
  UpdateCommentDto,
} from './dto/workbook-comment.dto';

@Injectable()
export class WorkbookCommentsService {
  constructor(
    @InjectModel(WorkbookComment.name)
    private commentModel: Model<WorkbookCommentDocument>,
    @InjectModel(Workbook.name)
    private wbModel: Model<WorkbookDocument>,
  ) {}

  /**
   * Anyone who can read the workbook can read/post comments. Resolve and
   * delete require ownership of the comment OR ownership of the workbook.
   * Checks both userId grants and role grants, matching WorkbooksService.resolveAccess.
   */
  private async assertReadAccess(
    viewer: { id: string; role: string },
    workbookId: string,
  ) {
    const wb = await this.wbModel
      .findById(workbookId)
      .select('ownerId grants')
      .lean();
    if (!wb) throw new NotFoundException();
    const isOwner = String(wb.ownerId) === viewer.id;
    const granted = (wb.grants ?? []).some(
      (g: any) =>
        (g.userId && String(g.userId) === viewer.id) ||
        (g.role && g.role === viewer.role),
    );
    if (!isOwner && !granted) throw new ForbiddenException();
    return { wb, isOwner };
  }

  async list(viewer: { id: string; role: string }, workbookId: string) {
    await this.assertReadAccess(viewer, workbookId);
    return this.commentModel
      .find({ workbookId: new Types.ObjectId(workbookId) })
      .sort({ createdAt: -1 })
      .lean();
  }

  async create(
    viewer: { id: string; role: string },
    workbookId: string,
    dto: CreateCommentDto,
  ) {
    await this.assertReadAccess(viewer, workbookId);
    return this.commentModel.create({
      workbookId: new Types.ObjectId(workbookId),
      sheetId: dto.sheetId,
      cellRef: dto.cellRef,
      authorId: new Types.ObjectId(viewer.id),
      body: dto.body,
      resolved: false,
      replies: [],
    });
  }

  async update(
    viewer: { id: string; role: string },
    workbookId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ) {
    const { isOwner } = await this.assertReadAccess(viewer, workbookId);
    const c = await this.commentModel.findById(commentId);
    if (!c) throw new NotFoundException();
    if (String(c.workbookId) !== workbookId) throw new NotFoundException();
    // Body edits are author-only; resolved toggle is open to readers.
    if (dto.body !== undefined) {
      if (String(c.authorId) !== viewer.id && !isOwner)
        throw new ForbiddenException('Only the author can edit');
      c.body = dto.body;
    }
    if (dto.resolved !== undefined) c.resolved = dto.resolved;
    await c.save();
    return c.toObject();
  }

  async remove(
    viewer: { id: string; role: string },
    workbookId: string,
    commentId: string,
  ) {
    const { isOwner } = await this.assertReadAccess(viewer, workbookId);
    const c = await this.commentModel.findById(commentId);
    if (!c) throw new NotFoundException();
    if (String(c.workbookId) !== workbookId) throw new NotFoundException();
    if (String(c.authorId) !== viewer.id && !isOwner)
      throw new ForbiddenException();
    await c.deleteOne();
    return { ok: true };
  }

  async reply(
    viewer: { id: string; role: string },
    workbookId: string,
    commentId: string,
    dto: ReplyCommentDto,
  ) {
    await this.assertReadAccess(viewer, workbookId);
    const c = await this.commentModel.findById(commentId);
    if (!c) throw new NotFoundException();
    if (String(c.workbookId) !== workbookId) throw new NotFoundException();
    c.replies.push({
      id: 'cr_' + Math.random().toString(36).slice(2, 10),
      authorId: new Types.ObjectId(viewer.id),
      body: dto.body,
      createdAt: new Date(),
    } as any);
    await c.save();
    return c.toObject();
  }
}
