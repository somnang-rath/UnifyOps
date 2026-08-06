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
 * API running, an AI key, or the network — the Telegram section binds a Bot API
 * mock on an ephemeral loopback port and points `TELEGRAM_API_BASE` at it.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import {
  ASSISTANT_AUTHOR_NAME,
  TelegramAssistantService,
} from '../src/modules/chat/telegram/telegram-assistant.service';
import { TelegramInboundService } from '../src/modules/chat/telegram/telegram-inbound.service';
import { InstanceService } from '../src/modules/instance/instance.service';
import { ChatGateway } from '../src/modules/chat/chat.gateway';
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

/** One call the Bot API mock received. */
interface BotCall {
  method: string;
  body: Record<string, unknown>;
  result?: Record<string, unknown>;
}

const BOT = {
  id: 424242,
  is_bot: true,
  first_name: 'Prism',
  username: 'prism_e2e_bot',
};

/**
 * A stand-in for `api.telegram.org`, so the bridge can be driven end to end
 * without a bot, a group, or the network. Must be listening *before* the Nest
 * context is created: `TelegramApiService` reads `TELEGRAM_API_BASE` once, in a
 * field initializer, at construction.
 */
async function startBotApiMock(calls: BotCall[]) {
  let nextMessageId = 5000;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const method = (req.url ?? '').split('/').pop() ?? '';
      const body = chunks.length
        ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
        : {};
      let result: Record<string, unknown> | boolean = true;
      if (method === 'getMe') result = BOT;
      if (method === 'sendMessage') {
        nextMessageId += 1;
        result = {
          message_id: nextMessageId,
          from: BOT,
          chat: { id: Number(body.chat_id), type: 'supergroup' },
          date: Math.floor(Date.now() / 1000),
          text: String(body.text ?? ''),
        };
      }
      calls.push({
        method,
        body,
        result: typeof result === 'object' ? result : undefined,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${port}`;
  return server;
}

async function main() {
  const botCalls: BotCall[] = [];
  const botApi = await startBotApiMock(botCalls);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });

  // An application context has no WebSocket adapter, so the chat gateway has no
  // `server`. Standing one in is not just to stop a crash on post — the recorded
  // emissions are asserted below: a mirrored reply that lands in Mongo but never
  // reaches an open chat window would be a half-built feature.
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  (app.get(ChatGateway) as unknown as { server: unknown }).server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) =>
        emitted.push({ room, event, payload }),
    }),
  };

  // Give the bridge a bot token without writing one into instanceConfig — this
  // runs against the dev database, where a real token may already be configured.
  // `enabled` stays false so the long-poll transport never starts and starts
  // stealing updates from the dev API.
  const instance = app.get(InstanceService);
  instance.getTelegramConfig = async () => ({
    enabled: false,
    botToken: 'e2e-bot-token',
    webhookUrl: '',
    webhookSecret: '',
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
  const bridgedChannelId = new Types.ObjectId();
  await channels.insertMany([
    {
      _id: bridgedChannelId,
      workspaceId: wsId,
      kind: 'channel',
      name: 'tool-suite-bridged',
      slug: `tool-suite-bridged-${Date.now()}`,
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

  // ── The reply the group sees also lands in the Prism channel ──────
  //
  // Driven through the real inbound handler against the Bot API mock, because
  // the thing being proved is a whole round trip: update in → answer out to the
  // group → the same answer mirrored back into the channel, exactly once, and
  // never relayed to the group a second time.
  //
  // The sender is deliberately *unlinked*, which is what makes this runnable
  // with no AI key: rule 1 of the assistant surface answers an unlinked sender
  // with the link instruction, before any model or tool is reached.
  const inbound = app.get(TelegramInboundService);
  const links = conn.collection('telegramlinks');
  const identities = conn.collection('telegramidentities');
  const chatMessages = conn.collection('chatmessages');
  const bridgeChatId = '-1009900990099';
  const strangerTelegramId = 99009900;

  await links.insertOne({
    channelId: bridgedChannelId,
    workspaceId: wsId,
    chatId: bridgeChatId,
    threadId: null,
    chatTitle: 'tool-suite group',
    direction: 'both',
    active: true,
    linkedBy: new Types.ObjectId(alice.id),
    linkedAt: new Date(),
    consecutiveFailures: 0,
  });

  const askUpdate = (updateId: number, messageId: number) => ({
    update_id: updateId,
    message: {
      message_id: messageId,
      from: {
        id: strangerTelegramId,
        is_bot: false,
        first_name: 'Sokha',
        username: 'sokha',
      },
      chat: { id: Number(bridgeChatId), type: 'supergroup', title: 'tool-suite group' },
      date: Math.floor(Date.now() / 1000),
      text: '@prism what is open on this project?',
    },
  });

  botCalls.length = 0;
  emitted.length = 0;
  await inbound.handleUpdate(askUpdate(9001, 7001));
  const sends = () => botCalls.filter((c) => c.method === 'sendMessage');

  await check('the assistant answers the group over Telegram', async () => {
    assert.equal(sends().length, 1, 'expected exactly one reply to the group');
    assert.equal(String(sends()[0].body.chat_id), bridgeChatId);
    assert.match(String(sends()[0].body.text), /verify/i);
  });

  await check('the reply is HTML-escaped before it is sent', async () => {
    // `sendMessage` runs with parse_mode: HTML. The link instruction contains a
    // literal `/verify <code>`; sent raw, Telegram answers 400 and the reply
    // silently never appears in the group.
    const text = String(sends()[0].body.text);
    assert.match(text, /&lt;code&gt;/, 'the angle brackets were not escaped');
  });

  await check('the reply is mirrored into the Prism channel', async () => {
    const rows = await chatMessages
      .find({ channelId: bridgedChannelId })
      .sort({ _id: 1 })
      .toArray();
    assert.equal(rows.length, 2, 'expected the question and the answer');

    const [question, answer] = rows;
    assert.equal(question.kind, 'user');
    assert.match(String(question.body), /@prism/);

    assert.equal(answer.kind, 'system', 'the bot post must not look like a person');
    assert.equal(answer.source, 'telegram');
    assert.equal(answer.authorId, null);
    assert.equal(
      (answer.externalAuthor as { name: string }).name,
      ASSISTANT_AUTHOR_NAME,
    );
    // The channel holds Prism's markdown subset, not the Telegram HTML that was
    // put on the wire — the same body any other message in this channel carries.
    assert.match(
      String(answer.body),
      /`\/verify <code>`/,
      'the stored body is not the plain answer',
    );
    assert.ok(
      !String(answer.body).includes('&lt;'),
      'Telegram HTML escaping leaked into the stored body',
    );
    // Recorded under the id Telegram gave it, which is what makes the mirror
    // dedupe on the same unique index as any inbound message.
    assert.equal(
      (answer.telegram as { messageId: number }).messageId,
      sends()[0].result!.message_id,
    );
  });

  await check('the mirrored reply is broadcast to open chat windows', async () => {
    const messages = emitted.filter(
      (e) => e.event === 'chat:message' && e.room === `channel:${bridgedChannelId}`,
    );
    assert.equal(messages.length, 2, 'both the question and the answer must emit');
    const last = messages[1].payload as { kind: string; externalAuthor?: { name: string } };
    assert.equal(last.kind, 'system');
    assert.equal(last.externalAuthor?.name, ASSISTANT_AUTHOR_NAME);
  });

  await check('the mirrored reply is never relayed back to the group', async () => {
    // The outbound relay is fire-and-forget, so a bounce would arrive late.
    await sleep(400);
    assert.equal(sends().length, 1, 'the assistant answer was posted twice');
  });

  await check('a redelivered update neither answers nor mirrors twice', async () => {
    // Same message_id, new update_id — exactly what Telegram retries look like.
    await inbound.handleUpdate(askUpdate(9002, 7001));
    await sleep(200);
    assert.equal(sends().length, 1, 'the duplicate was answered again');
    const count = await chatMessages.countDocuments({ channelId: bridgedChannelId });
    assert.equal(count, 2, 'the duplicate was stored again');
  });

  await check('the channel preview reflects the assistant reply', async () => {
    const channel = (await channels.findOne({ _id: bridgedChannelId }))!;
    assert.equal(channel.messageCount, 2);
    assert.match(String(channel.lastMessagePreview), /verify/i);
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
    _id: { $in: [scopedChannelId, unscopedChannelId, bridgedChannelId] },
  });
  await chatMessages.deleteMany({ channelId: bridgedChannelId });
  await conn.collection('chatreadstates').deleteMany({ channelId: bridgedChannelId });
  await links.deleteMany({ channelId: bridgedChannelId });
  await identities.deleteMany({ telegramUserId: String(strangerTelegramId) });
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
  botApi.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSuite crashed:', (err as Error).message);
  console.error(err);
  process.exit(1);
});
