import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { WikiPage, WikiPageDocument } from './schemas/wiki-page.schema';
import {
  ListWikiQuery,
  SaveWikiDto,
  UpdateWikiDto,
} from './dto/wiki.dto';
import { ProjectAccessService } from '../projects/access/project-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  extractMentionTokens,
  newMentions,
} from '../notifications/mentions.util';
import { UsersService } from '../users/users.service';
// Hoisted to common/ by ADR 0012 §2 so views + projects mint the same grammar.
import { anchorFor, PublishOptionsDto } from '../../common/anchor.util';

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : null;

@Injectable()
export class WikiService {
  constructor(
    @InjectModel(WikiPage.name)
    private model: Model<WikiPageDocument>,
    private access: ProjectAccessService,
    private notifs: NotificationsService,
    private users: UsersService,
  ) {}

  private async pushWikiMentions(
    tokens: string[],
    actorId: string,
    title: string,
    pageId: string,
  ) {
    if (tokens.length === 0) return;
    const users = await this.users.findByEmailLocalParts(tokens);
    const recipients = users.map((u) => u.id).filter((uid) => uid !== actorId);
    if (recipients.length === 0) return;
    await this.notifs.pushMany(recipients, {
      actorId,
      type: 'wiki_mention',
      title: 'You were mentioned',
      subject: title,
      link: '/wiki',
      entityRef: { kind: 'wiki', id: pageId },
    });
  }

  /**
   * List page metadata the caller can read (read gate per ADR 0011 context
   * #3). `projectId` alone → that project's pages, gated by the canonical
   * read rule — an unreadable project yields an empty list, consistent with
   * the list-filter convention (ADR 0011 §2c). `workspaceId` → pages across
   * `readableProjectIdsInWorkspace`; with both, the project must also sit in
   * that readable set.
   */
  async list(userId: string, q: ListWikiQuery) {
    let projectIds: Types.ObjectId[];
    if (q.workspaceId) {
      const inWorkspace = await this.access.readableProjectIdsInWorkspace(
        userId,
        q.workspaceId,
      );
      projectIds = q.projectId
        ? inWorkspace.filter((id) => String(id) === q.projectId)
        : inWorkspace;
    } else {
      // The DTO refine guarantees projectId is present on this branch.
      projectIds = (await this.access.canReadProjectById(userId, q.projectId))
        ? [new Types.ObjectId(q.projectId as string)]
        : [];
    }
    const filter: FilterQuery<WikiPageDocument> = {
      projectId: { $in: projectIds },
    };
    if (q.q) filter.title = { $regex: q.q, $options: 'i' };
    return this.model
      .find(filter, { content: 0 })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async byId(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const page = await this.model.findById(id).lean();
    if (!page) throw new NotFoundException();
    // 404 — not 403 — on an unreadable project so a page id can't be used to
    // probe existence (ADR 0004/0005 convention, applied per ADR 0011).
    if (!(await this.access.canReadProjectById(userId, page.projectId))) {
      throw new NotFoundException();
    }
    return page;
  }

  /**
   * Title/content search for the AI assistant's `search_wiki` tool. Regex-matches
   * a small candidate set, then filters to pages the caller can actually read
   * (reusing {@link accessFor}) so tool results never leak private-project pages.
   */
  async searchForAssistant(
    userId: string,
    q: string,
    limit = 8,
  ): Promise<{ id: string; title: string; projectId: string }[]> {
    const term = q.trim();
    if (!term) return [];
    const rx = { $regex: term, $options: 'i' };
    const candidates = await this.model
      .find({ $or: [{ title: rx }, { content: rx }] }, { title: 1, projectId: 1 })
      .sort({ updatedAt: -1 })
      .limit(limit * 4)
      .lean();

    const out: { id: string; title: string; projectId: string }[] = [];
    for (const page of candidates) {
      if (out.length >= limit) break;
      try {
        const { canRead } = await this.accessFor(userId, String(page._id));
        if (canRead) {
          out.push({
            id: String(page._id),
            title: page.title,
            projectId: String(page.projectId),
          });
        }
      } catch {
        // accessFor throws NotFound for a missing project/page — skip it.
      }
    }
    return out;
  }

  async create(authorId: string, dto: SaveWikiDto) {
    // Creating a page requires membership of its project (ADR 0005).
    await this.access.assertProjectWritable(authorId, dto.projectId);
    const page = await this.model.create({
      projectId: new Types.ObjectId(dto.projectId),
      title: dto.title,
      content: dto.content,
      parentId: oid(dto.parentId),
      authorId: new Types.ObjectId(authorId),
      coverImage: dto.coverImage ?? null,
    });
    await this.pushWikiMentions(
      extractMentionTokens(page.content),
      authorId,
      page.title,
      String(page._id),
    );
    return page;
  }

  async update(authorId: string, id: string, dto: UpdateWikiDto) {
    const page = await this.model.findById(id);
    if (!page) throw new NotFoundException();
    // Write requires project membership or being the page author (ADR 0005).
    await this.access.assertCanWrite(
      authorId,
      page.projectId,
      String(page.authorId) === authorId,
    );
    const prevContent = page.content;
    if (dto.title !== undefined) page.title = dto.title;
    if (dto.content !== undefined) page.content = dto.content;
    if ('parentId' in dto) page.parentId = oid(dto.parentId);
    // `!== undefined`, not truthy: null is a meaningful value (clears the cover).
    if (dto.coverImage !== undefined) page.coverImage = dto.coverImage;
    const saved = await page.save();
    if (dto.content !== undefined && dto.content !== prevContent) {
      await this.pushWikiMentions(
        newMentions(prevContent, saved.content),
        authorId,
        saved.title,
        String(saved._id),
      );
    }
    return saved;
  }

  /**
   * Authorization for the live server (ADR §1). Delegates to the shared
   * {@link ProjectAccessService} (ADR 0004) so read follows the one canonical
   * rule: owner OR member OR internal/public visibility within a workspace the
   * caller belongs to. Write additionally requires actual membership
   * (owner/member). Throws NotFound (→ 404, which the caller treats as reject).
   */
  async accessFor(
    userId: string,
    pageId: string,
  ): Promise<{ canRead: boolean; canWrite: boolean }> {
    if (!Types.ObjectId.isValid(pageId)) throw new NotFoundException();
    const page = await this.model
      .findById(pageId, { projectId: 1 })
      .lean();
    if (!page) throw new NotFoundException();

    const project = await this.access.getAccessFields(page.projectId);
    if (!project) throw new NotFoundException();

    // Write requires actual membership; read additionally allows internal/public
    // visibility, now scoped to the caller's workspaces (ADR 0004).
    const canWrite = this.access.isProjectMember(userId, project);
    const canRead = await this.access.canReadProject(userId, project);
    return { canRead, canWrite };
  }

  /**
   * Machine write of `content` from the debounced Yjs snapshot (ADR §4).
   * Deliberately bypasses the mention/notification side-effects of `update()`
   * — snapshots are not user edits. `editedBy` is accepted for attribution but
   * not persisted (WikiPage has no such field; kept cheap per ADR).
   */
  async snapshotContent(
    id: string,
    content: string,
    _editedBy?: string,
  ): Promise<{ ok: boolean; updatedAt: string }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const page = await this.model.findByIdAndUpdate(
      id,
      { $set: { content } },
      { new: true, timestamps: true },
    );
    if (!page) throw new NotFoundException();
    const updatedAt = page.get('updatedAt') as Date;
    return { ok: true, updatedAt: updatedAt.toISOString() };
  }

  /**
   * Publish a page to the public Space (ADR 0002 §3). Requires write access
   * (owner/member via `accessFor`). Mints a stable `anchor` on first publish and
   * reuses it thereafter. Returns the public publish state.
   */
  async publish(userId: string, id: string, opts: PublishOptionsDto = {}) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const { canWrite } = await this.accessFor(userId, id);
    if (!canWrite) throw new ForbiddenException();

    const page = await this.model.findById(id);
    if (!page) throw new NotFoundException();

    if (!page.anchor) page.anchor = anchorFor(page.title);
    page.isPublic = true;
    page.publishedAt = new Date();
    page.publishedBy = new Types.ObjectId(userId);
    // Only an explicit boolean moves it: re-publishing is how an owner refreshes
    // a page, and that must not quietly re-open a page to crawlers.
    if (opts.indexing !== undefined) page.publicIndexing = opts.indexing;
    const saved = await page.save();

    return {
      anchor: saved.anchor,
      isPublic: saved.isPublic,
      publishedAt: saved.publishedAt,
      indexing: saved.publicIndexing,
    };
  }

  /**
   * Unpublish a page (ADR 0002 §3). Keeps the `anchor` so a later re-publish
   * yields the same URL. Requires write access.
   */
  async unpublish(userId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException();
    const { canWrite } = await this.accessFor(userId, id);
    if (!canWrite) throw new ForbiddenException();

    const page = await this.model.findByIdAndUpdate(
      id,
      { $set: { isPublic: false } },
      { new: true },
    );
    if (!page) throw new NotFoundException();
    return { isPublic: page.isPublic };
  }

  async remove(authorId: string, userRole: string, id: string) {
    const page = await this.model.findById(id);
    if (!page) throw new NotFoundException();
    if (String(page.authorId) !== authorId && userRole !== 'admin')
      throw new ForbiddenException();
    await this.model.updateMany(
      { parentId: page._id },
      { $set: { parentId: null } },
    );
    await page.deleteOne();
    return { ok: true };
  }
}
