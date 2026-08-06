import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { IssuesService } from '../issues/issues.service';
import {
  BulkUpdateIssuesSchema,
  CreateIssueSchema,
  ISSUE_PRIORITIES,
  ISSUE_TYPES,
  UpdateIssueSchema,
} from '../issues/dto/issue.dto';
import { CreateCycleSchema } from '../cycles/dto/cycle.dto';
import { WikiService } from '../wiki/wiki.service';
import { CyclesService } from '../cycles/cycles.service';
import { ModulesService } from '../modules/modules.service';
import { ProjectsService } from '../projects/projects.service';
import { AuditService } from '../audit/audit.service';
import {
  BULK_TOOL_CAP,
  isObjectId,
  ToolContext,
  ToolTier,
} from './tool-session';

/**
 * Dependencies the agentic tools call into.
 *
 * Every entry is a *service*, never a model: a tool must go through the same
 * method the HTTP route uses so it inherits that route's authorization
 * unchanged (ADR 0015 §2.1). A tool that needs a new query adds a method to the
 * owning service rather than reaching into a collection directly.
 */
export interface ToolDeps {
  issues: IssuesService;
  wiki: WikiService;
  cycles: CyclesService;
  modules: ModulesService;
  projects: ProjectsService;
  audit: AuditService;
}

/** Outcome of one tool call, relayed to the model as a `tool_result` block. */
export interface ToolRun {
  ok: boolean;
  content: string;
}

/** A provider-neutral tool definition (name + description + JSON-schema input). */
interface ToolDef {
  name: string;
  tier: ToolTier;
  description: string;
  parameters: Record<string, unknown>;
}

const objectIdProp = (description: string) => ({
  type: 'string',
  description: `${description} (24-hex id)`,
});

/**
 * Canonical, provider-neutral tool definitions, exposed only when the instance
 * admin enabled `ASSISTANT_ALLOW_TOOLS`. Raw JSON schema (the API has no Zod
 * dependency on the wire). {@link buildTools} / {@link buildOpenAiTools} adapt
 * these to each provider's format so the two loops stay in sync, and filter by
 * the surface's allowed tiers so a disallowed tool is never even offered.
 */
const TOOL_DEFS: ToolDef[] = [
  // ── Reads ──────────────────────────────────────────────────────────
  {
    name: 'search_issues',
    tier: 'read',
    description:
      'Search the workspace issues/tasks by keyword. Use when the user asks ' +
      'about existing tasks, bugs, or work items. Returns a short list.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to match in title/description' },
        projectId: objectIdProp('Project to scope to (optional)'),
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
    tier: 'read',
    description:
      'Search wiki pages by keyword in their title or content. Use when the ' +
      'user asks about documentation or notes. Returns matching page ids/titles.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Keyword to match' } },
      required: ['query'],
    },
  },
  {
    name: 'get_wiki_page',
    tier: 'read',
    description:
      'Fetch the full content of one wiki page by id (e.g. from search_wiki) ' +
      'to summarize or answer questions about it.',
    parameters: {
      type: 'object',
      properties: { id: objectIdProp('Wiki page') },
      required: ['id'],
    },
  },
  {
    name: 'list_project_members',
    tier: 'read',
    description:
      'List the people on a project, with their ids. Call this before ' +
      'assigning work: assignee ids must come from a tool result, never be guessed.',
    parameters: {
      type: 'object',
      properties: { projectId: objectIdProp('Project') },
      required: ['projectId'],
    },
  },
  {
    name: 'list_cycles',
    tier: 'read',
    description:
      'List cycles (sprints) with their dates and progress, for a project or ' +
      'across everything the user can read. Use to find a cycle id.',
    parameters: {
      type: 'object',
      properties: {
        projectId: objectIdProp('Project to scope to (optional)'),
        status: {
          type: 'string',
          enum: ['draft', 'upcoming', 'current', 'completed'],
        },
      },
    },
  },
  {
    name: 'list_modules',
    tier: 'read',
    description:
      'List feature modules for a project, with progress. Use to find a module id.',
    parameters: {
      type: 'object',
      properties: { projectId: objectIdProp('Project to scope to (optional)') },
    },
  },

  // ── Tier A — reversible, single object ─────────────────────────────
  {
    name: 'create_issue',
    tier: 'A',
    description:
      'Create a new issue/task. Only call this when the user explicitly asks ' +
      'to create a task/issue. It is authored as the current user.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short issue title' },
        desc: { type: 'string', description: 'Description / details (optional)' },
        type: { type: 'string', enum: [...ISSUE_TYPES] },
        priority: { type: 'string', enum: [...ISSUE_PRIORITIES] },
        projectId: objectIdProp('Project (optional — omitted makes it personal)'),
      },
      required: ['title'],
    },
  },
  {
    name: 'update_issue',
    tier: 'A',
    description:
      'Edit one existing issue. Pass only the fields that change. The id must ' +
      'come from a previous tool result.',
    parameters: {
      type: 'object',
      properties: {
        id: objectIdProp('Issue to edit'),
        title: { type: 'string' },
        desc: { type: 'string' },
        status: { type: 'string', description: 'e.g. todo, in_progress, done' },
        type: { type: 'string', enum: [...ISSUE_TYPES] },
        priority: { type: 'string', enum: [...ISSUE_PRIORITIES] },
        dueDate: { type: 'string', description: 'YYYY-MM-DD, or null to clear' },
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replaces the label list entirely',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'assign_issue',
    tier: 'A',
    description:
      'Set or clear the assignee of one issue. Use "me" for the current user, ' +
      'null to unassign, or an id from list_project_members.',
    parameters: {
      type: 'object',
      properties: {
        id: objectIdProp('Issue'),
        assignee: {
          type: ['string', 'null'],
          description: '"me", null to unassign, or a 24-hex user id',
        },
      },
      required: ['id', 'assignee'],
    },
  },
  {
    name: 'move_to_cycle',
    tier: 'A',
    description:
      'Schedule work items into a cycle (sprint). Items outside the cycle\'s ' +
      'project are skipped rather than moved. Reversible.',
    parameters: {
      type: 'object',
      properties: {
        cycleId: objectIdProp('Target cycle'),
        issueIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Issue ids, each from a previous tool result',
        },
      },
      required: ['cycleId', 'issueIds'],
    },
  },
  {
    name: 'move_to_module',
    tier: 'A',
    description:
      'Add work items to a feature module. Items outside the module\'s project ' +
      'are skipped rather than moved. Reversible.',
    parameters: {
      type: 'object',
      properties: {
        moduleId: objectIdProp('Target module'),
        issueIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Issue ids, each from a previous tool result',
        },
      },
      required: ['moduleId', 'issueIds'],
    },
  },
  {
    name: 'create_cycle',
    tier: 'A',
    description: 'Create a cycle (sprint) in a project, optionally with dates.',
    parameters: {
      type: 'object',
      properties: {
        projectId: objectIdProp('Project'),
        name: { type: 'string' },
        description: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['projectId', 'name'],
    },
  },

  // ── Tier B — multi-object ──────────────────────────────────────────
  {
    name: 'bulk_update',
    tier: 'B',
    description:
      `Apply the same change to up to ${BULK_TOOL_CAP} issues at once. Every id ` +
      'must have appeared in a previous tool result. Issues the user cannot ' +
      'edit are reported as failed; the rest still change.',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        patch: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            priority: { type: 'string', enum: [...ISSUE_PRIORITIES] },
            type: { type: 'string', enum: [...ISSUE_TYPES] },
            assigneeId: { type: ['string', 'null'] },
            dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
            addLabels: { type: 'array', items: { type: 'string' } },
            removeLabels: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      required: ['ids', 'patch'],
    },
  },

  // ── Tier C — destructive: proposes, never performs ─────────────────
  {
    name: 'delete_issue',
    tier: 'C',
    description:
      'Propose deleting one issue. This does NOT delete anything — it returns ' +
      'a pending action the user must confirm in the UI. Say so plainly.',
    parameters: {
      type: 'object',
      properties: { id: objectIdProp('Issue to propose deleting') },
      required: ['id'],
    },
  },
  {
    name: 'bulk_delete',
    tier: 'C',
    description:
      'Propose deleting several issues. This does NOT delete anything — it ' +
      'returns a pending action the user must confirm in the UI. Say so plainly.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
];

const TIER_BY_NAME = new Map(TOOL_DEFS.map((d) => [d.name, d.tier]));

/** The tier a tool carries, or undefined for an unknown name. */
export const tierOf = (name: string): ToolTier | undefined =>
  TIER_BY_NAME.get(name);

/** The definitions a given surface is allowed to see (ADR 0015 §2.2/§2.4). */
function defsFor(ctx: ToolContext): ToolDef[] {
  return TOOL_DEFS.filter((d) => ctx.session.allows(d.tier));
}

/** Tool definitions in Anthropic's `tools` wire format. */
export function buildTools(ctx: ToolContext): Anthropic.Tool[] {
  return defsFor(ctx).map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.parameters as Anthropic.Tool.InputSchema,
  }));
}

/** The same tool definitions in OpenAI's `tools` (function-calling) wire format. */
export function buildOpenAiTools(
  ctx: ToolContext,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return defsFor(ctx).map((d) => ({
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

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * Execute one tool call under the caller's identity. Never throws — failures
 * are returned as `{ ok:false }` so the streaming loop can relay them to the
 * model as `is_error` tool_result blocks instead of tearing down the SSE
 * stream, and so a 403 stays a 403 rather than becoming a retry with wider
 * credentials (ADR 0015 §2.1).
 */
export async function runTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
  deps: ToolDeps,
): Promise<ToolRun> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const { session } = ctx;
  const tier = tierOf(name);

  if (!tier) return err(`Unknown tool: ${name}`);
  // Belt and braces: the definition was never offered on this surface, but a
  // model can still emit a name it saw earlier in the transcript.
  if (!session.allows(tier)) {
    return err(
      session.surface === 'telegram'
        ? `${name} is not available over Telegram — do it in Prism.`
        : `${name} is not available here.`,
    );
  }

  try {
    const run = await dispatch(name, input, ctx, deps);
    // Only successful results are provenance: a failure message may echo an id
    // the model invented, and blessing it would defeat the point of §2.3.
    if (run.ok) session.observe(run.content);
    return run;
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Tool execution failed');
  }
}

// ── Scope helpers ────────────────────────────────────────────────────

/**
 * On Telegram, force every project-scoped read to the channel's project. The
 * answer is visible to the whole group, so it must not be able to span
 * everything the *asking* user happens to be able to read (§2.4).
 */
function scopedProjectId(
  ctx: ToolContext,
  requested: unknown,
): string | undefined {
  const pinned = ctx.session.projectScope;
  if (pinned) return pinned;
  const id = str(requested);
  return id && isObjectId(id) ? id : undefined;
}

/** Reject a write whose target sits outside a pinned (Telegram) project. */
async function assertInScope(
  ctx: ToolContext,
  deps: ToolDeps,
  issueId: string,
): Promise<string | null> {
  const pinned = ctx.session.projectScope;
  if (!pinned) return null;
  const issue = await deps.issues.byId(ctx.user.id, issueId);
  const projectId = (issue as { projectId?: unknown })?.projectId;
  if (!projectId || String(projectId) !== pinned) {
    return 'That item is outside this channel\'s project.';
  }
  return null;
}

/**
 * The §2.3 id rule. Applied to every id the model supplies for a *write*, not
 * only to `bulk_update`: an id it did not read somewhere is an id it guessed.
 */
function unseen(ctx: ToolContext, ids: string[]): string[] {
  return ids.filter((id) => !ctx.session.hasSeen(id));
}

/** Record an assistant-driven write in the audit trail (ADR 0015 §2.7). */
function audit(
  ctx: ToolContext,
  deps: ToolDeps,
  tool: string,
  detail: Record<string, unknown>,
): void {
  deps.audit.record({
    actorId: ctx.user.id,
    actorEmail: ctx.user.email,
    action: `assistant.tool.${tool}`,
    audience: (ctx.user as { aud?: string }).aud ?? null,
    detail: {
      // The marker that makes "did a human actually intend this?" answerable.
      via: 'assistant',
      surface: ctx.session.surface,
      conversationId: ctx.session.conversationId,
      ...detail,
    },
  });
}

// ── Dispatch ─────────────────────────────────────────────────────────

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
  deps: ToolDeps,
): Promise<ToolRun> {
  const { user, session } = ctx;

  switch (name) {
    // ── Reads ────────────────────────────────────────────────────────
    case 'search_issues': {
      const query = String(input.query ?? '').trim();
      if (!query) return err('query is required');
      const status = (['open', 'closed', 'all'] as const).includes(
        input.status as never,
      )
        ? (input.status as 'open' | 'closed' | 'all')
        : 'all';
      const res = await deps.issues.list(user.id, {
        q: query,
        status,
        projectId: scopedProjectId(ctx, input.projectId),
        page: 1,
        limit: 8,
      } as never);
      const items = (res.items ?? []).map((i: Record<string, unknown>) => ({
        id: String(i._id),
        title: i.title,
        status: i.status,
        priority: i.priority,
        assigneeId: i.assigneeId ? String(i.assigneeId) : null,
        projectId: i.projectId ? String(i.projectId) : null,
      }));
      return ok({ count: res.totals?.all ?? items.length, items });
    }

    case 'search_wiki': {
      const query = String(input.query ?? '').trim();
      if (!query) return err('query is required');
      const pages = await deps.wiki.searchForAssistant(user.id, query);
      const pinned = session.projectScope;
      return ok({
        pages: pinned ? pages.filter((p) => p.projectId === pinned) : pages,
      });
    }

    case 'get_wiki_page': {
      const id = str(input.id) ?? '';
      if (!isObjectId(id)) return err('invalid wiki page id');
      const { canRead } = await deps.wiki.accessFor(user.id, id);
      if (!canRead) return err('You do not have access to that wiki page');
      const page = await deps.wiki.byId(user.id, id);
      if (
        session.projectScope &&
        String(page.projectId) !== session.projectScope
      ) {
        return err('That page is outside this channel\'s project.');
      }
      return ok({ title: page.title, contentHTML: page.content });
    }

    case 'list_project_members': {
      const projectId = scopedProjectId(ctx, input.projectId);
      if (!projectId) return err('projectId is required');
      return ok({
        members: await deps.projects.membersForAssistant(user.id, projectId),
      });
    }

    case 'list_cycles': {
      const projectId = scopedProjectId(ctx, input.projectId);
      const status = str(input.status);
      const cycles = await deps.cycles.list(user.id, {
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
      } as never);
      return ok({
        cycles: cycles.slice(0, 20).map((c) => ({
          id: String(c._id),
          name: c.name,
          status: c.status,
          startDate: c.startDate,
          endDate: c.endDate,
          progress: c.progress,
          projectId: String(c.projectId),
        })),
      });
    }

    case 'list_modules': {
      const projectId = scopedProjectId(ctx, input.projectId);
      const mods = await deps.modules.list(user.id, {
        ...(projectId ? { projectId } : {}),
      } as never);
      return ok({
        modules: mods.slice(0, 20).map((m) => ({
          id: String(m._id),
          name: m.name,
          status: m.status,
          progress: m.progress,
          projectId: String(m.projectId),
        })),
      });
    }

    // ── Tier A ───────────────────────────────────────────────────────
    case 'create_issue': {
      const projectId = scopedProjectId(ctx, input.projectId);
      // A pinned surface may not create issues outside its project — and a
      // project-less (personal) issue is not this channel's business either.
      if (session.projectScope && !projectId) {
        return err('Creating personal issues is not available over Telegram.');
      }
      const parsed = CreateIssueSchema.safeParse({
        title: input.title,
        desc: input.desc ?? '',
        type: input.type ?? 'task',
        priority: input.priority ?? 'medium',
        ...(projectId ? { projectId } : {}),
      });
      if (!parsed.success) {
        return err(`Invalid issue: ${parsed.error.issues[0]?.message ?? 'bad input'}`);
      }
      const issue = await deps.issues.create(user.id, parsed.data);
      audit(ctx, deps, 'create_issue', {
        issueId: String(issue._id),
        projectId: projectId ?? null,
      });
      return ok({
        id: String(issue._id),
        title: issue.title,
        link: `/issues/${issue._id}`,
      });
    }

    case 'update_issue': {
      const id = str(input.id) ?? '';
      if (!isObjectId(id)) return err('invalid issue id');
      if (unseen(ctx, [id]).length) {
        return err(
          'That id has not appeared in this conversation — search for the issue first.',
        );
      }
      const scopeError = await assertInScope(ctx, deps, id);
      if (scopeError) return err(scopeError);

      const parsed = UpdateIssueSchema.safeParse({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.desc !== undefined ? { desc: input.desc } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
      });
      if (!parsed.success) {
        return err(`Invalid change: ${parsed.error.issues[0]?.message ?? 'bad input'}`);
      }
      if (Object.keys(parsed.data).length === 0) {
        return err('Nothing to change — pass at least one field.');
      }
      const issue = await deps.issues.update(user.id, id, parsed.data);
      audit(ctx, deps, 'update_issue', { issueId: id, patch: parsed.data });
      return ok({
        id: String(issue._id),
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
      });
    }

    case 'assign_issue': {
      const id = str(input.id) ?? '';
      if (!isObjectId(id)) return err('invalid issue id');
      if (unseen(ctx, [id]).length) {
        return err(
          'That id has not appeared in this conversation — search for the issue first.',
        );
      }
      const scopeError = await assertInScope(ctx, deps, id);
      if (scopeError) return err(scopeError);

      const raw = input.assignee;
      let assigneeId: string | null;
      if (raw === null || raw === 'null' || raw === '') {
        assigneeId = null;
      } else if (raw === 'me') {
        assigneeId = user.id;
      } else if (isObjectId(raw)) {
        // Same anti-synthesis rule as issue ids: a user id the model never read
        // is a guess, and guessing them would make assignment an id oracle.
        if (raw !== user.id && unseen(ctx, [raw]).length) {
          return err(
            'That user id has not appeared in this conversation — call list_project_members first.',
          );
        }
        assigneeId = raw;
      } else {
        return err('assignee must be "me", null, or a 24-hex user id');
      }

      const issue = await deps.issues.update(user.id, id, { assigneeId });
      audit(ctx, deps, 'assign_issue', { issueId: id, assigneeId });
      return ok({
        id: String(issue._id),
        title: issue.title,
        assigneeId: issue.assigneeId ? String(issue.assigneeId) : null,
      });
    }

    case 'move_to_cycle':
    case 'move_to_module': {
      const isCycle = name === 'move_to_cycle';
      const containerId = str(isCycle ? input.cycleId : input.moduleId) ?? '';
      if (!isObjectId(containerId)) {
        return err(`invalid ${isCycle ? 'cycle' : 'module'} id`);
      }
      const ids = Array.isArray(input.issueIds)
        ? input.issueIds.filter(isObjectId)
        : [];
      if (ids.length === 0) return err('issueIds is required');
      if (ids.length > BULK_TOOL_CAP) {
        return err(`Too many items — ${BULK_TOOL_CAP} at most.`);
      }
      const missing = unseen(ctx, [...ids, containerId]);
      if (missing.length) {
        return err(
          `These ids have not appeared in this conversation: ${missing.join(', ')}. ` +
            'Look them up first.',
        );
      }
      // The service pins the move to the container's own project, so an id
      // from elsewhere lands in `skipped` rather than crossing a boundary.
      const res = isCycle
        ? await deps.cycles.assign(user.id, containerId, ids)
        : await deps.modules.assign(user.id, containerId, ids);
      audit(ctx, deps, name, { containerId, issueIds: ids, ...res });
      return ok(res);
    }

    case 'create_cycle': {
      const projectId = scopedProjectId(ctx, input.projectId);
      if (!projectId) return err('projectId is required');
      const parsed = CreateCycleSchema.safeParse({
        projectId,
        name: input.name,
        description: input.description ?? '',
        ...(input.startDate ? { startDate: input.startDate } : {}),
        ...(input.endDate ? { endDate: input.endDate } : {}),
      });
      if (!parsed.success) {
        return err(`Invalid cycle: ${parsed.error.issues[0]?.message ?? 'bad input'}`);
      }
      const cycle = await deps.cycles.create(user.id, parsed.data);
      audit(ctx, deps, 'create_cycle', {
        cycleId: String(cycle._id),
        projectId,
      });
      return ok({ id: String(cycle._id), name: cycle.name, status: cycle.status });
    }

    // ── Tier B ───────────────────────────────────────────────────────
    case 'bulk_update': {
      const rawIds = Array.isArray(input.ids) ? input.ids.filter(isObjectId) : [];
      if (rawIds.length === 0) return err('ids is required');
      if (rawIds.length > BULK_TOOL_CAP) {
        return err(
          `Too many issues — ${BULK_TOOL_CAP} at most, the same cap as the bulk edit in the UI.`,
        );
      }
      const missing = unseen(ctx, rawIds);
      if (missing.length) {
        return err(
          `These ids have not appeared in this conversation: ${missing.join(', ')}. ` +
            'Search for them first — ids may not be guessed.',
        );
      }
      const patch = (input.patch ?? {}) as Record<string, unknown>;
      if (
        isObjectId(patch.assigneeId) &&
        patch.assigneeId !== user.id &&
        unseen(ctx, [patch.assigneeId as string]).length
      ) {
        return err(
          'That assignee id has not appeared in this conversation — call list_project_members first.',
        );
      }
      const parsed = BulkUpdateIssuesSchema.safeParse({ ids: rawIds, patch });
      if (!parsed.success) {
        return err(`Invalid bulk edit: ${parsed.error.issues[0]?.message ?? 'bad input'}`);
      }
      // Same service path as `POST /issues/bulk`: per-issue authorization,
      // partial success, identical `{ updated, failed }` shape (§2.3).
      const res = await deps.issues.bulkUpdate(user.id, parsed.data);
      audit(ctx, deps, 'bulk_update', {
        ids: parsed.data.ids,
        patch: parsed.data.patch,
        updated: res.updated,
        failed: res.failed.length,
      });
      return ok(res);
    }

    // ── Tier C — describe, never perform ─────────────────────────────
    case 'delete_issue':
    case 'bulk_delete': {
      const ids =
        name === 'delete_issue'
          ? [str(input.id) ?? ''].filter(isObjectId)
          : Array.isArray(input.ids)
            ? input.ids.filter(isObjectId)
            : [];
      if (ids.length === 0) return err('No valid issue id given');
      if (ids.length > BULK_TOOL_CAP) {
        return err(`Too many issues — ${BULK_TOOL_CAP} at most.`);
      }
      const missing = unseen(ctx, ids);
      if (missing.length) {
        return err(
          `These ids have not appeared in this conversation: ${missing.join(', ')}.`,
        );
      }

      // Resolve titles through the ordinary read gate so the confirmation
      // describes only what this user can already see.
      const items: { id: string; title: string }[] = [];
      const unreadable: string[] = [];
      for (const id of ids) {
        try {
          const issue = await deps.issues.byId(user.id, id);
          items.push({ id, title: String(issue.title ?? '') });
        } catch {
          unreadable.push(id);
        }
      }
      if (items.length === 0) {
        return err('None of those issues are visible to you.');
      }

      // Deliberately no token, no id the client could not have produced
      // itself: a model that can describe a confirmation can be talked into
      // claiming it received one (§2.2).
      return ok({
        performed: false,
        pendingAction: {
          kind: 'issues.delete',
          summary:
            items.length === 1
              ? `Delete "${items[0].title}"`
              : `Delete ${items.length} work items`,
          items,
          ...(unreadable.length ? { skipped: unreadable } : {}),
          confirm: {
            method: 'POST',
            path: '/issues/bulk/delete',
            body: { ids: items.map((i) => i.id) },
          },
        },
        note:
          'Nothing has been deleted. Tell the user to confirm the pending ' +
          'action in Prism to carry it out.',
      });
    }

    default:
      return err(`Unknown tool: ${name}`);
  }
}
