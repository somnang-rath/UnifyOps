import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Note, NoteDocument } from '../notes/schemas/note.schema';

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
  ) {}

  async query(userId: string, q: string, limit: number) {
    if (!q || q.length < 2) return { issues: [], projects: [], notes: [] };

    const re = { $regex: q, $options: 'i' };
    const uid = new Types.ObjectId(userId);

    const [issues, projects, notes] = await Promise.all([
      this.issueModel
        .find({ $or: [{ title: re }, { desc: re }] })
        .select('_id title status priority type updatedAt')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),

      this.projectModel
        .find({
          $and: [
            { $or: [{ name: re }, { desc: re }] },
            { $or: [{ ownerId: uid }, { members: uid }] },
          ],
        })
        .select('_id name desc color updatedAt')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),

      this.noteModel
        .find({
          ownerId: uid,
          $or: [{ title: re }, { 'blocks.value': re }],
        })
        .select('_id title emoji updatedAt')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    return { issues, projects, notes };
  }
}
