import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { ProjectAccessService } from '../projects/access/project-access.service';

/**
 * Escapes regex metacharacters so the query matches literally. Without it a
 * user-supplied `.*` or a nested quantifier goes straight into the engine —
 * both a wrong-results bug and a ReDoS foot-gun.
 */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `{ $or: [{ field: /q/i }, …] }` over the given fields. */
const regexOver = <T>(fields: string[], q: string): FilterQuery<T> =>
  ({
    $or: fields.map((f) => ({ [f]: { $regex: escapeRegex(q), $options: 'i' } })),
  }) as FilterQuery<T>;

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Note.name) private noteModel: Model<NoteDocument>,
    private access: ProjectAccessService,
  ) {}

  /**
   * Runs `$text` first and falls back to a scoped regex when it finds nothing.
   *
   * `$text` is indexed but only matches whole stemmed words, so it misses the
   * prefix a command palette sends on every keystroke ("proj" ≠ "project").
   * The regex catches those, and because `scope` has already narrowed the
   * candidates to the caller's own projects it runs over a bounded slice — not
   * the whole collection, which is what made the old unscoped regex a full
   * collection scan per keystroke.
   *
   * `$text` may not appear inside `$or`, hence the `$and` composition here.
   */
  private async textThenRegex<T>(
    model: Model<T>,
    scope: FilterQuery<T>,
    fields: string[],
    q: string,
    select: string,
    limit: number,
  ) {
    const run = (match: FilterQuery<T>) =>
      model
        .find({ $and: [scope, match] } as FilterQuery<T>)
        .select(select)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();

    const hits = await run({ $text: { $search: q } } as FilterQuery<T>);
    if (hits.length > 0) return hits;
    return run(regexOver<T>(fields, q));
  }

  /**
   * Cross-collection search, scoped to what the caller may actually read
   * (ADR 0003/0004). Every branch is filtered — an unscoped branch here leaks
   * titles across the whole instance, which is exactly what this endpoint did
   * for issues before.
   *
   * `workspaceId` narrows further (ADR 0011 §2b) with the same semantics as the
   * issues list: an unknown or non-member workspace yields nothing, never an
   * unfiltered result.
   */
  async query(userId: string, q: string, limit: number, workspaceId?: string) {
    if (!q || q.length < 2) return { issues: [], projects: [], notes: [] };

    const uid = new Types.ObjectId(userId);

    // The same rule the issues list uses, personal (project-less) tier
    // included — so search never surfaces an issue that /issues would hide.
    const issueScope = await this.access.projectItemScope<IssueDocument>(
      userId,
      workspaceId,
      { $or: [{ authorId: uid }, { assigneeId: uid }] },
    );

    // Projects go through the canonical readable set rather than a local
    // owner/member test, so internal + public projects in the caller's
    // workspaces appear here exactly as they do on /projects.
    const readableProjectIds = workspaceId
      ? await this.access.readableProjectIdsInWorkspace(userId, workspaceId)
      : await this.access.readableProjectIds(userId);

    const [issues, projects, notes] = await Promise.all([
      this.textThenRegex<IssueDocument>(
        this.issueModel,
        issueScope,
        ['title', 'desc'],
        q,
        '_id title status priority type updatedAt',
        limit,
      ),

      this.textThenRegex<ProjectDocument>(
        this.projectModel,
        { _id: { $in: readableProjectIds } },
        ['name', 'desc'],
        q,
        '_id name desc color updatedAt',
        limit,
      ),

      // Notes stay owner-only and stay on regex: `ownerId` is indexed, so the
      // candidate set is already just one user's notes and a text index would
      // buy little. Both body fields are searched because the content lives in
      // `blocks[].value` on legacy notes and in `contentHTML` after the ADR 0009
      // migration; the cost is that a query for a tag name ("div") can match
      // markup, which is rare enough to accept over missing migrated notes.
      // Deliberately narrower than note read access (folder grants):
      // under-returning is safe, widening it is its own change with its own tests.
      this.noteModel
        .find({
          $and: [
            { ownerId: uid },
            regexOver<NoteDocument>(
              ['title', 'blocks.value', 'contentHTML'],
              q,
            ),
          ],
        })
        .select('_id title emoji updatedAt')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    return { issues, projects, notes };
  }
}
