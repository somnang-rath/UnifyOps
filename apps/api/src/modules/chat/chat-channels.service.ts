import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatChannel,
  ChatChannelDocument,
} from './schemas/chat-channel.schema';
import {
  ChatReadState,
  ChatReadStateDocument,
} from './schemas/chat-read-state.schema';
import { TelegramLink, TelegramLinkDocument } from './schemas/telegram-link.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ChatAccessService } from './access/chat-access.service';
import { ProjectAccessService } from '../projects/access/project-access.service';
import type {
  ChannelMembersDto,
  CreateChannelDto,
  ListChannelQuery,
  OpenDmDto,
  UpdateChannelDto,
} from './dto/chat.dto';

/** The shape the web app renders. DM names are derived here, not stored. */
export interface ChannelView {
  _id: string;
  workspaceId: string;
  kind: 'channel' | 'dm';
  name: string;
  slug?: string;
  topic: string;
  visibility: 'public' | 'private';
  archived: boolean;
  memberIds: string[];
  isMember: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
  unreadCount: number;
  unreadMentionCount: number;
  muted: boolean;
  telegram: { linked: boolean; active: boolean; chatTitle: string } | null;
  /** DMs only: the other participant, for avatar + display name. */
  peer?: { _id: string; name: string; avatar?: string };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'channel'
  );
}

@Injectable()
export class ChatChannelsService {
  constructor(
    @InjectModel(ChatChannel.name)
    private channelModel: Model<ChatChannelDocument>,
    @InjectModel(ChatReadState.name)
    private readStateModel: Model<ChatReadStateDocument>,
    @InjectModel(TelegramLink.name)
    private linkModel: Model<TelegramLinkDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private access: ChatAccessService,
    private projectAccess: ProjectAccessService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────

  async list(userId: string, query: ListChannelQuery): Promise<ChannelView[]> {
    await this.projectAccess.assertWorkspaceMember(userId, query.workspaceId);
    const me = new Types.ObjectId(userId);
    const wsId = new Types.ObjectId(query.workspaceId);

    const filter: Record<string, unknown> = { workspaceId: wsId };
    if (!query.includeArchived) filter.archived = false;

    // `mine` = channels I'm in. `all` also surfaces joinable public channels, but
    // never another user's DMs or a private channel I'm not in.
    filter.$or =
      query.scope === 'all'
        ? [{ memberIds: me }, { kind: 'channel', visibility: 'public' }]
        : [{ memberIds: me }];

    const channels = await this.channelModel
      .find(filter)
      .sort({ lastMessageAt: -1 })
      .limit(500)
      .lean();

    return this.toViews(userId, channels as ChatChannel[]);
  }

  async byId(userId: string, channelId: string): Promise<ChannelView> {
    const channel = await this.access.assertCanRead(userId, channelId);
    const [view] = await this.toViews(userId, [channel.toObject()]);
    return view;
  }

  // ── Writes ────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateChannelDto): Promise<ChannelView> {
    await this.projectAccess.assertWorkspaceMember(userId, dto.workspaceId);
    const me = new Types.ObjectId(userId);

    // The creator is always a member — otherwise they'd create a channel they
    // can't post in.
    const memberIds = Array.from(
      new Set([userId, ...dto.memberIds].map(String)),
    ).map((id) => new Types.ObjectId(id));

    const base = slugify(dto.name);
    let slug = base;
    for (let n = 2; n < 50; n++) {
      const taken = await this.channelModel.exists({
        workspaceId: dto.workspaceId,
        kind: 'channel',
        slug,
      });
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    const channel = await this.channelModel.create({
      workspaceId: new Types.ObjectId(dto.workspaceId),
      kind: 'channel',
      name: dto.name,
      slug,
      topic: dto.topic,
      visibility: dto.visibility,
      createdBy: me,
      memberIds,
      lastMessageAt: new Date(),
    });

    await this.ensureReadStates(channel, memberIds);
    const [view] = await this.toViews(userId, [channel.toObject()]);
    return view;
  }

  async update(
    userId: string,
    channelId: string,
    dto: UpdateChannelDto,
  ): Promise<ChannelView> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM cannot be renamed or reconfigured');
    }
    if (dto.name !== undefined) channel.name = dto.name;
    if (dto.topic !== undefined) channel.topic = dto.topic;
    if (dto.visibility !== undefined) channel.visibility = dto.visibility;
    if (dto.archived !== undefined) channel.archived = dto.archived;
    await channel.save();
    const [view] = await this.toViews(userId, [channel.toObject()]);
    return view;
  }

  /** Archive, never hard-delete: messages may have been relayed and must stay resolvable. */
  async archive(userId: string, channelId: string): Promise<{ ok: true }> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM cannot be archived');
    }
    channel.archived = true;
    await channel.save();
    return { ok: true };
  }

  async join(userId: string, channelId: string): Promise<ChannelView> {
    const channel = await this.access.assertCanRead(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM has a fixed member list');
    }
    if (channel.visibility === 'private') {
      // assertCanRead already proved membership for a private channel, so reaching
      // here means they're in it. Nothing to do.
      throw new ForbiddenException('Private channels are invite-only');
    }
    const me = new Types.ObjectId(userId);
    if (!this.access.isChannelMember(userId, channel)) {
      channel.memberIds.push(me);
      await channel.save();
      await this.ensureReadStates(channel, [me]);
    }
    const [view] = await this.toViews(userId, [channel.toObject()]);
    return view;
  }

  async leave(userId: string, channelId: string): Promise<{ ok: true }> {
    const channel = await this.access.assertCanRead(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM cannot be left');
    }
    channel.memberIds = channel.memberIds.filter(
      (m) => String(m) !== String(userId),
    );
    await channel.save();
    await this.readStateModel.deleteOne({
      userId: new Types.ObjectId(userId),
      channelId: channel._id,
    });
    return { ok: true };
  }

  async addMembers(
    userId: string,
    channelId: string,
    dto: ChannelMembersDto,
  ): Promise<ChannelView> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM has a fixed member list');
    }
    // Every invitee must already belong to the workspace — the channel must not
    // become a way to pull an outsider into workspace content (ADR 0005).
    const added: Types.ObjectId[] = [];
    for (const id of dto.userIds) {
      if (!(await this.projectAccess.isWorkspaceMember(id, channel.workspaceId)))
        continue;
      if (this.access.isChannelMember(id, channel)) continue;
      const oid = new Types.ObjectId(id);
      channel.memberIds.push(oid);
      added.push(oid);
    }
    await channel.save();
    if (added.length) await this.ensureReadStates(channel, added);
    const [view] = await this.toViews(userId, [channel.toObject()]);
    return view;
  }

  async removeMember(
    userId: string,
    channelId: string,
    targetId: string,
  ): Promise<{ ok: true }> {
    const channel = await this.access.assertCanWrite(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A DM has a fixed member list');
    }
    channel.memberIds = channel.memberIds.filter(
      (m) => String(m) !== String(targetId),
    );
    await channel.save();
    await this.readStateModel.deleteOne({
      userId: new Types.ObjectId(targetId),
      channelId: channel._id,
    });
    return { ok: true };
  }

  /**
   * Find-or-create a DM. Idempotent by construction: the unique index on `dmKey`
   * turns a simultaneous open by both participants into one upsert winner rather
   * than two duplicate DMs.
   */
  async openDm(userId: string, dto: OpenDmDto): Promise<ChannelView> {
    await this.projectAccess.assertWorkspaceMember(userId, dto.workspaceId);
    if (String(dto.userId) === String(userId)) {
      throw new BadRequestException('Cannot open a DM with yourself');
    }
    if (!(await this.projectAccess.isWorkspaceMember(dto.userId, dto.workspaceId))) {
      throw new NotFoundException();
    }

    const ids = [String(userId), String(dto.userId)].sort();
    const dmKey = `${dto.workspaceId}:${ids.join('|')}`;
    const memberIds = ids.map((id) => new Types.ObjectId(id));

    const channel = await this.channelModel.findOneAndUpdate(
      { dmKey },
      {
        $setOnInsert: {
          workspaceId: new Types.ObjectId(dto.workspaceId),
          kind: 'dm',
          name: '',
          topic: '',
          visibility: 'private',
          createdBy: new Types.ObjectId(userId),
          memberIds,
          dmKey,
          lastMessageAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    await this.ensureReadStates(channel, memberIds);
    const [view] = await this.toViews(userId, [channel.toObject()]);
    return view;
  }

  // ── Helpers shared with the messages service ──────────────────────

  async ensureReadStates(
    channel: ChatChannelDocument,
    userIds: Types.ObjectId[],
  ): Promise<void> {
    if (!userIds.length) return;
    await this.readStateModel.bulkWrite(
      userIds.map((uid) => ({
        updateOne: {
          filter: { userId: uid, channelId: channel._id },
          update: {
            $setOnInsert: {
              userId: uid,
              channelId: channel._id,
              workspaceId: channel.workspaceId,
              unreadCount: 0,
              unreadMentionCount: 0,
              muted: false,
            },
          },
          upsert: true,
        },
      })),
    );
  }

  /** Hydrate raw channels into the view shape: read state, DM peer, Telegram status. */
  private async toViews(
    userId: string,
    channels: ChatChannel[],
  ): Promise<ChannelView[]> {
    if (!channels.length) return [];
    const ids = channels.map((c) => (c as ChatChannelDocument)._id);

    const [states, links] = await Promise.all([
      this.readStateModel
        .find({ userId: new Types.ObjectId(userId), channelId: { $in: ids } })
        .lean(),
      this.linkModel.find({ channelId: { $in: ids } }).lean(),
    ]);
    const stateBy = new Map(states.map((s) => [String(s.channelId), s]));
    const linkBy = new Map(links.map((l) => [String(l.channelId), l]));

    // One query for every DM peer across the whole list, rather than per channel.
    const peerIds = new Set<string>();
    for (const c of channels) {
      if (c.kind !== 'dm') continue;
      for (const m of c.memberIds ?? []) {
        if (String(m) !== String(userId)) peerIds.add(String(m));
      }
    }
    const peers = peerIds.size
      ? await this.userModel
          .find({ _id: { $in: [...peerIds] } }, { name: 1, avatar: 1 })
          .lean()
      : [];
    const peerBy = new Map(peers.map((p) => [String(p._id), p]));

    return channels.map((c) => {
      const doc = c as ChatChannelDocument;
      const key = String(doc._id);
      const state = stateBy.get(key);
      const link = linkBy.get(key);

      let peer: ChannelView['peer'];
      let name = c.name;
      if (c.kind === 'dm') {
        const otherId = (c.memberIds ?? [])
          .map(String)
          .find((m) => m !== String(userId));
        const p = otherId ? peerBy.get(otherId) : undefined;
        if (p) {
          peer = { _id: String(p._id), name: p.name, avatar: p.avatar };
          name = p.name;
        }
      }

      return {
        _id: key,
        workspaceId: String(c.workspaceId),
        kind: c.kind,
        name,
        slug: c.slug,
        topic: c.topic,
        visibility: c.visibility,
        archived: c.archived,
        memberIds: (c.memberIds ?? []).map(String),
        isMember: (c.memberIds ?? []).some((m) => String(m) === String(userId)),
        lastMessageAt: new Date(c.lastMessageAt).toISOString(),
        lastMessagePreview: c.lastMessagePreview,
        messageCount: c.messageCount,
        unreadCount: state?.unreadCount ?? 0,
        unreadMentionCount: state?.unreadMentionCount ?? 0,
        muted: state?.muted ?? false,
        telegram: link
          ? {
              linked: Boolean(link.chatId),
              active: link.active,
              chatTitle: link.chatTitle,
            }
          : null,
        peer,
      };
    });
  }
}
