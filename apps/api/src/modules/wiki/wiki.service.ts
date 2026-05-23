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
import { NotificationsService } from '../notifications/notifications.service';
import {
  extractMentionTokens,
  newMentions,
} from '../notifications/mentions.util';
import { UsersService } from '../users/users.service';

const oid = (v?: string | null) =>
  v ? new Types.ObjectId(v) : null;

@Injectable()
export class WikiService {
  constructor(
    @InjectModel(WikiPage.name)
    private model: Model<WikiPageDocument>,
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

  list(q: ListWikiQuery) {
    const filter: FilterQuery<WikiPageDocument> = {
      projectId: new Types.ObjectId(q.projectId),
    };
    if (q.q) filter.title = { $regex: q.q, $options: 'i' };
    return this.model
      .find(filter, { content: 0 })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async byId(id: string) {
    const page = await this.model.findById(id).lean();
    if (!page) throw new NotFoundException();
    return page;
  }

  async create(authorId: string, dto: SaveWikiDto) {
    const page = await this.model.create({
      projectId: new Types.ObjectId(dto.projectId),
      title: dto.title,
      content: dto.content,
      parentId: oid(dto.parentId),
      authorId: new Types.ObjectId(authorId),
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
    const prevContent = page.content;
    if (dto.title !== undefined) page.title = dto.title;
    if (dto.content !== undefined) page.content = dto.content;
    if ('parentId' in dto) page.parentId = oid(dto.parentId);
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
