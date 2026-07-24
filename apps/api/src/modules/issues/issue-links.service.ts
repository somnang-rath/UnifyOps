import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Issue, IssueDocument } from './schemas/issue.schema';
import {
  INVERSE_RELATION,
  IssueRelation,
  IssueRelationDocument,
  RelationType,
} from './schemas/issue-relation.schema';
import { IssuesService } from './issues.service';

const oid = (v: string) => new Types.ObjectId(v);

/** Trimmed shape returned when listing related/child issues. */
const ISSUE_CARD_FIELDS = {
  title: 1,
  status: 1,
  type: 1,
  priority: 1,
  assigneeId: 1,
  projectId: 1,
} as const;

/**
 * Sub-issues and issue relations (docs/plan/03-feature-parity.md §1).
 *
 * Every read here goes through {@link IssuesService.byId}, which enforces the
 * project/stakeholder access rule and 404s otherwise. So a relation can only
 * ever be created, listed, or removed between issues the caller may already
 * see — the link layer adds no new way to reach an issue.
 */
@Injectable()
export class IssueLinksService {
  constructor(
    @InjectModel(Issue.name) private issueModel: Model<IssueDocument>,
    @InjectModel(IssueRelation.name)
    private relModel: Model<IssueRelationDocument>,
    private issues: IssuesService,
  ) {}

  // ── Sub-issues ────────────────────────────────────────────────────

  /** Direct children of an issue, with a done/total rollup. */
  async children(userId: string, parentId: string) {
    await this.issues.byId(userId, parentId); // access gate

    const items = await this.issueModel
      .find({ parentId: oid(parentId) }, ISSUE_CARD_FIELDS)
      .sort({ createdAt: 1 })
      .lean();

    const done = items.filter((i) => i.status === 'done').length;
    return {
      items,
      rollup: { done, total: items.length },
    };
  }

  // ── Relations ─────────────────────────────────────────────────────

  /**
   * Every relation touching an issue, normalised to that issue's point of view:
   * a stored `blocks` shows up as `blocked_by` on the target. Grouped by kind.
   */
  async relations(userId: string, issueId: string) {
    await this.issues.byId(userId, issueId); // access gate
    const id = oid(issueId);

    const [outgoing, incoming] = await Promise.all([
      this.relModel.find({ sourceId: id }).lean(),
      this.relModel.find({ targetId: id }).lean(),
    ]);

    // The other issue for each relation, from this issue's perspective, with the
    // kind flipped for incoming links.
    const edges = [
      ...outgoing.map((r) => ({
        relationId: String(r._id),
        type: r.type as string,
        otherId: r.targetId,
      })),
      ...incoming.map((r) => ({
        relationId: String(r._id),
        type: INVERSE_RELATION[r.type as RelationType],
        otherId: r.sourceId,
      })),
    ];

    const otherIds = edges.map((e) => e.otherId);
    const others = await this.issueModel
      .find({ _id: { $in: otherIds } }, ISSUE_CARD_FIELDS)
      .lean();
    const byId = new Map(others.map((o) => [String(o._id), o]));

    const grouped: Record<string, unknown[]> = {};
    for (const edge of edges) {
      const issue = byId.get(String(edge.otherId));
      if (!issue) continue; // target was deleted; skip the dangling edge
      (grouped[edge.type] ??= []).push({
        relationId: edge.relationId,
        issue,
      });
    }
    return grouped;
  }

  async addRelation(
    userId: string,
    sourceId: string,
    targetId: string,
    type: RelationType,
  ) {
    if (sourceId === targetId) {
      throw new BadRequestException('An issue cannot relate to itself');
    }
    // Both ends must be visible to the caller.
    await this.issues.byId(userId, sourceId);
    await this.issues.byId(userId, targetId);

    try {
      const rel = await this.relModel.create({
        sourceId: oid(sourceId),
        targetId: oid(targetId),
        type,
        createdBy: oid(userId),
      });
      return rel.toObject();
    } catch (err: unknown) {
      // Unique index (source, target, type): the relation already exists.
      if ((err as { code?: number })?.code === 11000) {
        throw new BadRequestException('That relation already exists');
      }
      throw err;
    }
  }

  async removeRelation(userId: string, relationId: string) {
    const rel = await this.relModel.findById(relationId);
    if (!rel) throw new NotFoundException('Relation not found');
    // Access is checked against either endpoint — being able to see one issue in
    // the pair is enough to unlink it.
    await this.issues.byId(userId, String(rel.sourceId));
    await rel.deleteOne();
    return { ok: true };
  }
}
