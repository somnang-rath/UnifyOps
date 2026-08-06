import { Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatChannel } from '../schemas/chat-channel.schema';
import { AssistantService } from '../../assistant/assistant.service';
import { UsersService } from '../../users/users.service';

/** `@prism …` — the only way to address the assistant from a bridged group. */
const MENTION = /^\s*@prism\b[:,]?\s*/i;

/**
 * Said once, publicly, to an unlinked sender. It deliberately reveals nothing:
 * not whether the workspace exists, not what project the channel is about,
 * not who else is in it.
 */
const LINK_INSTRUCTION =
  'I can only help people who have linked their Telegram account to Prism. ' +
  'Open Prism → Settings → Telegram, get a code, then DM me `/verify <code>`.';

const NO_PROJECT =
  'This group is not linked to a project yet, so I have nothing to scope an ' +
  'answer to. A project member can set one on the channel in Prism.';

/**
 * The AI assistant, addressed from a bridged Telegram group (ADR 0015 §2.4).
 *
 * Two rules make this safe, and both are enforced here rather than assumed:
 *
 * 1. **An unlinked sender gets nothing.** `TelegramIdentity.userId` stays null
 *    until a person proves the account is theirs. A Telegram group contains
 *    whoever its admin invited, so treating an unverified member as a workspace
 *    reader would hand a stranger everything a linked colleague can see. They
 *    get {@link LINK_INSTRUCTION} and no data at all.
 *
 * 2. **A linked sender is scoped to the channel's project, not to everything
 *    they can read.** The answer is posted to the group, where unlinked members
 *    will read it too — so a broad question must not be able to pull a private
 *    project into a group chat.
 *
 * Tier B and C tools are off entirely on this surface; that is decided by the
 * `ToolSession`'s surface, so it cannot drift out of sync with this file.
 */
@Injectable()
export class TelegramAssistantService {
  private readonly logger = new Logger(TelegramAssistantService.name);

  constructor(
    private assistant: AssistantService,
    private users: UsersService,
  ) {}

  /** The prompt in an `@prism …` message, or null if it is not addressed to us. */
  static mentionIn(text: string): string | null {
    if (!MENTION.test(text)) return null;
    return text.replace(MENTION, '').trim();
  }

  /**
   * Produce the reply for one `@prism` message. Returns null when there is
   * nothing to say (assistant off, empty prompt) so the caller stays quiet
   * rather than posting noise into a group.
   */
  async reply(opts: {
    channel: ChatChannel;
    prompt: string;
    senderUserId: Types.ObjectId | null;
  }): Promise<string | null> {
    const { channel, prompt, senderUserId } = opts;
    if (!prompt) return null;

    // Rule 1 — identity. Checked before anything is read.
    if (!senderUserId) return LINK_INSTRUCTION;

    // Rule 2 — scope. No project on the channel means no defensible scope,
    // so the assistant does not run (fail closed) rather than falling back to
    // the asking user's full read set.
    const projectScope = channel.projectId ? String(channel.projectId) : null;
    if (!projectScope) return NO_PROJECT;

    const user = await this.users.findById(String(senderUserId));
    if (!user) return LINK_INSTRUCTION;

    try {
      const answer = await this.assistant.runOnSurface({
        user: { id: String(senderUserId), email: user.email, role: user.role },
        surface: 'telegram',
        projectScope,
        message: prompt,
        contextNote:
          'You are replying inside a Telegram group chat that is bridged to a ' +
          'Prism channel. Everyone in the group sees your reply, including ' +
          'people with no Prism account. Every tool you have is already ' +
          'restricted to this channel\'s project — do not discuss anything ' +
          'outside it. Keep replies short and plain-text: no markdown tables, ' +
          'no headings.',
      });
      return answer || null;
    } catch (err) {
      this.logger.warn(`Assistant reply failed: ${String(err)}`);
      return null;
    }
  }
}
