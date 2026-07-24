/**
 * DESTRUCTIVE test seeder — drops EVERY collection in the target database, then
 * seeds a fresh multi-workspace fixture: 10 users, 3 workspaces, projects,
 * issues, notes and wiki pages.
 *
 * Shaped to exercise the workspace model (ADR 0003–0006):
 *  - users spread across workspaces, one deliberately in two
 *  - every project carries a workspaceId (no orphans)
 *  - one cross-workspace owner, so strict isolation is observable
 *
 *   pnpm --filter api exec ts-node -r tsconfig-paths/register src/seed/test-seed.ts
 *
 * Guard: refuses to run against anything but the expected local dev DB.
 */
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import * as mongoose from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { Project, ProjectDocument } from '../modules/projects/schemas/project.schema';
import { Workspace, WorkspaceDocument } from '../modules/workspaces/schemas/workspace.schema';
import { Issue, IssueDocument } from '../modules/issues/schemas/issue.schema';
import { Note, NoteDocument } from '../modules/notes/schemas/note.schema';
import { WikiPage, WikiPageDocument } from '../modules/wiki/schemas/wiki-page.schema';
import {
  InstanceAdmin,
  InstanceAdminDocument,
} from '../modules/instance/schemas/instance-admin.schema';
import { RolesService } from '../modules/roles/roles.service';

const EXPECTED_URI = 'mongodb://localhost:27017/prism';
const PASSWORD = 'test1234';

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface SeedUser { key: string; email: string; name: string; role: string }

const USERS: SeedUser[] = [
  { key: 'admin', email: 'admin@test.com',  name: 'Admin User',   role: 'admin' },
  { key: 'alice', email: 'alice@test.com',  name: 'Alice Chen',   role: 'cpo' },
  { key: 'bob',   email: 'bob@test.com',    name: 'Bob Martin',   role: 'dev' },
  { key: 'carol', email: 'carol@test.com',  name: 'Carol Wong',   role: 'dev' },
  { key: 'dave',  email: 'dave@test.com',   name: 'Dave Kim',     role: 'cpo' },
  { key: 'eve',   email: 'eve@test.com',    name: 'Eve Silva',    role: 'dev' },
  { key: 'frank', email: 'frank@test.com',  name: 'Frank Lee',    role: 'marketing' },
  { key: 'grace', email: 'grace@test.com',  name: 'Grace Park',   role: 'cpo' },
  { key: 'henry', email: 'henry@test.com',  name: 'Henry Tan',    role: 'sales' },
  { key: 'iris',  email: 'iris@test.com',   name: 'Iris Yang',    role: 'dev' },
];

const WORKSPACES = [
  { key: 'acme',  name: 'Acme Corp',  slug: 'acme',  color: '#6366f1',
    owner: 'alice', members: ['alice', 'bob', 'carol', 'iris', 'admin'] },
  { key: 'beta',  name: 'Beta Team',  slug: 'beta',  color: '#10b981',
    owner: 'dave',  members: ['dave', 'eve', 'frank', 'admin'] },
  { key: 'gamma', name: 'Gamma Labs', slug: 'gamma', color: '#f59e0b',
    owner: 'grace', members: ['grace', 'henry', 'iris', 'admin'] },
];

const PROJECTS = [
  { ws: 'acme',  name: 'Website Redesign',    owner: 'alice', members: ['bob', 'carol'], visibility: 'internal', color: '#6366f1' },
  { ws: 'acme',  name: 'Mobile App',          owner: 'bob',   members: ['carol'],        visibility: 'internal', color: '#8b5cf6' },
  { ws: 'acme',  name: 'API Platform',        owner: 'carol', members: ['bob'],          visibility: 'private',  color: '#ec4899' },
  { ws: 'beta',  name: 'Data Pipeline',       owner: 'dave',  members: ['eve'],          visibility: 'internal', color: '#10b981' },
  { ws: 'beta',  name: 'ML Models',           owner: 'eve',   members: ['dave', 'frank'], visibility: 'internal', color: '#06b6d4' },
  { ws: 'gamma', name: 'Research Portal',     owner: 'grace', members: ['henry'],        visibility: 'internal', color: '#f59e0b' },
  { ws: 'gamma', name: 'Analytics Dashboard', owner: 'henry', members: ['grace'],        visibility: 'private',  color: '#f43f5e' },
  // Iris is in BOTH acme and gamma and owns this one in gamma. It must NOT show
  // up in acme's scoped list — the ADR 0006 strict-isolation check.
  { ws: 'gamma', name: 'Iris Cross-WS Project', owner: 'iris', members: [], visibility: 'internal', color: '#a855f7' },
];

const ISSUE_TITLES = [
  ['Fix login redirect loop',        'bug',     'in_progress', 'high'],
  ['Add dark mode toggle',           'feature', 'todo',        'medium'],
  ['Upgrade to Node 22',             'task',    'todo',        'low'],
  ['Search returns stale results',   'bug',     'done',        'medium'],
  ['Export to CSV',                  'feature', 'in_progress', 'high'],
  ['Write onboarding docs',          'task',    'todo',        'low'],
];

const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const uri = process.env.MONGODB_URI ?? '';
  if (uri !== EXPECTED_URI) {
    console.error(`Refusing to run: MONGODB_URI is "${uri}", expected "${EXPECTED_URI}".`);
    process.exit(1);
  }

  // 1. Drop everything FIRST, on a bare connection — before Nest boots, so the
  //    models rebuild their indexes against the empty database afterwards.
  const conn = await mongoose.createConnection(uri).asPromise();
  const db = conn.db;
  if (!db) throw new Error('No database handle on the connection');
  const existing = await db.listCollections().toArray();
  console.log(`Dropping ${existing.length} collection(s) from ${uri} …`);
  for (const c of existing) await db.dropCollection(c.name).catch(() => {});
  await conn.close();
  console.log('Database cleared.\n');

  // 2. Boot the app (registers models + indexes, ensures builtin roles).
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(RolesService).ensureBuiltins();

  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
  const wsModel = app.get<Model<WorkspaceDocument>>(getModelToken(Workspace.name));
  const projectModel = app.get<Model<ProjectDocument>>(getModelToken(Project.name));
  const issueModel = app.get<Model<IssueDocument>>(getModelToken(Issue.name));
  const noteModel = app.get<Model<NoteDocument>>(getModelToken(Note.name));
  const wikiModel = app.get<Model<WikiPageDocument>>(getModelToken(WikiPage.name));
  const adminModel = app.get<Model<InstanceAdminDocument>>(getModelToken(InstanceAdmin.name));

  // 3. Users
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const U: Record<string, Types.ObjectId> = {};
  for (const u of USERS) {
    const doc = await userModel.create({
      email: u.email, name: u.name, role: u.role, passwordHash,
    });
    U[u.key] = doc._id as Types.ObjectId;
  }

  // 4. Instance admin (God Mode / UnifyOps console)
  await adminModel.create({ userId: U['admin'], role: 'admin' });

  // 5. Workspaces
  const W: Record<string, Types.ObjectId> = {};
  for (const w of WORKSPACES) {
    const doc = await wsModel.create({
      name: w.name, slug: w.slug, color: w.color,
      desc: `${w.name} — seeded test workspace.`,
      ownerId: U[w.owner],
      members: w.members.map((m) => U[m]),
    });
    W[w.key] = doc._id as Types.ObjectId;
  }

  // 6. Projects — every one carries a workspaceId (ADR 0006: no orphans).
  const projects: { id: Types.ObjectId; name: string; ws: string; owner: string }[] = [];
  for (const p of PROJECTS) {
    const doc = await projectModel.create({
      name: p.name,
      namespace: p.name.toLowerCase().replace(/\s+/g, '-'),
      desc: `${p.name} — seeded project in ${p.ws}.`,
      visibility: p.visibility,
      color: p.color,
      ownerId: U[p.owner],
      workspaceId: W[p.ws],
      members: [U[p.owner], ...p.members.map((m) => U[m])],
    });
    projects.push({ id: doc._id as Types.ObjectId, name: p.name, ws: p.ws, owner: p.owner });
  }

  // 7. Issues — a few per project, varied status/priority/type.
  let issueCount = 0;
  for (const [i, p] of projects.entries()) {
    const proj = PROJECTS[i];
    const pool = [U[proj.owner], ...proj.members.map((m) => U[m])];
    // 3 issues each, rotating through the title pool so data varies per project.
    for (let k = 0; k < 3; k++) {
      const [title, type, status, priority] = ISSUE_TITLES[(i + k) % ISSUE_TITLES.length];
      await issueModel.create({
        projectId: p.id,
        title: `${title}`,
        type, status, priority,
        desc: `Seeded ${type} for ${p.name}.`,
        authorId: U[proj.owner],
        assigneeId: pool[k % pool.length],
        dueDate: k === 0 ? daysFromNow(3 + i) : undefined,
        labels: [proj.ws, type],
      });
      issueCount++;
    }
  }

  // 8. Notes — one personal note per user.
  for (const u of USERS) {
    await noteModel.create({
      ownerId: U[u.key],
      title: `${u.name.split(' ')[0]}'s notes`,
      blocks: [
        { type: 'heading', value: 'To do' },
        { type: 'check', value: 'Review open issues', checked: false },
        { type: 'check', value: 'Update the changelog', checked: true },
        { type: 'text', value: 'Seeded personal note.' },
      ],
    });
  }

  // 9. Wiki — one page per project.
  for (const [i, p] of projects.entries()) {
    await wikiModel.create({
      projectId: p.id,
      authorId: U[PROJECTS[i].owner],
      parentId: null,
      title: `${p.name} — Overview`,
      content: `# ${p.name}\n\nSeeded wiki page for **${p.name}** in the \`${p.ws}\` workspace.\n\n## Getting started\n\n1. Read the issues\n2. Pick one up\n3. Ship it\n`,
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('Seed complete.\n');
  console.log(`Password for every user: ${PASSWORD}\n`);
  console.log('INSTANCE ADMIN (UnifyOps console :3001)');
  console.log('  admin@test.com\n');
  console.log('WORKSPACES');
  for (const w of WORKSPACES) {
    const inWs = PROJECTS.filter((p) => p.ws === w.key).length;
    console.log(`  ${w.slug.padEnd(7)} ${w.name.padEnd(12)} owner=${w.owner.padEnd(6)} members=${w.members.length}  projects=${inWs}`);
  }
  console.log('\nUSERS');
  for (const u of USERS) {
    const ws = WORKSPACES.filter((w) => w.members.includes(u.key)).map((w) => w.slug);
    console.log(`  ${u.email.padEnd(18)} ${u.name.padEnd(13)} ${u.role.padEnd(10)} ${ws.join(', ')}`);
  }
  console.log(`\nDATA: ${projects.length} projects, ${issueCount} issues, ${USERS.length} notes, ${projects.length} wiki pages`);
  console.log('\nISOLATION CHECK: iris@test.com is in acme AND gamma, and owns');
  console.log('"Iris Cross-WS Project" in gamma. It must NOT appear in acme.');

  await app.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
