import type { AuthUserPayload } from '../../common/decorators/current-user.decorator';

/**
 * Blast-radius tiers (ADR 0015 §2.2). The tier a tool carries decides both
 * whether it may run on a given surface and whether it executes at all.
 *
 * - `read`   — no mutation.
 * - `A`      — one reversible record. Auto-executes.
 * - `B`      — many records in one call. Auto-executes, capped, and every id
 *              must have appeared in a previous tool result (§2.3).
 * - `C`      — destructive or outward-facing. NEVER executes: returns a
 *              `pendingAction` for a human to confirm through the ordinary
 *              REST route (§2.2).
 */
export type ToolTier = 'read' | 'A' | 'B' | 'C';

/**
 * Where the conversation is happening. This is a containment boundary, not a
 * presentation detail — see {@link TIERS_BY_SURFACE}.
 */
export type ToolSurface = 'web' | 'telegram';

/**
 * Which tiers each surface may use.
 *
 * Telegram gets read + Tier A only (ADR 0015 §2.4): the confirmation UI Tier C
 * depends on does not exist there, and a bridged group has no reliable way to
 * prove *which* member pressed what.
 */
export const TIERS_BY_SURFACE: Record<ToolSurface, ToolTier[]> = {
  web: ['read', 'A', 'B', 'C'],
  telegram: ['read', 'A'],
};

/** Same 100-id ceiling as `POST /issues/bulk` — the tool inherits it (§2.3). */
export const BULK_TOOL_CAP = 100;

const OBJECT_ID_ANYWHERE = /[0-9a-fA-F]{24}/g;
const OBJECT_ID_EXACT = /^[0-9a-fA-F]{24}$/;

export const isObjectId = (v: unknown): v is string =>
  typeof v === 'string' && OBJECT_ID_EXACT.test(v);

/**
 * One conversation's tool state.
 *
 * Its job is the §2.3 id rule: a multi-object tool may only act on ids that
 * already appeared in a tool result **in this conversation**. The model never
 * synthesises an id. Per-issue authorization would refuse a guessed id anyway,
 * but without this rule the refusal itself is a free existence oracle — try
 * ObjectIds until one comes back "no access" instead of "not found".
 *
 * Ids are harvested from the serialized result of every successful tool call,
 * and seeded from previous turns (persisted on `AssistantMessage.toolIds`) so
 * the rule spans the conversation rather than a single request.
 */
export class ToolSession {
  private readonly seen = new Set<string>();

  readonly surface: ToolSurface;
  /**
   * Telegram only: the project the bridged channel belongs to. Every tool is
   * pinned to it, because the reply is visible to the whole group including
   * members who are not Prism users at all (§2.4).
   */
  readonly projectScope: string | null;
  readonly conversationId: string | null;

  constructor(opts: {
    surface: ToolSurface;
    projectScope?: string | null;
    conversationId?: string | null;
    seedIds?: string[];
  }) {
    this.surface = opts.surface;
    this.projectScope = opts.projectScope ?? null;
    this.conversationId = opts.conversationId ?? null;
    for (const id of opts.seedIds ?? []) this.seen.add(id);
  }

  allows(tier: ToolTier): boolean {
    return TIERS_BY_SURFACE[this.surface].includes(tier);
  }

  /** Record every id a tool result handed to the model. */
  observe(content: string): void {
    for (const match of content.match(OBJECT_ID_ANYWHERE) ?? []) {
      this.seen.add(match.toLowerCase());
    }
  }

  hasSeen(id: string): boolean {
    return this.seen.has(String(id).toLowerCase());
  }

  /** Persisted on the assistant turn so the next turn starts where this ended. */
  seenIds(): string[] {
    return [...this.seen];
  }
}

/** Everything a tool needs about who is asking and under what constraints. */
export interface ToolContext {
  user: AuthUserPayload;
  session: ToolSession;
}
