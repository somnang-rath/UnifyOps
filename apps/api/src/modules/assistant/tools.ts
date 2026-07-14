import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { AuthUserPayload } from '../../common/decorators/current-user.decorator';
import { IssuesService } from '../issues/issues.service';
import {
  CreateIssueSchema,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
} from '../issues/dto/issue.dto';
import { WikiService } from '../wiki/wiki.service';

/**
 * Dependencies the agentic tools call into. Each tool re-runs under the calling
 * user's identity so the assistant can never exceed what that user could do in
 * the normal UI (create_issue authors as the user; wiki reads re-check access).
 */
export interface ToolDeps {
  issues: IssuesService;
  wiki: WikiService;
}

/** Outcome of one tool call, relayed to the model as a `tool_result` block. */
export interface ToolRun {
  ok: boolean;
  content: string;
}

/** A provider-neutral tool definition (name + description + JSON-schema input). */
interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Canonical, provider-neutral tool definitions, exposed only when the instance
 * admin enabled `ASSISTANT_ALLOW_TOOLS`. Raw JSON schema (the API has no Zod
 * dependency). {@link buildTools} / {@link buildOpenAiTools} adapt these to each
 * provider's wire format so the two loops stay in sync.
 */
const TOOL_DEFS: ToolDef[] = [
  {
    name: 'search_issues',
    description:
      'Search the workspace issues/tasks by keyword. Use when the user asks ' +
      'about existing tasks, bugs, or work items. Returns a short list.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match in title/description' },
        projectId: { type: 'string', description: '24-hex project id to scope to (optional)' },
        status: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by open/closed (default all)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_wiki',
    description:
      'Search wiki pages by keyword in their title or content. Use when the ' +
      'user asks about documentation or notes. Returns matching page ids/titles.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_wiki_page',
    description:
      'Fetch the full content of one wiki page by id (e.g. from search_wiki) ' +
      'to summarize or answer questions about it.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '24-hex wiki page id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_issue',
    description:
      'Create a new issue/task in the workspace. Only call this when the user ' +
      'explicitly asks to create a task/issue. It is authored as the current user.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short issue title' },
        desc: { type: 'string', description: 'Description / details (optional)' },
        type: { type: 'string', enum: [...ISSUE_TYPES] },
        priority: { type: 'string', enum: [...ISSUE_PRIORITIES] },
        projectId: { type: 'string', description: '24-hex project id (optional)' },
      },
      required: ['title'],
    },
  },
];

/** Tool definitions in Anthropic's `tools` wire format. */
export function buildTools(): Anthropic.Tool[] {
  return TOOL_DEFS.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters as Anthropic.Tool.InputSchema,
  }));
}

/** The same tool definitions in OpenAI's `tools` (function-calling) wire format. */
export function buildOpenAiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return TOOL_DEFS.map((d) => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description,
      parameters: d.parameters,
    },
  }));
}

const ok = (data: unknown): ToolRun => ({
  ok: true,
  content: typeof data === 'string' ? data : JSON.stringify(data),
});
const err = (message: string): ToolRun => ({ ok: false, content: message });

/**
 * Execute one tool call under the caller's identity. Never throws — failures
 * are returned as `{ ok:false }` so the streaming loop can relay them to the
 * model as `is_error` tool_result blocks instead of tearing down the SSE stream.
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  user: AuthUserPayload,
  deps: ToolDeps,
): Promise<ToolRun> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'search_issues': {
        const query = String(input.query ?? '').trim();
        if (!query) return err('query is required');
        const status = (['open', 'closed', 'all'] as const).includes(
          input.status as never,
        )
          ? (input.status as 'open' | 'closed' | 'all')
          : 'all';
        const projectId =
          typeof input.projectId === 'string' &&
          /^[0-9a-fA-F]{24}$/.test(input.projectId)
            ? input.projectId
            : undefined;
        const res = await deps.issues.list(user.id, {
          q: query,
          status,
          projectId,
          page: 1,
          limit: 8,
        } as never);
        const items = (res.items ?? []).map((i: Record<string, unknown>) => ({
          id: String(i._id),
          title: i.title,
          status: i.status,
          priority: i.priority,
          projectId: i.projectId ? String(i.projectId) : null,
        }));
        return ok({ count: res.totals?.all ?? items.length, items });
      }

      case 'search_wiki': {
        const query = String(input.query ?? '').trim();
        if (!query) return err('query is required');
        return ok({ pages: await deps.wiki.searchForAssistant(user.id, query) });
      }

      case 'get_wiki_page': {
        const id = String(input.id ?? '');
        if (!/^[0-9a-fA-F]{24}$/.test(id)) return err('invalid wiki page id');
        const { canRead } = await deps.wiki.accessFor(user.id, id);
        if (!canRead) return err('You do not have access to that wiki page');
        const page = await deps.wiki.byId(id);
        return ok({ title: page.title, contentHTML: page.content });
      }

      case 'create_issue': {
        const parsed = CreateIssueSchema.safeParse({
          title: input.title,
          desc: input.desc ?? '',
          type: input.type ?? 'task',
          priority: input.priority ?? 'medium',
          projectId:
            typeof input.projectId === 'string' ? input.projectId : undefined,
        });
        if (!parsed.success) {
          return err(`Invalid issue: ${parsed.error.issues[0]?.message ?? 'bad input'}`);
        }
        const issue = await deps.issues.create(user.id, parsed.data);
        return ok({
          id: String(issue._id),
          title: issue.title,
          link: `/issues/${issue._id}`,
        });
      }

      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Tool execution failed');
  }
}
