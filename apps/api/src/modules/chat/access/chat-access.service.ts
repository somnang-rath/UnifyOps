import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ChatChannel,
  ChatChannelDocument,
} from '../schemas/chat-channel.schema';
import {
  Workspace,
  WorkspaceDocument,
} from '../../workspaces/schemas/workspace.schema';
import { ProjectAccessService } from '../../projects/access/project-access.service';

/**
 * The single source of truth for chat channel access (ADR 0007 §2). A leaf that
 * depends only on the ChatChannel + Workspace models and ProjectAccessService, so
 * any chat service — including the gateway — can import it without a cycle.
 *
 * Every method throws 404 rather than 403 for a non-member of the workspace, so a
 * channel id can't be used to probe for the existence of other workspaces' channels.
 */
@Injectable()
export class ChatAccessService {
  constructor(
    @InjectModel(ChatChannel.name)
    private channelModel: Model<ChatChannelDocument>,
    @InjectModel(Workspace.name)
    private workspaceModel: Model<WorkspaceDocument>,
    private projectAccess: ProjectAccessService,
  ) {}

  isChannelMember(userId: string, channel: ChatChannel): boolean {
    const uid = String(userId);
    return (channel.memberIds ?? []).some((m) => String(m) === uid);
  }

  /**
   * Read rule: workspace membership is required for everything. Beyond that a
   * public channel is readable by any workspace member; a private channel or DM
   * requires being in `memberIds`.
   */
  async canRead(userId: string, channel: ChatChannel): Promise<boolean> {
    if (!(await this.projectAccess.isWorkspaceMember(userId, channel.workspaceId)))
      return false;
    if (channel.kind === 'dm' || channel.visibility === 'private') {
      return this.isChannelMember(userId, channel);
    }
    return true;
  }

  /** Load + assert read access in one step. Callers get a hydrated channel back. */
  async assertCanRead(
    userId: string,
    channelId: string,
  ): Promise<ChatChannelDocument> {
    if (!Types.ObjectId.isValid(channelId)) throw new NotFoundException();
    const channel = await this.channelModel.findById(channelId);
    if (!channel) throw new NotFoundException();
    if (!(await this.canRead(userId, channel))) throw new NotFoundException();
    return channel;
  }

  /**
   * Write rule (posting, reacting, editing the channel): read access plus actual
   * membership. Reading a public channel you haven't joined does not let you post
   * to it — join first.
   */
  async assertCanWrite(
    userId: string,
    channelId: string,
  ): Promise<ChatChannelDocument> {
    const channel = await this.assertCanRead(userId, channelId);
    if (channel.archived) throw new ForbiddenException('Channel is archived');
    if (!this.isChannelMember(userId, channel)) {
      throw new ForbiddenException('Join the channel first');
    }
    return channel;
  }

  /**
   * Linking a channel to Telegram moves data off the instance (ADR 0007), so it is
   * restricted to the workspace owner. There is no workspace role model beyond
   * owner+members today, which makes this the only enforceable non-trivial answer.
   */
  async assertWorkspaceOwner(
    userId: string,
    workspaceId: Types.ObjectId | string,
  ): Promise<void> {
    const isOwner = await this.workspaceModel.exists({
      _id: workspaceId,
      ownerId: new Types.ObjectId(userId),
    });
    if (!isOwner) {
      throw new ForbiddenException('Only the workspace owner can do this');
    }
  }
}
