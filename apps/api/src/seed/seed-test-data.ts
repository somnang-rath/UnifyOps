/**
 * Non-destructive test-data setup — creates the fixtures needed to exercise the
 * instance-admin (God Mode) workspace UI: assign / unassign projects.
 *
 * Unlike `pnpm seed` (which wipes and rebuilds projects/notes/etc.), this script
 * ONLY inserts what is missing. Safe to re-run.
 *
 * It:
 *   1. Ensures 10 demo users.
 *   2. Ensures a `test@demo.com` test user (password: test1234).
 *   3. Promotes `admin@demo.com` to instance admin (so God Mode login works).
 *   4. Creates 4 workspaces via the real WorkspacesService.
 *   5. Creates 4 demo projects, then drives assign -> unassign through the real
 *      service methods and prints the result so the flow is verified end-to-end.
 *
 * Run:  pnpm --filter api seed:test-data
 */
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { Project, ProjectDocument } from '../modules/projects/schemas/project.schema';
import {
  InstanceAdmin,
  InstanceAdminDocument,
} from '../modules/instance/schemas/instance-admin.schema';
import { RolesService } from '../modules/roles/roles.service';
import { WorkspacesService } from '../modules/workspaces/workspaces.service';

interface SeedUser {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'cpo' | 'marketing' | 'sales' | 'dev';
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@demo.com', password: 'admin123', name: 'Alex Morgan', role: 'admin' },
  { email: 'cpo@demo.com', password: 'cpo123', name: 'Jordan Lee', role: 'cpo' },
  { email: 'marketing@demo.com', password: 'mkt123', name: 'Maya Chen', role: 'marketing' },
  { email: 'sales@demo.com', password: 'sales123', name: 'Sam Rivera', role: 'sales' },
  { email: 'dev@demo.com', password: 'dev123', name: 'Dev Kim', role: 'dev' },
  { email: 'dev2@demo.com', password: 'dev123', name: 'Chris Park', role: 'dev' },
  { email: 'dev3@demo.com', password: 'dev123', name: 'Sarah Kim', role: 'dev' },
  { email: 'mkt2@demo.com', password: 'mkt123', name: 'Lena Torres', role: 'marketing' },
  { email: 'sales2@demo.com', password: 'sales123', name: 'Michael Wong', role: 'sales' },
  { email: 'sales3@demo.com', password: 'sales123', name: 'Priya Sharma', role: 'sales' },
];

// The dedicated test user for exercising assign / unassign.
const TEST_USER: SeedUser = {
  email: 'test@demo.com',
  password: 'test1234',
  name: 'Testy McTestface',
  role: 'dev',
};

// Workspaces to create (owner = admin@demo.com). Members reference demo emails.
const WORKSPACES: {
  name: string;
  slug: string;
  desc: string;
  color: string;
  memberEmails: string[];
}[] = [
  {
    name: 'Engineering',
    slug: 'engineering',
    desc: 'Product engineering — web, api, mobile.',
    color: '#6366f1',
    memberEmails: ['dev@demo.com', 'dev2@demo.com', 'dev3@demo.com', 'cpo@demo.com', 'test@demo.com'],
  },
  {
    name: 'Marketing',
    slug: 'marketing-ws',
    desc: 'Growth, content and campaigns.',
    color: '#f59e0b',
    memberEmails: ['marketing@demo.com', 'mkt2@demo.com', 'test@demo.com'],
  },
  {
    name: 'Product',
    slug: 'product',
    desc: 'Roadmap, discovery and design.',
    color: '#10b981',
    memberEmails: ['cpo@demo.com', 'dev@demo.com'],
  },
  {
    name: 'Sales',
    slug: 'sales-ws',
    desc: 'Pipeline, deals and CRM.',
    color: '#0ea5e9',
    memberEmails: ['sales@demo.com', 'sales2@demo.com', 'sales3@demo.com'],
  },
];

// Demo projects created (unassigned) so assign / unassign has something to work
// with. Idempotent by namespace.
const DEMO_PROJECTS: { name: string; namespace: string; color: string }[] = [
  { name: 'QA Demo — Alpha', namespace: 'qa-demo-alpha', color: '#6366f1' },
  { name: 'QA Demo — Beta', namespace: 'qa-demo-beta', color: '#f59e0b' },
  { name: 'QA Demo — Gamma', namespace: 'qa-demo-gamma', color: '#10b981' },
  { name: 'QA Demo — Delta', namespace: 'qa-demo-delta', color: '#0ea5e9' },
];

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(RolesService).ensureBuiltins();

  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
  const projectModel = app.get<Model<ProjectDocument>>(getModelToken(Project.name));
  const adminModel = app.get<Model<InstanceAdminDocument>>(
    getModelToken(InstanceAdmin.name),
  );
  const workspaces = app.get(WorkspacesService);

  const log = (msg: string) => console.log(`  ${msg}`);

  // ── 1 + 2. Users (10 demo + 1 test), idempotent ─────────────────────────
  console.log('\n▸ Users');
  for (const u of [...SEED_USERS, TEST_USER]) {
    const existing = await userModel.findOne({ email: u.email });
    if (existing) {
      log(`exists   ${u.email}`);
      continue;
    }
    await userModel.create({
      email: u.email,
      name: u.name,
      role: u.role,
      passwordHash: await bcrypt.hash(u.password, 12),
    });
    log(`created  ${u.email}  (password: ${u.password})`);
  }

  const admin = await userModel.findOne({ email: 'admin@demo.com' });
  if (!admin) throw new Error('admin@demo.com missing after user seed');
  const adminId = admin._id as Types.ObjectId;

  // ── 3. Instance admin (God Mode access), idempotent ──────────────────────
  console.log('\n▸ Instance admin');
  const alreadyAdmin = await adminModel.exists({ userId: adminId });
  if (alreadyAdmin) {
    log('admin@demo.com is already an instance admin');
  } else {
    await adminModel.create({ userId: adminId });
    log('promoted admin@demo.com to instance admin');
  }

  // ── 4. Workspaces via the real service, idempotent by slug ───────────────
  console.log('\n▸ Workspaces');
  for (const w of WORKSPACES) {
    const existing = await workspaces
      // listAll is admin-scoped and cheap here; match on slug.
      .listAll()
      .then((rows) => rows.find((r) => r.slug === w.slug));
    if (existing) {
      log(`exists   ${w.name} (/${w.slug})`);
      continue;
    }
    const created = await workspaces.create(String(adminId), {
      name: w.name,
      slug: w.slug,
      desc: w.desc,
      color: w.color,
      memberEmails: w.memberEmails,
    });
    log(`created  ${created.name} (/${created.slug})  members=${created.memberCount}`);
  }

  // ── 5. Demo projects (unassigned), idempotent by namespace ───────────────
  console.log('\n▸ Demo projects');
  for (const p of DEMO_PROJECTS) {
    const existing = await projectModel.findOne({ namespace: p.namespace });
    if (existing) {
      log(`exists   ${p.name}`);
      continue;
    }
    await projectModel.create({
      name: p.name,
      namespace: p.namespace,
      desc: 'Demo project for testing workspace assign / unassign.',
      visibility: 'internal',
      ownerId: adminId,
      workspaceId: null,
      members: [],
      color: p.color,
    });
    log(`created  ${p.name}`);
  }

  // ── 6. Exercise assign -> unassign through the real service ──────────────
  console.log('\n▸ Assign / unassign smoke test (Engineering workspace)');
  const eng = (await workspaces.listAll()).find((w) => w.slug === 'engineering');
  if (!eng) throw new Error('Engineering workspace missing');

  const alpha = await projectModel.findOne({ namespace: 'qa-demo-alpha' });
  const beta = await projectModel.findOne({ namespace: 'qa-demo-beta' });
  if (!alpha || !beta) throw new Error('Demo projects missing');

  // Assign both.
  await workspaces.assignProject(eng.id, String(alpha._id));
  await workspaces.assignProject(eng.id, String(beta._id));
  let detail = await workspaces.detail(eng.id);
  log(
    `after assign  → projects in Engineering: [${detail.projects
      .map((p) => p.name)
      .join(', ')}]`,
  );

  // Unassign Beta again to prove the reverse path.
  await workspaces.unassignProject(eng.id, String(beta._id));
  detail = await workspaces.detail(eng.id);
  log(
    `after unassign → projects in Engineering: [${detail.projects
      .map((p) => p.name)
      .join(', ')}]`,
  );

  const available = await workspaces.availableProjects(eng.id);
  log(
    `availableProjects → ${available
      .map((p) => `${p.name}${p.assigned ? ' [assigned]' : ''}`)
      .join(', ')}`,
  );

  console.log('\n✅ Test data ready.');
  console.log('   Admin (God Mode): admin@demo.com / admin123  → http://localhost:3001/god-mode');
  console.log('   Test user:        test@demo.com  / test1234');
  console.log(
    '   In God Mode → Workspaces → open a workspace → assign / unassign projects.\n',
  );

  await app.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
