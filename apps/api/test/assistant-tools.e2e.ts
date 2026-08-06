#!/usr/bin/env ts-node
/**
 * Assistant write-tools suite — the verification ADR 0015 §5 demands before
 * any of 2a–2d counts as done.
 *
 *   pnpm --filter api test:assistant-tools
 *
 * Why this one is TypeScript and in-process, unlike every other suite here:
 * the rules being proved live *inside* `runTool` — blast-radius tiers, the
 * "ids must have appeared in a previous tool result" rule, the Telegram
 * project pin, and the fact that a Tier C tool describes instead of acts.
 * None of that has an HTTP surface (deliberately — an HTTP tool-runner would
 * be exactly the attack surface the ADR exists to avoid), so a fetch-based
 * suite could only prove the REST endpoints that were already covered.
 *
 * So this boots a real Nest application context against the dev database and
 * drives the real services with real fixture users. The one thing it does not
 * exercise is the model round-trip: `runTool` is called directly rather than
 * by a provider loop, because no CI has an API key. What that costs is
 * covered by the browser check in the plan doc, not by pretending here.
 *
 * Needs: MongoDB with the E2E fixture (test-seed.ts). Does NOT need the dev
 * API running, an AI key, or the network.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { IssuesService } from '../src/modules/issues/issues.service';
import { WikiService } from '../src/modules/wiki/wiki.service';
import { CyclesService } from '../src/modules/cycles/cycles.service';
import { ModulesService } from '../src/modules/modules/modules.service';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TelegramAssistantService } from '../src/modules/chat/telegram/telegram-assistant.service';
import { buildTools, runTool, ToolDeps } from '../src/modules/assistant/tools';
import { ToolSession } from '../src/modules/assistant/tool-session';
import type { AuthUserPayload } from '../src/common/decorators/current-user.decorator';
import type { ChatChannel } from '../src/modules/chat/schemas/chat-channel.schema';

let pass = 0;
let fail = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass += 1;
  } catch (err) {
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
    fail += 1;
  }
}

/** Tool results are JSON strings; every assertion here reads them structurally. */
const parse = (content: string): Record<string, unknown> => {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });

  const deps: ToolDeps = {
    issues: app.get(IssuesService),
    wiki: app.get(WikiService),
    cycles: app.get(CyclesService),
    modules: app.get(ModulesService),
    projects: app.get(ProjectsService),
    audit: app.get(AuditService),
  };
  const telegram = app.get(TelegramAssistantService);
  const conn = app.get<Connection>(getConnectionToken());

  // ── Fixture ───────────────────────────────────────────────────────
  const users = conn.collection('users');
  const row = async (email: string) => {
    const u = await users.findOne({ email });
    if (!u) {
      throw new Error(
        `Fixture user ${email} is missing — run test-seed.ts first.`,
      );
    }
    return { id: String(u._id), email: String(u.email), role: String(u.role) };
  };

  const alice: AuthUserPayload = await row('alice@test.com');
  const dave: AuthUserPayload = await row('dave@test.com');

  const ownedProject = async (u: AuthUserPayload) => {
    const list = (await deps.projects.listForUser(u.id)) as {
      _id: unknown;
      ownerId: unknown;
    }[];
    const mine = list.find((p) => String(p.ownerId) === u.id);
    if (!mine) throw new Error(`${u.email} owns no project in the fixture.`);
    return String(mine._id);
  };

  const aliceProject = await ownedProject(alice);
  const daveProject = await ownedProject(dave);

  console.log('\nAssistant write tools (ADR 0015 §5)\n');

  const made = { issues: [] as string[], cycles: [] as string[] };
  const mkIssue = async (u: AuthUserPayload, projectId: string, title: string) => {
    const issue = await deps.issues.create(u.id, {
      projectId,
      title,
      desc: '',
      type: 'task',
      status: 'todo',
      priority: 'low',
      labels: [],
      todos: [],
    });
    const id = String((issue as { _id: unknown })._id);
    made.issues.push(id);
    return id;
  };

  const aliceIssueA = await mkIssue(alice, aliceProject, 'Tool suite A');
  const aliceIssueB = await mkIssue(alice, aliceProject, 'Tool suite B');
  const daveIssue = await mkIssue(dave, daveProject, 'Tool suite dave');

  /** A web session that has already "seen" the given ids. */
  const webSession = (seedIds: string[] = []) =>
    new ToolSession({ surface: 'web', conversationId: 'test', seedIds });

  // ── §5.1 — a tool cannot reach a project the caller cannot read ───
  await check(
    'a write tool on an unreadable project fails as a tool error, not a throw',
    async () => {
      const session = webSession([aliceIssueA]);
      const run = await runTool(
        'update_issue',
        { id: aliceIssueA, title: 'hijacked' },
        { user: dave, session },
        deps,
      );
      assert.equal(run.ok, false, 'expected the tool to refuse');
      assert.ok(run.content.length > 0, 'a refusal must say something');

      const after = await deps.issues.byId(alice.id, aliceIssueA);
      assert.equal(
        (after as { title: string }).title,
        'Tool suite A',
        'the issue must be untouched',
      );
    },
  );

  await check('a read tool never returns another tenant\'s issues', async () => {
    const session = webSession();
    const run = await runTool(
      'search_issues',
      { query: 'Tool suite' },
      { user: dave, session },
      deps,
    );
    assert.equal(run.ok, true);
    const items = (parse(run.content).items ?? []) as { id: string }[];
    const ids = items.map((i) => i.id);
    assert.ok(!ids.includes(aliceIssueA), 'alice\'s issue leaked to dave');
    assert.ok(!ids.includes(aliceIssueB), 'alice\'s issue leaked to dave');
  });

  // ── §5.2 — bulk_update is per-issue, partial success ──────────────
  await check(
    'bulk_update changes only the writable ids and reports the rest',
    async () => {
      const session = webSession([aliceIssueA, aliceIssueB, daveIssue]);
      const run = await runTool(
        'bulk_update',
        { ids: [aliceIssueA, daveIssue], patch: { priority: 'high' } },
        { user: alice, session },
        deps,
      );
      assert.equal(run.ok, true, run.content);
      const res = parse(run.content) as {
        updated: number;
        failed: { id: string }[];
      };
      assert.equal(res.updated, 1, 'exactly one id was writable');
      assert.equal(res.failed.length, 1, 'the other must be reported, not 403');
      assert.equal(res.failed[0].id, daveIssue);

      const mine = await deps.issues.byId(alice.id, aliceIssueA);
      assert.equal((mine as { priority: string }).priority, 'high');
      const theirs = await deps.issues.byId(dave.id, daveIssue);
      assert.equal(
        (theirs as { priority: string }).priority,
        'low',
        'dave\'s issue must be untouched',
      );
    },
  );

  // ── §5.3 — ids must have appeared in a previous tool result ───────
  await check('bulk_update refuses ids the model never saw', async () => {
    const session = webSession(); // nothing observed yet
    const run = await runTool(
      'bulk_update',
      { ids: [aliceIssueB], patch: { priority: 'critical' } },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, false, 'a synthesised id must be refused');
    assert.match(run.content, /not appeared/i);

    const after = await deps.issues.byId(alice.id, aliceIssueB);
    assert.equal((after as { priority: string }).priority, 'low');
  });

  await check(
    'a prior search makes its own results usable in the same session',
    async () => {
      const session = webSession();
      const search = await runTool(
        'search_issues',
        { query: 'Tool suite B' },
        { user: alice, session },
        deps,
      );
      assert.equal(search.ok, true);
      assert.ok(
        session.hasSeen(aliceIssueB),
        'ids in a tool result must be recorded as seen',
      );

      const run = await runTool(
        'bulk_update',
        { ids: [aliceIssueB], patch: { priority: 'medium' } },
        { user: alice, session },
        deps,
      );
      assert.equal(run.ok, true, run.content);
      assert.equal((parse(run.content) as { updated: number }).updated, 1);
    },
  );

  await check('a failed tool result does not bless the ids it echoes', async () => {
    const session = webSession();
    const bogus = new Types.ObjectId().toString();
    await runTool(
      'update_issue',
      { id: bogus, title: 'x' },
      { user: alice, session },
      deps,
    );
    assert.ok(
      !session.hasSeen(bogus),
      'an id only mentioned in an error must not become usable',
    );
  });

  // ── §5.6 — Tier C proposes, never performs ───────────────────────
  await check('bulk_delete returns a pendingAction and deletes nothing', async () => {
    const session = webSession([aliceIssueA, aliceIssueB]);
    const run = await runTool(
      'bulk_delete',
      { ids: [aliceIssueA, aliceIssueB] },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, true, run.content);
    const res = parse(run.content) as {
      performed: boolean;
      pendingAction?: {
        items: { id: string; title: string }[];
        confirm: { method: string; path: string; body: { ids: string[] } };
      };
    };
    assert.equal(res.performed, false);
    assert.ok(res.pendingAction, 'a Tier C tool must describe the action');
    assert.equal(res.pendingAction!.items.length, 2);
    assert.equal(res.pendingAction!.confirm.path, '/issues/bulk/delete');
    assert.deepEqual(res.pendingAction!.confirm.body.ids.sort(), [
      aliceIssueA,
      aliceIssueB,
    ].sort());

    // The only assertion that actually matters: they are still there.
    await deps.issues.byId(alice.id, aliceIssueA);
    await deps.issues.byId(alice.id, aliceIssueB);
  });

  await check('delete_issue describes only what the caller can see', async () => {
    const session = webSession([daveIssue]);
    const run = await runTool(
      'delete_issue',
      { id: daveIssue },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, false, 'alice cannot see dave\'s issue, so nothing to propose');
  });

  // ── §5.4 / §5.5 — Telegram ────────────────────────────────────────
  const channels = conn.collection('chatchannels');
  const wsId = (await conn
    .collection('projects')
    .findOne({ _id: new Types.ObjectId(aliceProject) }))!.workspaceId;

  const scopedChannelId = new Types.ObjectId();
  const unscopedChannelId = new Types.ObjectId();
  await channels.insertMany([
    {
      _id: scopedChannelId,
      workspaceId: wsId,
      kind: 'channel',
      name: 'tool-suite-scoped',
      slug: `tool-suite-scoped-${Date.now()}`,
      topic: '',
      visibility: 'private',
      projectId: new Types.ObjectId(aliceProject),
      createdBy: new Types.ObjectId(alice.id),
      memberIds: [new Types.ObjectId(alice.id)],
      archived: false,
      lastMessageAt: new Date(),
      lastMessagePreview: '',
      messageCount: 0,
    },
    {
      _id: unscopedChannelId,
      workspaceId: wsId,
      kind: 'channel',
      name: 'tool-suite-unscoped',
      slug: `tool-suite-unscoped-${Date.now()}`,
      topic: '',
      visibility: 'private',
      projectId: null,
      createdBy: new Types.ObjectId(alice.id),
      memberIds: [new Types.ObjectId(alice.id)],
      archived: false,
      lastMessageAt: new Date(),
      lastMessagePreview: '',
      messageCount: 0,
    },
  ]);

  const loadChannel = async (id: Types.ObjectId) =>
    (await channels.findOne({ _id: id })) as unknown as ChatChannel;

  await check('an unlinked Telegram sender gets the link instruction, no data', async () => {
    const reply = await telegram.reply({
      channel: await loadChannel(scopedChannelId),
      prompt: 'summarise everything the team is working on',
      senderUserId: null,
    });
    assert.ok(reply, 'an unlinked sender must still be answered — with an instruction');
    assert.match(reply!, /link/i);
    assert.match(reply!, /verify/i);
    assert.ok(
      !reply!.includes('Tool suite'),
      'no issue title may appear in a reply to an unlinked sender',
    );
  });

  await check('a bridged channel with no project refuses to answer', async () => {
    const reply = await telegram.reply({
      channel: await loadChannel(unscopedChannelId),
      prompt: 'what is open?',
      senderUserId: new Types.ObjectId(alice.id),
    });
    assert.ok(reply, 'it must say why, not go silent');
    assert.match(reply!, /project/i);
    assert.ok(!reply!.includes('Tool suite'), 'no data without a scope');
  });

  await check(
    'the Telegram surface pins every read to the channel\'s project',
    async () => {
      // A session as alice, pinned to *dave's* project: alice can read plenty,
      // but this surface may surface none of it.
      const session = new ToolSession({
        surface: 'telegram',
        projectScope: daveProject,
      });
      const run = await runTool(
        'search_issues',
        { query: 'Tool suite', projectId: aliceProject },
        { user: alice, session },
        deps,
      );
      // The model asked for alice's project; the pin overrides it, and alice
      // cannot read dave's — so the honest outcome is nothing, never alice's.
      const items = run.ok ? ((parse(run.content).items ?? []) as { id: string }[]) : [];
      assert.ok(
        !items.some((i) => i.id === aliceIssueA || i.id === aliceIssueB),
        'the model\'s projectId must not override the channel pin',
      );
    },
  );

  await check('Telegram sees no Tier B or Tier C tool at all', async () => {
    const session = new ToolSession({
      surface: 'telegram',
      projectScope: aliceProject,
    });
    const names = buildTools({ user: alice, session }).map((t) => t.name);
    for (const forbidden of ['bulk_update', 'bulk_delete', 'delete_issue']) {
      assert.ok(!names.includes(forbidden), `${forbidden} was offered over Telegram`);
    }
    assert.ok(names.includes('update_issue'), 'Tier A must still be available');
    assert.ok(names.includes('search_issues'), 'reads must still be available');
  });

  await check('a Tier B call over Telegram is refused even if named', async () => {
    const session = new ToolSession({
      surface: 'telegram',
      projectScope: aliceProject,
      seedIds: [aliceIssueA],
    });
    const run = await runTool(
      'bulk_update',
      { ids: [aliceIssueA], patch: { priority: 'critical' } },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, false);
    assert.match(run.content, /telegram/i);
    const after = await deps.issues.byId(alice.id, aliceIssueA);
    assert.equal((after as { priority: string }).priority, 'high');
  });

  await check('a Tier A write outside the pinned project is refused', async () => {
    const session = new ToolSession({
      surface: 'telegram',
      projectScope: daveProject,
      seedIds: [aliceIssueA],
    });
    const run = await runTool(
      'update_issue',
      { id: aliceIssueA, priority: 'critical' },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, false, 'the pin must hold for writes too');
  });

  // ── Assignment ids are looked up, not guessed ────────────────────
  await check('assign_issue refuses a user id that was never surfaced', async () => {
    const session = webSession([aliceIssueA]);
    const run = await runTool(
      'assign_issue',
      { id: aliceIssueA, assignee: dave.id },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, false);
    assert.match(run.content, /list_project_members/);
  });

  await check('assign_issue accepts "me" without any lookup', async () => {
    const session = webSession([aliceIssueA]);
    const run = await runTool(
      'assign_issue',
      { id: aliceIssueA, assignee: 'me' },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, true, run.content);
    assert.equal((parse(run.content) as { assigneeId: string }).assigneeId, alice.id);
  });

  // ── §5.7 — every tool write is audited as assistant-driven ───────
  await check('a tool write leaves an audit row marked via=assistant', async () => {
    const session = webSession([aliceIssueB]);
    const run = await runTool(
      'update_issue',
      { id: aliceIssueB, status: 'in_progress' },
      { user: alice, session },
      deps,
    );
    assert.equal(run.ok, true, run.content);

    // The audit write is fire-and-forget by design (it must never fail the
    // action it records), so give it a moment to land.
    await sleep(400);
    const entry = await conn.collection('auditlogs').findOne(
      {
        action: 'assistant.tool.update_issue',
        actorId: new Types.ObjectId(alice.id),
      },
      { sort: { createdAt: -1 } },
    );
    assert.ok(entry, 'no audit row was written for the tool call');
    assert.equal((entry!.detail as { via: string }).via, 'assistant');
    assert.equal((entry!.detail as { issueId: string }).issueId, aliceIssueB);
    assert.equal((entry!.detail as { surface: string }).surface, 'web');
  });

  await check('a read tool writes no audit row', async () => {
    const before = await conn
      .collection('auditlogs')
      .countDocuments({ action: 'assistant.tool.search_issues' });
    await runTool(
      'search_issues',
      { query: 'Tool suite' },
      { user: alice, session: webSession() },
      deps,
    );
    await sleep(200);
    const after = await conn
      .collection('auditlogs')
      .countDocuments({ action: 'assistant.tool.search_issues' });
    assert.equal(after, before, 'reads must not be audited as writes');
  });

  // ── Cleanup ───────────────────────────────────────────────────────
  await channels.deleteMany({
    _id: { $in: [scopedChannelId, unscopedChannelId] },
  });
  await conn
    .collection('issues')
    .deleteMany({ _id: { $in: made.issues.map((i) => new Types.ObjectId(i)) } });
  await conn.collection('auditlogs').deleteMany({
    action: { $regex: '^assistant\\.tool\\.' },
    actorId: new Types.ObjectId(alice.id),
  });
  for (const id of made.cycles) {
    await conn.collection('cycles').deleteOne({ _id: new Types.ObjectId(id) });
  }

  await app.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', (err as Error).message);
  console.error(err);
  process.exit(1);
});
