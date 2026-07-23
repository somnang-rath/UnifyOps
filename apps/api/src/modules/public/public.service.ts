import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  WikiPage,
  WikiPageDocument,
} from '../wiki/schemas/wiki-page.schema';
import {
  View,
  ViewDocument,
  ViewLayout,
} from '../views/schemas/view.schema';
import {
  Project,
  ProjectDocument,
} from '../projects/schemas/project.schema';
import { Issue, IssueDocument } from '../issues/schemas/issue.schema';
import { sanitizePublicHtml } from './sanitize';

/**
 * Public issue projection (ADR 0012 §5, LOCKED) — enforced at the Mongo query
 * projection, never by post-hoc delete. `_id: 0` is deliberate: ObjectIds
 * embed creation timestamps and would be the only stable identifier leaked to
 * the internet; the space render needs no per-issue identity.
 *
 * Never: assigneeId, authorId, desc, comments, todos, parentId, emails, or
 * member data. Any future issue field is private-by-default until explicitly
 * added here.
 */
const PUBLIC_ISSUE_PROJECTION = {
  title: 1,
  status: 1,
  priority: 1,
  type: 1,
  labels: 1,
  dueDate: 1,
  updatedAt: 1,
  _id: 0,
} as const;

/** Hard cap on the public issue list (ADR 0012 §5) — no pagination in v1. */
const PUBLIC_ISSUE_CAP = 200;

/** Sort fields a stored `sortBy` may reference on the public surface. */
const PUBLIC_SORTABLE = new Set([
  'updatedAt',
  'createdAt',
  'priority',
  'dueDate',
  'title',
  'status',
]);

/**
 * The four canonical board columns (matches the web board fallback) used when
 * a project has never customised its `boardLists` (ADR 0012 §5).
 */
const CANONICAL_COLUMNS = [
  { id: 'todo', name: 'To do', color: '#94a3b8' },
  { id: 'inprogress', name: 'In progress', color: '#f59e0b' },
  { id: 'review', name: 'Review', color: '#3b82f6' },
  { id: 'done', name: 'Done', color: '#10b981' },
] as const;

type PublicColumn = { id: string; name: string; color: string };

type PublicIssue = {
  title: string;
  status: string;
  priority: string;
  type: string;
  labels: string[];
  dueDate?: Date;
  updatedAt: Date;
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `'updatedAt:desc'` → a whitelisted Mongo sort spec. */
const parseSort = (sortBy?: string | null): Record<string, 1 | -1> => {
  const [field, dir] = (sortBy ?? '').split(':');
  const key = field && PUBLIC_SORTABLE.has(field) ? field : 'updatedAt';
  return { [key]: dir === 'asc' ? 1 : -1 };
};

/**
 * Anonymous read path for the public Space (ADR 0002 §4, extended by ADR 0012
 * §5 to a discriminated union over wiki | view | project).
 *
 * Field-stripping is enforced at the query projection, not by deleting fields
 * after the fact: only public-safe columns are ever loaded. The response must
 * never expose authorId, projectId, publishedBy, parentId, or member data.
 */
@Injectable()
export class PublicService {
  constructor(
    @InjectModel(WikiPage.name)
    private readonly wiki: Model<WikiPageDocument>,
    @InjectModel(View.name)
    private readonly views: Model<ViewDocument>,
    @InjectModel(Project.name)
    private readonly projects: Model<ProjectDocument>,
    @InjectModel(Issue.name)
    private readonly issues: Model<IssueDocument>,
  ) {}

  /**
   * Resolve a public anchor in the fixed order wiki → view → project (ADR
   * 0012 §5): first `{ anchor, isPublic: true }` match wins. The order is a
   * deterministic tiebreak only — minting checks all three collections, so a
   * cross-type collision never happens in practice. A miss on all three →
   * 404, indistinguishable from unpublished (no existence leak).
   */
  async getByAnchor(anchor: string) {
    const wiki = await this.resolveWiki(anchor);
    if (wiki) return wiki;

    const view = await this.resolveView(anchor);
    if (view) return view;

    const project = await this.resolveProject(anchor);
    if (project) return project;

    throw new NotFoundException();
  }

  private async resolveWiki(anchor: string) {
    const page = await this.wiki
      .findOne(
        { anchor, isPublic: true },
        { title: 1, content: 1, coverImage: 1, updatedAt: 1, _id: 0 },
      )
      .lean<{
        title: string;
        content: string;
        coverImage: string | null;
        updatedAt: Date;
      }>();
    if (!page) return null;

    return {
      type: 'wiki' as const,
      anchor,
      title: page.title,
      // Sanitized here as well as in apps/space: the API must never serve
      // script-bearing HTML to any consumer, and space must not have to trust
      // its upstream (docs/plan/01 §3.4).
      contentHTML: sanitizePublicHtml(page.content),
      // The only non-content public field added by ADR 0010: a write-validated
      // https URL rendered as an <img src>, never HTML — no sanitization needed.
      coverImage: page.coverImage ?? null,
      updatedAt: page.updatedAt,
    };
  }

  private async resolveView(anchor: string) {
    const view = await this.views
      .findOne(
        { anchor, isPublic: true },
        {
          name: 1,
          layout: 1,
          groupBy: 1,
          sortBy: 1,
          filters: 1,
          projectId: 1,
          updatedAt: 1,
          _id: 0,
        },
      )
      .lean<{
        name: string;
        layout: ViewLayout;
        groupBy: string | null;
        sortBy: string;
        filters: Record<string, unknown>;
        projectId: Types.ObjectId | null;
        updatedAt: Date;
      }>();
    // Only project-scoped views are publishable (ADR 0012 §3); a null
    // projectId here would be data corruption — treat it as not found.
    if (!view?.projectId) return null;

    const issues = await this.publicIssues(
      view.projectId,
      // Mongoose `minimize` drops empty objects at save time, so a view with
      // no filters loads with the field absent — not `{}`.
      view.filters ?? {},
      view.sortBy,
    );
    return {
      type: 'view' as const,
      anchor,
      title: view.name,
      layout: view.layout,
      groupBy: view.groupBy,
      // Board columns only make sense for the kanban layout (ADR 0012 §5).
      ...(view.layout === 'kanban'
        ? { columns: await this.boardColumns(view.projectId) }
        : {}),
      issues,
      updatedAt: view.updatedAt,
    };
  }

  private async resolveProject(anchor: string) {
    const project = await this.projects
      .findOne(
        { anchor, isPublic: true },
        { name: 1, boardLists: 1, updatedAt: 1 },
      )
      .lean<{
        _id: Types.ObjectId;
        name: string;
        boardLists?: { id: string; name: string; color: string }[];
        updatedAt: Date;
      }>();
    if (!project) return null;

    // A published project renders its default board (ADR 0012 §5):
    // kanban, grouped by status, newest-updated first.
    const issues = await this.publicIssues(project._id, {}, 'updatedAt:desc');
    return {
      type: 'project' as const,
      anchor,
      title: project.name,
      layout: 'kanban' as const,
      groupBy: 'status',
      columns: this.toColumns(project.boardLists),
      issues,
      updatedAt: project.updatedAt,
    };
  }

  /**
   * Live, capped, projection-stripped issue query (ADR 0012 §5). Applies the
   * view's stored filters — only the keys the view DTO recognises; anything
   * else is ignored, never forwarded into the query.
   */
  private async publicIssues(
    projectId: Types.ObjectId,
    filters: Record<string, unknown> = {},
    sortBy?: string,
  ): Promise<PublicIssue[]> {
    const q: FilterQuery<IssueDocument> = {
      projectId: new Types.ObjectId(String(projectId)),
    };
    if (typeof filters.status === 'string') q.status = filters.status;
    if (typeof filters.priority === 'string') q.priority = filters.priority;
    if (typeof filters.type === 'string') q.type = filters.type;
    if (
      typeof filters.assigneeId === 'string' &&
      Types.ObjectId.isValid(filters.assigneeId)
    ) {
      q.assigneeId = new Types.ObjectId(filters.assigneeId);
    }
    if (Array.isArray(filters.labels) && filters.labels.length) {
      q.labels = { $in: filters.labels.map(String) };
    }
    if (typeof filters.q === 'string' && filters.q) {
      q.title = { $regex: escapeRegex(filters.q), $options: 'i' };
    }
    return this.issues
      .find(q, PUBLIC_ISSUE_PROJECTION)
      .sort(parseSort(sortBy))
      .limit(PUBLIC_ISSUE_CAP)
      .lean<PublicIssue[]>();
  }

  /** Ordered board columns for a view's project (kanban layout only). */
  private async boardColumns(
    projectId: Types.ObjectId,
  ): Promise<PublicColumn[]> {
    const project = await this.projects
      .findById(projectId, { boardLists: 1, _id: 0 })
      .lean<{
        boardLists?: { id: string; name: string; color: string }[];
      }>();
    return this.toColumns(project?.boardLists);
  }

  /**
   * `{ id, name, color }` only — never `wipLimit` or collapse state (ADR 0012
   * §5). Falls back to the four canonical columns when the board was never
   * customised.
   */
  private toColumns(
    boardLists?: { id: string; name: string; color: string }[],
  ): PublicColumn[] {
    if (!boardLists?.length) return [...CANONICAL_COLUMNS];
    return boardLists.map(({ id, name, color }) => ({ id, name, color }));
  }
}
