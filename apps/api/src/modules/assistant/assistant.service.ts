import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  AiConfig,
  InstanceService,
} from '../instance/instance.service';
import {
  AssistantConversation,
  AssistantConversationDocument,
} from './schemas/assistant-conversation.schema';
import {
  AssistantMessage,
  AssistantMessageDocument,
} from './schemas/assistant-message.schema';
import { AuthUserPayload } from '../../common/decorators/current-user.decorator';
import { ChatContextDto, ChatDto } from './dto/assistant.dto';
import { IssuesService } from '../issues/issues.service';
import { WikiService } from '../wiki/wiki.service';
import { buildOpenAiTools, buildTools, runTool, ToolDeps } from './tools';

const oid = (v: string) => new Types.ObjectId(v);
const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const RATE_WINDOW_MS = 60_000;
const MAX_TOOL_ITERATIONS = 8;

interface RateState {
  limit: number;
  remaining: number;
  resetAt: number;
}

/** Everything a provider streaming loop needs to run one `chat()` request. */
interface LoopParams {
  cfg: AiConfig;
  apiKey: string;
  model: string;
  system: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  user: AuthUserPayload;
  deps: ToolDeps;
  res: Response;
}

/** Accumulated output of a provider loop, persisted as one assistant turn. */
interface LoopResult {
  full: string;
  totalIn: number;
  totalOut: number;
  toolTrace: { name: string; input: Record<string, unknown>; ok: boolean }[];
}

@Injectable()
export class AssistantService {
  /** Per-user request timestamps for the sliding-window rate limiter. */
  private readonly hits = new Map<string, number[]>();

  constructor(
    @InjectModel(AssistantConversation.name)
    private conversations: Model<AssistantConversationDocument>,
    @InjectModel(AssistantMessage.name)
    private messages: Model<AssistantMessageDocument>,
    private instance: InstanceService,
    private issues: IssuesService,
    private wiki: WikiService,
  ) {}

  // ── Public, non-secret config (drives the web assistant UI) ─────────
  async publicConfig() {
    const cfg = await this.instance.getAiConfig();
    const model =
      cfg.provider === 'openai' ? cfg.openai.model : cfg.anthropic.model;
    const hasKey =
      cfg.provider === 'openai'
        ? Boolean(cfg.openai.apiKey)
        : Boolean(cfg.anthropic.apiKey);
    return {
      enabled: cfg.enabled && hasKey,
      provider: cfg.provider,
      model,
      allowTools: cfg.allowTools,
    };
  }

  /** Remaining per-user rate budget + optional conversation token totals. */
  async usage(userId: string, conversationId?: string) {
    const cfg = await this.instance.getAiConfig();
    const rate = this.peekRate(userId, cfg.rateLimitPerMin);
    let conversation:
      | { totalTokens: number; totalInputTokens: number }
      | undefined;
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      const conv = await this.conversations
        .findOne({ _id: oid(conversationId), ownerId: oid(userId) })
        .lean();
      if (conv) {
        conversation = {
          totalTokens: conv.totalTokens ?? 0,
          totalInputTokens: conv.totalInputTokens ?? 0,
        };
      }
    }
    return { ...rate, conversation };
  }

  // ── Conversation CRUD ───────────────────────────────────────────────
  async listConversations(userId: string) {
    return this.conversations
      .find({ ownerId: oid(userId) })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async getConversation(userId: string, id: string) {
    const conversation = await this.conversations
      .findOne({ _id: oid(id), ownerId: oid(userId) })
      .lean();
    if (!conversation) throw new NotFoundException('Conversation not found');
    const messages = await this.messages
      .find({ conversationId: oid(id) })
      .sort({ createdAt: 1 })
      .lean();
    return { conversation, messages };
  }

  async renameConversation(userId: string, id: string, title: string) {
    const res = await this.conversations.findOneAndUpdate(
      { _id: oid(id), ownerId: oid(userId) },
      { $set: { title } },
      { new: true },
    );
    if (!res) throw new NotFoundException('Conversation not found');
    return res;
  }

  async deleteConversation(userId: string, id: string) {
    const res = await this.conversations.deleteOne({
      _id: oid(id),
      ownerId: oid(userId),
    });
    if (res.deletedCount === 0)
      throw new NotFoundException('Conversation not found');
    await this.messages.deleteMany({ conversationId: oid(id) });
    return { ok: true };
  }

  // ── Rate limiting (dynamic, per-user sliding window) ────────────────
  private prune(userId: string): number[] {
    const now = Date.now();
    const kept = (this.hits.get(userId) ?? []).filter(
      (t) => now - t < RATE_WINDOW_MS,
    );
    this.hits.set(userId, kept);
    return kept;
  }

  /** Report the current budget without consuming it. */
  private peekRate(userId: string, limit: number): RateState {
    const kept = this.prune(userId);
    const resetAt =
      kept.length > 0 ? kept[0] + RATE_WINDOW_MS : Date.now() + RATE_WINDOW_MS;
    return { limit, remaining: Math.max(0, limit - kept.length), resetAt };
  }

  /** Record a request, throwing 429 if over the configured per-minute limit. */
  private consumeRate(userId: string, limit: number): RateState {
    const kept = this.prune(userId);
    if (kept.length >= limit) {
      const resetAt = kept[0] + RATE_WINDOW_MS;
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Assistant rate limit reached — try again shortly.',
          resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    kept.push(Date.now());
    this.hits.set(userId, kept);
    const resetAt = kept[0] + RATE_WINDOW_MS;
    return { limit, remaining: Math.max(0, limit - kept.length), resetAt };
  }

  // ── Streaming chat (SSE) ────────────────────────────────────────────
  async chat(user: AuthUserPayload, dto: ChatDto, res: Response) {
    const cfg = await this.instance.getAiConfig();
    if (!cfg.enabled) {
      throw new ForbiddenException('The AI assistant is disabled');
    }
    const isOpenAi = cfg.provider === 'openai';
    const apiKey = isOpenAi ? cfg.openai.apiKey : cfg.anthropic.apiKey;
    if (!apiKey) {
      throw new ForbiddenException(
        isOpenAi
          ? 'No OpenAI API key configured (set it in God Mode → AI)'
          : 'No Anthropic API key configured (set it in God Mode → AI)',
      );
    }

    // Enforce the per-user rate limit *before* creating the conversation or
    // sending SSE headers (so a 429 is a clean HTTP error, not an SSE event).
    const rate = this.consumeRate(user.id, cfg.rateLimitPerMin);

    // Resolve or create the conversation.
    const conversation = dto.conversationId
      ? await this.conversations.findOne({
          _id: oid(dto.conversationId),
          ownerId: oid(user.id),
        })
      : await this.conversations.create({
          ownerId: oid(user.id),
          title: dto.message.slice(0, 60).trim() || 'New chat',
        });
    if (!conversation) throw new NotFoundException('Conversation not found');

    // Persist the user turn, then load the full history to send.
    await this.messages.create({
      conversationId: conversation._id,
      ownerId: oid(user.id),
      role: 'user',
      content: dto.message,
    });
    const history = await this.messages
      .find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .lean();

    const model =
      dto.model || (isOpenAi ? cfg.openai.model : cfg.anthropic.model);
    const system = this.buildSystemPrompt(cfg, dto.context);
    const deps: ToolDeps = { issues: this.issues, wiki: this.wiki };

    // Begin the SSE response. Past this point, surface failures as SSE
    // `error` events rather than throwing (headers are already sent).
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(
      sse('meta', {
        conversationId: String(conversation._id),
        model,
        rateLimit: { limit: rate.limit, remaining: rate.remaining },
      }),
    );

    const params: LoopParams = {
      cfg,
      apiKey,
      model,
      system,
      history: history.map((m) => ({ role: m.role, content: m.content })),
      user,
      deps,
      res,
    };

    try {
      const result = isOpenAi
        ? await this.runOpenAiLoop(params)
        : await this.runAnthropicLoop(params);

      const saved = await this.messages.create({
        conversationId: conversation._id,
        ownerId: oid(user.id),
        role: 'assistant',
        content: result.full,
        tokens: result.totalOut,
        inputTokens: result.totalIn,
        ...(result.toolTrace.length ? { tools: result.toolTrace } : {}),
      });
      await this.conversations.updateOne(
        { _id: conversation._id },
        {
          $set: { model },
          $inc: {
            totalTokens: result.totalOut,
            totalInputTokens: result.totalIn,
          },
        },
      );

      res.write(
        sse('done', {
          conversationId: String(conversation._id),
          messageId: String(saved._id),
          tokens: result.totalOut,
          inputTokens: result.totalIn,
        }),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Assistant request failed';
      res.write(sse('error', { message }));
    } finally {
      res.end();
    }
  }

  // ── Provider-specific streaming loops ───────────────────────────────
  // Both drive the same SSE events (`delta` / `tool` / `tool_result`) and the
  // same agentic tool loop, returning the accumulated text + token totals so
  // `chat()` can persist one assistant turn regardless of provider.

  private async runAnthropicLoop(p: LoopParams): Promise<LoopResult> {
    const { cfg, apiKey, model, system, user, deps, res } = p;
    const tools = cfg.allowTools ? buildTools() : [];
    const client = new Anthropic({ apiKey });
    const loopMessages: Anthropic.MessageParam[] = p.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // A mutable handle so a client disconnect aborts whichever turn is active.
    let activeStream: ReturnType<typeof client.messages.stream> | null = null;
    res.on('close', () => activeStream?.abort());

    let full = '';
    let totalIn = 0;
    let totalOut = 0;
    const toolTrace: LoopResult['toolTrace'] = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const stream = client.messages.stream({
        model,
        max_tokens: cfg.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: cfg.effort },
        ...(system ? { system } : {}),
        ...(tools.length ? { tools } : {}),
        messages: loopMessages,
      });
      activeStream = stream;
      stream.on('text', (delta) => {
        full += delta;
        res.write(sse('delta', { text: delta }));
      });

      const finalMessage = await stream.finalMessage();
      totalIn += finalMessage.usage?.input_tokens ?? 0;
      totalOut += finalMessage.usage?.output_tokens ?? 0;

      if (finalMessage.stop_reason === 'tool_use') {
        const toolUses = finalMessage.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        loopMessages.push({
          role: 'assistant',
          content: finalMessage.content as Anthropic.ContentBlockParam[],
        });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          const input = (tu.input ?? {}) as Record<string, unknown>;
          res.write(sse('tool', { id: tu.id, name: tu.name, input }));
          const run = await runTool(tu.name, input, user, deps);
          toolTrace.push({ name: tu.name, input, ok: run.ok });
          res.write(sse('tool_result', { id: tu.id, ok: run.ok }));
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: run.content,
            ...(run.ok ? {} : { is_error: true }),
          });
        }
        loopMessages.push({ role: 'user', content: results });
        continue;
      }

      if (finalMessage.stop_reason === 'pause_turn') {
        loopMessages.push({
          role: 'assistant',
          content: finalMessage.content as Anthropic.ContentBlockParam[],
        });
        continue;
      }

      // end_turn / max_tokens / stop_sequence / refusal → terminal.
      break;
    }

    return { full, totalIn, totalOut, toolTrace };
  }

  private async runOpenAiLoop(p: LoopParams): Promise<LoopResult> {
    const { cfg, apiKey, model, system, user, deps, res } = p;
    const tools = cfg.allowTools ? buildOpenAiTools() : [];
    const client = new OpenAI({ apiKey });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const m of p.history) messages.push({ role: m.role, content: m.content });

    // A mutable handle so a client disconnect aborts whichever turn is active.
    let activeAbort: (() => void) | null = null;
    res.on('close', () => activeAbort?.());

    let full = '';
    let totalIn = 0;
    let totalOut = 0;
    const toolTrace: LoopResult['toolTrace'] = [];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const stream = await client.chat.completions.create({
        model,
        max_completion_tokens: cfg.maxTokens,
        ...(tools.length ? { tools } : {}),
        messages,
        stream: true,
        stream_options: { include_usage: true },
      });
      activeAbort = () => stream.controller.abort();

      // Accumulate assistant text and any streamed tool-call fragments, which
      // OpenAI delivers incrementally across chunks (keyed by call index).
      let content = '';
      let finishReason: string | null = null;
      const toolAcc = new Map<
        number,
        { id: string; name: string; args: string }
      >();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta;
        if (delta?.content) {
          content += delta.content;
          full += delta.content;
          res.write(sse('delta', { text: delta.content }));
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const cur = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            toolAcc.set(tc.index, cur);
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          totalIn += chunk.usage.prompt_tokens ?? 0;
          totalOut += chunk.usage.completion_tokens ?? 0;
        }
      }

      if (finishReason === 'tool_calls' && toolAcc.size > 0) {
        const calls = [...toolAcc.values()];
        // Echo the assistant turn (with its tool_calls) back into history.
        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.args || '{}' },
          })),
        });
        for (const c of calls) {
          let input: Record<string, unknown> = {};
          try {
            input = c.args ? JSON.parse(c.args) : {};
          } catch {
            input = {};
          }
          res.write(sse('tool', { id: c.id, name: c.name, input }));
          const run = await runTool(c.name, input, user, deps);
          toolTrace.push({ name: c.name, input, ok: run.ok });
          res.write(sse('tool_result', { id: c.id, ok: run.ok }));
          messages.push({
            role: 'tool',
            tool_call_id: c.id,
            content: run.content,
          });
        }
        continue;
      }

      // stop / length / content_filter → terminal.
      break;
    }

    return { full, totalIn, totalOut, toolTrace };
  }

  private buildSystemPrompt(cfg: AiConfig, context?: ChatContextDto): string {
    const parts: string[] = [];
    if (cfg.systemPrompt) parts.push(cfg.systemPrompt);
    if (context?.type) {
      const header = `The user is currently viewing a ${context.type}${
        context.title ? ` titled "${context.title}"` : ''
      }.`;
      const body = context.text ? `\n\nContent:\n${context.text}` : '';
      parts.push(`${header}${body}`);
    }
    return parts.join('\n\n').trim();
  }
}
