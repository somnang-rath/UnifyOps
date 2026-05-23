import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppModule } from '../app.module';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { Project, ProjectDocument } from '../modules/projects/schemas/project.schema';
import { Issue, IssueDocument } from '../modules/issues/schemas/issue.schema';
import { WikiPage, WikiPageDocument } from '../modules/wiki/schemas/wiki-page.schema';
import { Note, NoteDocument } from '../modules/notes/schemas/note.schema';
import { NoteFolder, NoteFolderDocument } from '../modules/notes/schemas/note-folder.schema';
import { MergeRequest, MergeRequestDocument } from '../modules/mrs/schemas/mr.schema';
import { KanbanBoard, KanbanBoardDocument } from '../modules/kanban/schemas/kanban-board.schema';
import { KanbanPosition, KanbanPositionDocument } from '../modules/kanban/schemas/kanban-position.schema';
import { Workbook, WorkbookDocument } from '../modules/workbooks/schemas/workbook.schema';
import { FileItem, FileItemDocument } from '../modules/files/schemas/file.schema';
import { Folder, FolderDocument } from '../modules/files/schemas/folder.schema';
import { RolesService } from '../modules/roles/roles.service';

// ─── Users ────────────────────────────────────────────────────────────────────

interface SeedUser {
  email: string; password: string; name: string;
  role: 'admin' | 'cpo' | 'marketing' | 'sales' | 'dev';
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@demo.com',     password: 'admin123', name: 'Alex Morgan',    role: 'admin' },
  { email: 'cpo@demo.com',       password: 'cpo123',   name: 'Jordan Lee',     role: 'cpo' },
  { email: 'marketing@demo.com', password: 'mkt123',   name: 'Maya Chen',      role: 'marketing' },
  { email: 'sales@demo.com',     password: 'sales123', name: 'Sam Rivera',     role: 'sales' },
  { email: 'dev@demo.com',       password: 'dev123',   name: 'Dev Kim',        role: 'dev' },
  { email: 'dev2@demo.com',      password: 'dev123',   name: 'Chris Park',     role: 'dev' },
  { email: 'dev3@demo.com',      password: 'dev123',   name: 'Sarah Kim',      role: 'dev' },
  { email: 'mkt2@demo.com',      password: 'mkt123',   name: 'Lena Torres',    role: 'marketing' },
  { email: 'sales2@demo.com',    password: 'sales123', name: 'Michael Wong',   role: 'sales' },
  { email: 'sales3@demo.com',    password: 'sales123', name: 'Priya Sharma',   role: 'sales' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n: number) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
function fakeKey() { return new Types.ObjectId().toHexString(); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(RolesService).ensureBuiltins();

  const userModel    = app.get<Model<UserDocument>>(getModelToken(User.name));
  const projectModel = app.get<Model<ProjectDocument>>(getModelToken(Project.name));
  const issueModel   = app.get<Model<IssueDocument>>(getModelToken(Issue.name));
  const wikiModel    = app.get<Model<WikiPageDocument>>(getModelToken(WikiPage.name));
  const noteModel    = app.get<Model<NoteDocument>>(getModelToken(Note.name));
  const folderModel  = app.get<Model<NoteFolderDocument>>(getModelToken(NoteFolder.name));
  const mrModel      = app.get<Model<MergeRequestDocument>>(getModelToken(MergeRequest.name));
  const kbBoardModel = app.get<Model<KanbanBoardDocument>>(getModelToken(KanbanBoard.name));
  const kbPosModel   = app.get<Model<KanbanPositionDocument>>(getModelToken(KanbanPosition.name));
  const wbModel      = app.get<Model<WorkbookDocument>>(getModelToken(Workbook.name));
  const fileModel    = app.get<Model<FileItemDocument>>(getModelToken(FileItem.name));
  const fileFolderModel = app.get<Model<FolderDocument>>(getModelToken(Folder.name));

  // ── 1. Users ──────────────────────────────────────────────────────────────
  const userMap: Record<string, Types.ObjectId> = {};
  for (const u of SEED_USERS) {
    let doc = await userModel.findOne({ email: u.email });
    if (!doc) {
      doc = await userModel.create({
        email: u.email, name: u.name, role: u.role,
        passwordHash: await bcrypt.hash(u.password, 12),
      });
    }
    userMap[u.email.split('@')[0].replace(/\d+$/, '') + (u.email.includes('2') ? '2' : u.email.includes('3') ? '3' : '')] = doc._id as Types.ObjectId;
  }

  const admin = userMap['admin'];
  const cpo   = userMap['cpo'];
  const mkt   = userMap['marketing'];
  const sales = userMap['sales'];
  const dev   = userMap['dev'];

  // get dev2, dev3, mkt2, sales2, sales3 IDs
  const allUsers = await userModel.find({ email: { $in: SEED_USERS.map(u => u.email) } });
  const byEmail: Record<string, Types.ObjectId> = {};
  for (const u of allUsers) byEmail[u.email] = u._id as Types.ObjectId;
  const dev2   = byEmail['dev2@demo.com'];
  const dev3   = byEmail['dev3@demo.com'];
  const mkt2   = byEmail['mkt2@demo.com'];
  const sales2 = byEmail['sales2@demo.com'];
  const sales3 = byEmail['sales3@demo.com'];

  // ── 2. Idempotency ────────────────────────────────────────────────────────
  const fullySeeded = await wbModel.findOne({ ownerId: admin, name: 'Team OKR Tracker — Q3 2025' });
  if (fullySeeded) {
    console.log('Seed data already present — skipping.');
    await app.close(); process.exit(0);
  }

  const seedNs = ['prism-web', 'prism-api', 'prism-marketing', 'prism-mobile'];
  const existingProjects = await projectModel.find({ ownerId: admin, namespace: { $in: seedNs } });
  if (existingProjects.length) {
    const pIds = existingProjects.map(p => p._id);
    await issueModel.deleteMany({ projectId: { $in: pIds } });
    await wikiModel.deleteMany({ projectId: { $in: pIds } });
    await mrModel.deleteMany({ projectId: { $in: pIds } });
    await projectModel.deleteMany({ _id: { $in: pIds } });
  }
  await noteModel.deleteMany({ ownerId: { $in: [admin, cpo, mkt, dev, dev2, dev3, mkt2, sales, sales2, sales3] } });
  await folderModel.deleteMany({ ownerId: { $in: [admin, cpo, mkt, dev, dev2, dev3, mkt2, sales, sales2, sales3] } });
  await wbModel.deleteMany({ ownerId: { $in: [admin, sales, cpo, dev, mkt] } });
  await fileModel.deleteMany({ ownerId: { $in: [admin, cpo, mkt, dev, dev2, dev3, mkt2, sales] } });
  await fileFolderModel.deleteMany({ ownerId: { $in: [admin, cpo, mkt, dev, dev2, mkt2, sales] } });

  // ── 3. Projects ───────────────────────────────────────────────────────────
  const projects = await projectModel.insertMany([
    {
      name: 'Prism Web App', namespace: 'prism-web',
      desc: 'Next.js frontend — App Router, TanStack Query, spreadsheet, notes editor, and all user-facing features.',
      visibility: 'internal', ownerId: admin, color: '#6366f1',
      members: [cpo, dev, dev2, dev3, mkt],
    },
    {
      name: 'Prism API', namespace: 'prism-api',
      desc: 'NestJS backend — REST API, MongoDB, JWT auth, real-time notifications, file storage, and all business logic.',
      visibility: 'internal', ownerId: admin, color: '#0ea5e9',
      members: [dev, dev2, dev3, cpo],
    },
    {
      name: 'Marketing Website', namespace: 'prism-marketing',
      desc: 'Public-facing marketing site on Next.js + Vercel. Owned by Marketing; dev support for perf and infra.',
      visibility: 'internal', ownerId: mkt, color: '#f59e0b',
      members: [admin, dev, mkt2],
    },
    {
      name: 'Mobile App', namespace: 'prism-mobile',
      desc: 'React Native companion for iOS and Android. Beta — issues, notifications, kanban.',
      visibility: 'private', ownerId: cpo, color: '#10b981',
      members: [dev, dev2, admin],
    },
  ]);
  const [pWeb, pApi, pMkt, pMobile] = projects;

  // ── 4. Issues ─────────────────────────────────────────────────────────────
  const issues = await issueModel.insertMany([
    // Prism Web App
    { projectId: pWeb._id, title: 'Formula bar loses focus on Escape', type: 'bug', status: 'in_progress', priority: 'high', assigneeId: dev, authorId: admin, dueDate: daysFromNow(4), labels: ['spreadsheet','ux'], desc: 'Pressing Escape in the formula bar moves focus to browser chrome instead of returning to the selected cell. Reproducible in Chrome 124 and Firefox 126.', comments: [{ authorId: dev, body: 'Found the issue in formula-bar.tsx — KeyboardEvent default not prevented. Fix is one line.', createdAt: daysAgo(1) }] },
    { projectId: pWeb._id, title: 'Dark-mode support missing in Import CSV modal', type: 'feature', status: 'todo', priority: 'medium', assigneeId: dev2, authorId: cpo, labels: ['ui','dark-mode'], desc: 'Import modal background is hardcoded white. Needs to use `bg-card` / `border` tokens.' },
    { projectId: pWeb._id, title: 'Sidebar badge count stale after quickDoneIssue', type: 'bug', status: 'todo', priority: 'medium', assigneeId: dev3, authorId: dev, labels: ['sidebar','my-work'], desc: '`updateBadges()` not called after `quickDoneIssue()`. Badge shows old count until full refresh.' },
    { projectId: pWeb._id, title: 'Keyboard shortcut help overlay (Shift+?)', type: 'feature', status: 'in_progress', priority: 'low', assigneeId: dev2, authorId: cpo, labels: ['keyboard','ux'], desc: 'Modal listing all shortcuts in the current view, triggered by Shift+?' },
    { projectId: pWeb._id, title: 'Kanban WIP limit badge flicker on card drag', type: 'bug', status: 'done', priority: 'low', assigneeId: dev, authorId: dev, labels: ['kanban'], desc: 'WIP badge only updates on next render cycle when card moved.', comments: [{ authorId: dev, body: 'Fixed by flushing state synchronously in drag-end handler.', createdAt: daysAgo(3) }, { authorId: admin, body: 'Verified in staging. Merged.', createdAt: daysAgo(2) }] },
    { projectId: pWeb._id, title: 'Cell overflow bleeds into adjacent cells in Safari', type: 'bug', status: 'in_progress', priority: 'high', assigneeId: dev3, authorId: admin, dueDate: daysFromNow(2), labels: ['spreadsheet','safari'], desc: 'Padding on outer TD causes overflow in Safari when `cell.s.wrap=false` and content exceeds column width.' },
    { projectId: pWeb._id, title: 'Notes slash-command menu flickers on fast typing', type: 'bug', status: 'todo', priority: 'low', assigneeId: dev, authorId: dev, labels: ['notes','performance'], desc: 'Slash menu re-renders once per keystroke before closing — visible on slower machines.' },
    { projectId: pWeb._id, title: 'Export workbook to Google Sheets', type: 'feature', status: 'todo', priority: 'medium', assigneeId: null, authorId: cpo, labels: ['spreadsheet','integrations'], desc: 'One-click export that opens a new Google Sheet. Requires OAuth + Sheets API.' },
    { projectId: pWeb._id, title: 'Add conditional formatting color scale', type: 'feature', status: 'todo', priority: 'medium', assigneeId: dev2, authorId: cpo, labels: ['spreadsheet'], desc: 'Color scale rule type for conditional formatting — gradient from min to max value across a range.' },
    { projectId: pWeb._id, title: 'File manager drag-to-folder not working on Firefox', type: 'bug', status: 'in_progress', priority: 'medium', assigneeId: dev3, authorId: admin, labels: ['files'], desc: 'HTML5 DnD drop event fires but ownerId context is lost — Firefox handles dataTransfer differently.' },
    // Prism API
    { projectId: pApi._id, title: 'JWT refresh fails silently on MongoDB replica step-down', type: 'bug', status: 'in_progress', priority: 'critical', assigneeId: dev, authorId: admin, dueDate: daysFromNow(1), labels: ['auth','reliability'], desc: 'During replica election refresh endpoint returns 500. Client retries forever instead of re-login.', comments: [{ authorId: dev, body: 'Added retry with exponential backoff. Testing against simulated failover.', createdAt: daysAgo(1) }] },
    { projectId: pApi._id, title: 'Rate limiting too aggressive for bulk CSV imports', type: 'bug', status: 'todo', priority: 'high', assigneeId: dev2, authorId: cpo, labels: ['rate-limiting','spreadsheet'], dueDate: daysFromNow(7), desc: 'Medium-window limiter fires during XLSX imports because each cell patch is a separate request.' },
    { projectId: pApi._id, title: 'Full-text search across wiki pages', type: 'feature', status: 'todo', priority: 'medium', assigneeId: dev3, authorId: cpo, labels: ['search','wiki'], desc: 'Add WikiPage to search aggregation pipeline with $text index and matched excerpts.' },
    { projectId: pApi._id, title: 'NotesPdfService crashes on empty block array', type: 'bug', status: 'done', priority: 'medium', assigneeId: dev, authorId: dev, labels: ['notes','pdf'], desc: 'pdfkit throws when blocks=[]. Should return minimal PDF with just title.' },
    { projectId: pApi._id, title: 'Migrate GridFS uploads to S3-compatible storage', type: 'task', status: 'todo', priority: 'high', assigneeId: dev2, authorId: admin, labels: ['infrastructure','files'], dueDate: daysFromNow(21), desc: 'Legal needs files in EU-region bucket. Add S3Storage behind STORAGE_DRIVER=s3 env flag.' },
    { projectId: pApi._id, title: 'Integration tests for 2FA TOTP flow', type: 'task', status: 'todo', priority: 'medium', assigneeId: dev3, authorId: dev, labels: ['testing','auth'], desc: 'No tests cover /me/2fa/setup → confirm → login → /auth/2fa/verify path.' },
    { projectId: pApi._id, title: 'Webhook endpoint for issue status changes', type: 'feature', status: 'todo', priority: 'low', assigneeId: null, authorId: cpo, labels: ['integrations','webhooks'], desc: 'External integrations need POST webhooks when issue moves status. Add Webhook schema + fire in IssuesService.update().' },
    { projectId: pApi._id, title: 'Add workbook sharing via public link', type: 'feature', status: 'in_progress', priority: 'medium', assigneeId: dev2, authorId: cpo, labels: ['spreadsheet','sharing'], desc: 'Generate a signed read-only URL for a workbook that works without login.' },
    // Marketing Website
    { projectId: pMkt._id, title: 'Landing page LCP 4.2s on mobile', type: 'bug', status: 'in_progress', priority: 'high', assigneeId: dev, authorId: mkt, dueDate: daysFromNow(3), labels: ['performance','seo'], desc: 'Hero image not served as WebP on mobile. Missing `sizes` prop causes full-res PNG download.', comments: [{ authorId: dev, body: 'Added sizes and WebP source. LCP drops to 1.8s locally.', createdAt: daysAgo(1) }] },
    { projectId: pMkt._id, title: 'Customer logo carousel on homepage', type: 'feature', status: 'todo', priority: 'medium', assigneeId: dev3, authorId: mkt, labels: ['homepage','ui'], desc: '12 customer logos, auto-scroll with pause on hover. Assets in shared drive.' },
    { projectId: pMkt._id, title: 'Blog RSS feed returns 404', type: 'bug', status: 'done', priority: 'medium', assigneeId: dev, authorId: mkt, labels: ['blog','seo'], desc: '/blog/rss.xml broken since Next.js 14 upgrade. Old getServerSideProps no longer works in App Router.' },
    { projectId: pMkt._id, title: 'HubSpot form integration on Contact page', type: 'task', status: 'todo', priority: 'medium', assigneeId: mkt2, authorId: sales, labels: ['crm','forms'], dueDate: daysFromNow(10), desc: 'Replace mailto: link with embedded HubSpot form.' },
    { projectId: pMkt._id, title: 'A/B test hero headline copy', type: 'task', status: 'todo', priority: 'low', assigneeId: mkt2, authorId: mkt, labels: ['copy','analytics'], desc: 'Test 3 headline variants using PostHog feature flags. Run for 2 weeks minimum.' },
    // Mobile App
    { projectId: pMobile._id, title: 'Push notifications not received on iOS 17.4', type: 'bug', status: 'in_progress', priority: 'critical', assigneeId: dev, authorId: cpo, dueDate: daysFromNow(1), labels: ['ios','notifications'], desc: 'APNs certificates expired. Need to regenerate and upload to Expo push service.', comments: [{ authorId: cpo, body: 'Blocking beta testers — P0.', createdAt: daysAgo(2) }, { authorId: dev, body: 'New cert generated. Awaiting Apple review.', createdAt: daysAgo(1) }] },
    { projectId: pMobile._id, title: 'Offline mode with local SQLite cache', type: 'feature', status: 'todo', priority: 'high', assigneeId: null, authorId: cpo, labels: ['offline','architecture'], dueDate: daysFromNow(45), desc: 'expo-sqlite + background sync queue that drains on connectivity restore.' },
    { projectId: pMobile._id, title: 'Dark mode follows system on Android but not iOS', type: 'bug', status: 'todo', priority: 'low', assigneeId: dev2, authorId: dev, labels: ['ios','dark-mode'], desc: 'useColorScheme returns `light` always on iOS until app is backgrounded.' },
    { projectId: pMobile._id, title: 'Biometric login (FaceID / Fingerprint)', type: 'feature', status: 'todo', priority: 'medium', assigneeId: dev3, authorId: cpo, labels: ['auth','ux'], desc: 'Store refresh token in Expo SecureStore, unlock with biometrics instead of PIN.' },
  ]);

  // ── 5. Kanban boards ──────────────────────────────────────────────────────
  const prodCols  = [
    { id: 'backlog', name: 'Backlog', color: 'slate', collapsed: false, builtin: true },
    { id: 'in_design', name: 'In Design', color: 'violet', collapsed: false, builtin: true },
    { id: 'in_progress', name: 'Development', color: 'blue', collapsed: false, builtin: true },
    { id: 'review', name: 'In Review', color: 'amber', collapsed: false, builtin: false },
    { id: 'qa', name: 'QA', color: 'orange', collapsed: false, builtin: true },
    { id: 'done', name: 'Released', color: 'green', collapsed: false, builtin: true },
  ];
  const devCols = [
    { id: 'todo', name: 'To Do', color: 'slate', collapsed: false, builtin: true },
    { id: 'in_progress', name: 'In Progress', color: 'blue', collapsed: false, builtin: true },
    { id: 'review', name: 'Review', color: 'amber', collapsed: false, builtin: false },
    { id: 'done', name: 'Done', color: 'green', collapsed: false, builtin: true },
  ];
  const adminCols = [
    { id: 'todo', name: 'Open', color: 'slate', collapsed: false, builtin: true },
    { id: 'in_progress', name: 'In Progress', color: 'blue', collapsed: false, builtin: true },
    { id: 'waiting', name: 'Waiting', color: 'amber', collapsed: false, builtin: false },
    { id: 'done', name: 'Completed', color: 'green', collapsed: false, builtin: true },
  ];
  const mktCols = [
    { id: 'drafting', name: 'Drafting', color: 'violet', collapsed: false, builtin: true },
    { id: 'in_progress', name: 'In Production', color: 'blue', collapsed: false, builtin: true },
    { id: 'review', name: 'Review', color: 'amber', collapsed: false, builtin: false },
    { id: 'done', name: 'Published', color: 'green', collapsed: false, builtin: true },
  ];
  const salesCols = [
    { id: 'prospecting', name: 'Prospecting', color: 'slate', collapsed: false, builtin: true },
    { id: 'in_progress', name: 'Active Deal', color: 'blue', collapsed: false, builtin: true },
    { id: 'waiting', name: 'Proposal Sent', color: 'amber', collapsed: false, builtin: false },
    { id: 'done', name: 'Closed Won', color: 'green', collapsed: false, builtin: true },
  ];

  for (const [userId, columns] of [
    [admin, adminCols], [cpo, prodCols], [dev, devCols], [dev2, devCols], [dev3, devCols],
    [mkt, mktCols], [mkt2, mktCols], [sales, salesCols], [sales2, salesCols], [sales3, salesCols],
  ] as [Types.ObjectId, typeof adminCols][]) {
    await kbBoardModel.updateOne({ userId }, { $setOnInsert: { columns } }, { upsert: true });
  }

  const statusToDevCol: Record<string, string> = { todo: 'todo', in_progress: 'in_progress', done: 'done', review: 'review' };
  const devAssigned = issues.filter(i => [String(dev), String(dev2), String(dev3)].includes(String(i.assigneeId)));
  for (const i of devAssigned) {
    const uid = String(i.assigneeId) === String(dev2) ? dev2 : String(i.assigneeId) === String(dev3) ? dev3 : dev;
    await kbPosModel.updateOne(
      { userId: uid, issueId: i._id },
      { $setOnInsert: { columnId: statusToDevCol[i.status] ?? 'todo' } },
      { upsert: true },
    );
  }

  // ── 6. Merge Requests ─────────────────────────────────────────────────────
  await mrModel.insertMany([
    { title: 'fix: prevent Escape from blurring formula bar', sourceBranch: 'fix/formula-bar-escape', targetBranch: 'main', projectId: pWeb._id, authorId: dev, reviewerId: admin, status: 'open', desc: 'Calls e.preventDefault() in the Escape handler inside formula-bar.tsx. Adds unit test.', comments: [{ authorId: admin, body: 'Looks clean. Add a snapshot test for the focused state?', createdAt: daysAgo(1) }, { authorId: dev, body: 'Snapshot added in formula-bar.test.tsx.', createdAt: daysAgo(0) }] },
    { title: 'feat: keyboard shortcut help overlay (Shift+?)', sourceBranch: 'feat/shortcut-help', targetBranch: 'main', projectId: pWeb._id, authorId: dev2, reviewerId: cpo, status: 'open', desc: 'Adds <ShortcutHelpModal> triggered by Shift+? globally. Keys grouped by section.' },
    { title: 'feat: conditional formatting color scale', sourceBranch: 'feat/cond-fmt-colorscale', targetBranch: 'main', projectId: pWeb._id, authorId: dev2, reviewerId: dev, status: 'open', desc: 'Adds colorScale rule type to cond-fmt.ts and the ConditionalFormatPanel UI.', comments: [{ authorId: dev, body: 'The gradient interpolation looks right. Can you add a test with a 3-color scale?', createdAt: daysAgo(1) }] },
    { title: 'fix: retry JWT refresh on MongoNetworkError', sourceBranch: 'fix/jwt-refresh-mongo-retry', targetBranch: 'main', projectId: pApi._id, authorId: dev, reviewerId: admin, status: 'open', desc: 'Wraps refresh DB lookup in retry loop (max 3 attempts, 100ms backoff). Returns 503 on exhaustion.', comments: [{ authorId: admin, body: 'Add a Retry-After header so load balancers can act on it.', createdAt: daysAgo(1) }] },
    { title: 'feat: public share link for workbooks', sourceBranch: 'feat/workbook-public-link', targetBranch: 'main', projectId: pApi._id, authorId: dev2, reviewerId: admin, status: 'open', desc: 'Generates a signed read-only URL using HMAC-SHA256. No auth required for public viewers.' },
    { title: 'fix: NotesPdfService guard against empty blocks', sourceBranch: 'fix/notes-pdf-empty-blocks', targetBranch: 'main', projectId: pApi._id, authorId: dev3, reviewerId: admin, status: 'merged', decidedAt: daysAgo(2), decidedById: admin, desc: 'Early-returns a minimal PDF with just the title when blocks is empty.', comments: [{ authorId: admin, body: 'LGTM. Merging.', createdAt: daysAgo(2) }] },
    { title: 'fix: hero image WebP + correct sizes prop', sourceBranch: 'fix/landing-hero-webp', targetBranch: 'main', projectId: pMkt._id, authorId: dev, reviewerId: mkt, status: 'merged', decidedAt: daysAgo(1), decidedById: mkt, desc: 'Sets sizes attribute, switches to WebP. LCP 4.2s → 1.8s on mobile.' },
    { title: 'fix: blog RSS as App Router route handler', sourceBranch: 'fix/blog-rss-route-handler', targetBranch: 'main', projectId: pMkt._id, authorId: dev3, reviewerId: mkt, status: 'merged', decidedAt: daysAgo(5), decidedById: mkt, desc: 'Replaces legacy getServerSideProps with a GET Route Handler at app/blog/rss.xml/route.ts.' },
    { title: 'fix: WIP limit badge flicker on card drag', sourceBranch: 'fix/kanban-wip-flash', targetBranch: 'main', projectId: pWeb._id, authorId: dev, reviewerId: admin, status: 'merged', decidedAt: daysAgo(3), decidedById: admin, desc: 'Synchronously flushes column state in dragend handler before React re-renders badge count.' },
    { title: 'fix: file drag-to-folder on Firefox', sourceBranch: 'fix/file-dnd-firefox', targetBranch: 'main', projectId: pWeb._id, authorId: dev3, reviewerId: dev, status: 'open', desc: 'Stores ownerId in dataTransfer.setData on dragstart so Firefox retains it through drop.' },
    { title: 'feat: biometric login for mobile', sourceBranch: 'feat/biometric-login', targetBranch: 'main', projectId: pMobile._id, authorId: dev2, reviewerId: cpo, status: 'open', desc: 'Stores refresh token in Expo SecureStore, unlocks with FaceID/Fingerprint via expo-local-authentication.' },
  ]);

  // ── 7. Wiki pages ─────────────────────────────────────────────────────────

  // ── 7a. Prism API wiki ────────────────────────────────────────────────────
  const apiRoot = await wikiModel.create({
    projectId: pApi._id, authorId: admin, parentId: null,
    title: 'Prism API — Overview',
    content: `# Prism API

**NestJS** application backed by **MongoDB** (Mongoose ODM). All endpoints sit under \`/api/v1\`.

## Auth model
- Access tokens: JWT HS256, 15-minute TTL
- Refresh tokens stored in MongoDB, rotate on every use
- Two-factor TOTP optional per user

## Key modules
| Module | Purpose |
|---|---|
| auth | Login, refresh, 2FA, API tokens |
| users | Profile, 2FA setup, API token CRUD |
| projects | CRUD, member management |
| issues | Bug/feature/task tracking with comments |
| workbooks | Google-Sheets-style spreadsheets |
| notes | Block-model rich-text notes |
| wiki | Hierarchical project documentation |
| files | GridFS upload/download |
| notifications | WebSocket push + cron reminders |
| search | Cross-entity full-text search |

## Local setup
\`\`\`bash
cp apps/api/.env.example apps/api/.env
pnpm dev:api   # http://localhost:4000/api/v1
\`\`\``,
  });

  const apiAuth = await wikiModel.create({
    projectId: pApi._id, authorId: dev, parentId: apiRoot._id,
    title: 'Authentication Flow',
    content: `# Authentication Flow

## Login
\`POST /auth/login\` — accepts \`{ email, password }\`.

Normal response: \`{ accessToken, refreshToken, user }\`
2FA user response: \`{ requiresTwoFactor: true, tempToken }\`

Follow-up: \`POST /auth/2fa/verify\` with \`{ tempToken, code }\` → real tokens.

## Token refresh
\`POST /auth/refresh\` — accepts \`{ refreshToken }\`. Returns new \`{ accessToken, refreshToken }\`. Old token invalidated.

## Guards
\`JwtAuthGuard\` is APP_GUARD globally. Mark \`@Public()\` to skip auth.

## API tokens
Long-lived hashed tokens (bcrypt). Raw token shown once on creation.
Pass as \`Authorization: Bearer <token>\`.`,
  });

  await wikiModel.insertMany([
    {
      projectId: pApi._id, authorId: dev, parentId: apiAuth._id,
      title: 'Two-Factor Authentication (TOTP)',
      content: `# Two-Factor Authentication

## Setup flow
1. \`POST /me/2fa/setup\` — generates TOTP secret, returns URI for QR code (not yet active)
2. \`POST /me/2fa/confirm\` — accepts 6-digit code; stores secret if valid, activates 2FA
3. \`POST /me/2fa/disable\` — accepts 6-digit code to deactivate

## Login with 2FA active
The auth service returns \`{ requiresTwoFactor: true, tempToken }\` instead of full tokens.
Client shows TOTP prompt → \`POST /auth/2fa/verify\` → real access + refresh tokens.

## Implementation
Uses **speakeasy** (TOTP RFC 6238) with a 30-second window ±1 step for clock drift tolerance.
Secret is stored encrypted on the user document; \`twoFactorEnabled: boolean\` is the gate.`,
    },
    {
      projectId: pApi._id, authorId: dev, parentId: apiRoot._id,
      title: 'Module Conventions',
      content: `# Module Conventions

Every domain module follows the same shape:

\`\`\`
modules/<name>/
  schemas/<entity>.schema.ts   ← Mongoose @Schema
  dto/<entity>.dto.ts          ← Zod schemas + inferred types
  <name>.service.ts            ← business logic
  <name>.controller.ts         ← @Controller + @UsePipes(ZodValidationPipe)
  <name>.module.ts             ← wiring
\`\`\`

## Ownership pattern
\`\`\`ts
const doc = await this.model.findById(id).lean();
if (!doc) throw new NotFoundException();
if (String(doc.ownerId) !== ownerId) throw new ForbiddenException();
\`\`\`
Never filter ownership via \`findById({ ownerId })\` — that merges 404 and 403.

## Validation
Bind Zod schemas with \`@UsePipes(new ZodValidationPipe(Schema))\`.
The pipe is body-only — skips \`@Param\`, \`@Query\`, \`@CurrentUser\`.`,
    },
  ]);

  const apiDb = await wikiModel.create({
    projectId: pApi._id, authorId: dev2, parentId: apiRoot._id,
    title: 'Database Design',
    content: `# Database Design

MongoDB via Mongoose ODM. All collections use \`timestamps: true\` (createdAt, updatedAt).

## Collections
| Collection | Key indexes |
|---|---|
| users | email (unique) |
| projects | ownerId, namespace (unique) |
| issues | projectId+status, assigneeId, dueDate |
| workbooks | ownerId, grants.userId, grants.role |
| notes | ownerId+folderId+updatedAt |
| wiki_pages | projectId+updatedAt |
| files | ownerId+folderId |
| folders | ownerId, grants.userId, grants.role |
| activity | actorId+createdAt, projectId+createdAt |

## ObjectId references
All cross-document references use \`Types.ObjectId\`. Never store as plain string.
Service layer converts with \`new Types.ObjectId(id)\` before queries.

## Mixed / Object fields
\`@Prop({ type: Object, default: {} })\` for sparse maps (e.g. Sheet.cells, colWidths).
Always apply \`?? {}\` defensive fallback when reading — Mongoose may strip empty maps on roundtrip.`,
  });

  await wikiModel.insertMany([
    {
      projectId: pApi._id, authorId: dev2, parentId: apiDb._id,
      title: 'Index Strategy',
      content: `# Index Strategy

## Compound indexes
\`\`\`ts
// Activity — two most common query shapes
ActivitySchema.index({ actorId: 1, createdAt: -1 });
ActivitySchema.index({ projectId: 1, createdAt: -1 });

// Notes — list view (sorted by updatedAt within a folder)
NoteSchema.index({ ownerId: 1, folderId: 1, updatedAt: -1 });
\`\`\`

## Grant indexes
Workbooks and Folders have grants arrays with discriminated union (userId | role).
Both are separately indexed so the service can query either efficiently:
\`\`\`ts
WorkbookSchema.index({ 'grants.userId': 1 });
WorkbookSchema.index({ 'grants.role': 1 });
\`\`\`

## Text indexes (planned)
Issues title+desc and WikiPage title+content will get \`$text\` indexes for the full-text search feature (tracked in issue #11).`,
    },
    {
      projectId: pApi._id, authorId: dev3, parentId: apiRoot._id,
      title: 'Real-time Notifications',
      content: `# Real-time Notifications

## Architecture
\`NotificationsGateway\` — Socket.io server at namespace \`/ws/notifications\`.

On connect, client sends JWT as query param (\`?token=...\`). Gateway validates, joins socket to room named after user's MongoDB \`_id\`.

## Sending notifications
From any service:
\`\`\`ts
this.notificationsGateway.pushToUser(userId, {
  type: 'issue.assigned',
  title: 'You were assigned to "Fix login bug"',
  link: '/issues/abc123',
});
\`\`\`

## Scheduled reminders
\`NotificationsScheduler\` runs cron jobs (via \`@nestjs/schedule\`):
- Due-date reminders: daily at 08:00 UTC for issues due in the next 24 hours
- Overdue alerts: daily at 09:00 UTC

## Frontend
\`use-notifications-socket.ts\` connects on mount, updates TanStack Query cache on events.`,
    },
    {
      projectId: pApi._id, authorId: admin, parentId: apiRoot._id,
      title: 'Deployment Guide',
      content: `# Deployment Guide

## Docker (production)
\`\`\`bash
cd prism/
cp .env.docker.example .env
# Fill in JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (≥32 chars each)
docker-compose up --build
\`\`\`

Services started:
- **mongo** — MongoDB 7 with replica set for change streams
- **api** — NestJS on port 4000
- **web** — Next.js on port 3000

## Environment variables
| Variable | Required | Notes |
|---|---|---|
| MONGODB_URI | ✅ | Full connection string |
| JWT_ACCESS_SECRET | ✅ | ≥32 chars |
| JWT_REFRESH_SECRET | ✅ | ≥32 chars, different from access |
| WEB_ORIGIN | ✅ | CORS allow-origin |
| SMTP_HOST | optional | Email disabled if absent |
| STORAGE_DRIVER | optional | \`gridfs\` (default) or \`s3\` |

## File storage
Files go to MongoDB GridFS by default (\`MongoStorage\`). Set \`STORAGE_DRIVER=s3\` + \`S3_*\` vars for S3-compatible storage (in progress — tracked in API issue #15).`,
    },
  ]);

  // ── 7b. Prism Web wiki ────────────────────────────────────────────────────
  const webRoot = await wikiModel.create({
    projectId: pWeb._id, authorId: cpo, parentId: null,
    title: 'Prism Web — Developer Guide',
    content: `# Prism Web Developer Guide

Built with **Next.js 14 App Router**, TanStack Query, Zustand, Tailwind CSS.

## Quick start
\`\`\`bash
pnpm install
pnpm dev:web   # http://localhost:3000
\`\`\`

## Route layout
- \`(auth)/\` — login/register, no sidebar
- \`(app)/\` — authenticated app; layout redirects to \`/login?next=<path>\` when no session

## Data flow
Service object + hook pair for every feature:
\`\`\`ts
export const useX  = () => useQuery({ queryKey: ['x'], queryFn: svc.list });
export function useXMutations() { /* create/update/remove */ }
\`\`\`

## UI primitives
\`Button\`, \`Modal\`, \`Confirm\`, \`Input\`, \`Field\`, \`Select\`, \`Tabs\`, \`Avatar\`, \`Toaster\` — all in \`components/ui\`.`,
  });

  const webArch = await wikiModel.create({
    projectId: pWeb._id, authorId: dev, parentId: webRoot._id,
    title: 'Architecture',
    content: `# Architecture

## Tech stack
| Layer | Tech |
|---|---|
| Framework | Next.js 14 App Router |
| Server state | TanStack Query v5 |
| Client state | Zustand |
| Styling | Tailwind CSS (CSS-var tokens) |
| Validation | Zod (shared with API DTOs) |
| HTTP | Axios with silent 401 refresh |

## Folder structure
\`\`\`
src/
  app/           ← Next.js routes
  components/
    ui/          ← primitives (Button, Modal, …)
    layout/      ← Sidebar, Topbar
    feature/     ← domain components (sheets/, notes/, …)
  hooks/         ← useQuery + useMutation hooks
  lib/           ← utilities (api.ts, sheets/*, cn)
  schemas/       ← Zod schemas + TypeScript types
  stores/        ← Zustand stores
\`\`\``,
  });

  await wikiModel.insertMany([
    {
      projectId: pWeb._id, authorId: dev, parentId: webArch._id,
      title: 'State Management',
      content: `# State Management

## Server state — TanStack Query
All API data lives in TanStack Query. Cache keys follow the pattern:
\`\`\`ts
['resource']           // list
['resource','byId',id] // detail
\`\`\`

Mutations always do two things on success:
\`\`\`ts
qc.setQueryData(['x','byId',id], updated);  // instant detail update
qc.invalidateQueries({ queryKey: ['x'], exact: true });  // refresh list
\`\`\`

## Client state — Zustand
| Store | Purpose |
|---|---|
| useAuthStore | Current user + tokens |
| useThemeStore | dark/light + accent color |
| useSidebarStore | collapsed state |

## Axios client
\`lib/api.ts\` — attaches bearer token, handles 401 by calling \`/auth/refresh\` once (de-duped via promise ref). Toasts on 4xx/5xx automatically — **don't add manual try/catch for toasts**.`,
    },
    {
      projectId: pWeb._id, authorId: dev2, parentId: webArch._id,
      title: 'Component Library',
      content: `# Component Library

Shadcn-style components in \`components/ui/\` — built on Tailwind + Radix primitives.

## Button
\`\`\`tsx
<Button variant="grad">Publish</Button>
<Button variant="primary">Save</Button>
<Button variant="outline">Cancel</Button>
<Button variant="danger">Delete</Button>
\`\`\`
Uses \`cva\` for variant composition.

## Modal / Confirm
\`\`\`tsx
<Modal open={open} onClose={() => setOpen(false)} title="Edit Issue">
  ...
</Modal>
<Confirm message="Delete this note?" onConfirm={handleDelete} />
\`\`\`

## Tailwind tokens
Color tokens: \`accent.*\`, \`bg\`, \`bg-card\`, \`bg-subtle\`, \`bg-hover\`, \`text\`, \`text-sub\`, \`text-muted\`, \`border\`, \`border-strong\`.

Spacing: \`sb\` (240px sidebar), \`sb-collapsed\` (68px), \`tb\` (60px topbar).`,
    },
    {
      projectId: pWeb._id, authorId: dev, parentId: webRoot._id,
      title: 'Spreadsheet — Deep Dive',
      content: `# Spreadsheet Deep Dive

The \`/tables\` route hosts a Google-Sheets-style spreadsheet. It's the largest subsystem.

## Data flow
\`\`\`
sheets-shell.tsx  ← orchestrator (state, history, clipboard, fill)
  grid.tsx        ← virtual table render
  formula-bar.tsx ← formula editing
  toolbar.tsx     ← formatting tools
  sheet-tabs.tsx  ← multi-sheet navigation
\`\`\`

## Mutation convention
**All sheet changes go through \`mutateSheet(fn, label)\`.**
- Pass a \`label\` (e.g. \`'edit'\`, \`'format'\`, \`'paste'\`) to push to undo history.
- Omit label for silent changes (don't push to history).

## Formula engine
\`lib/sheets/formula.ts\` — tokenizer + recursive-descent parser + evaluator.
Supported: \`SUM AVERAGE COUNT COUNTA MIN MAX IF IFERROR AND OR NOT CONCAT LEN UPPER LOWER TRIM ROUND ABS SQRT POWER PI TODAY NOW\`

Error types: \`#REF! #NAME? #VALUE! #DIV/0! #CIRCULAR! #ERROR!\``,
    },
    {
      projectId: pWeb._id, authorId: dev3, parentId: webRoot._id,
      title: 'CI/CD & Deployment',
      content: `# CI/CD & Deployment

## GitHub Actions
Two workflows:
- **ci.yml** — runs on every PR: \`tsc --noEmit\`, \`pnpm lint\`, \`pnpm build\`
- **deploy.yml** — runs on merge to \`main\`: builds Docker images, pushes to registry, triggers Kubernetes rollout

## Environments
| Env | Branch | URL |
|---|---|---|
| Local | any | localhost:3000 / localhost:4000 |
| Staging | \`develop\` | staging.prism.app |
| Production | \`main\` | app.prism.app |

## NEXT_PUBLIC_API_URL
Baked into the Next.js bundle at build time. Must be set to the *browser-accessible* API URL before building.
For Docker compose, the server-side \`API_URL\` uses the internal Docker network name (\`api:4000\`).

## Type checking
\`pnpm --filter web typecheck\` — runs \`tsc --noEmit\` against the web app. Run before pushing.`,
    },
  ]);

  // ── 7c. Marketing wiki ────────────────────────────────────────────────────
  const mktRoot = await wikiModel.create({
    projectId: pMkt._id, authorId: mkt, parentId: null,
    title: 'Marketing Playbook',
    content: `# Marketing Playbook

Central knowledge base for the Prism marketing team. Covers SEO, content, paid campaigns, and analytics.

## Quick links
- [SEO Strategy](#) — keyword targets and technical SEO checklist
- [Content Calendar](#) — blog and social posting schedule
- [Analytics Dashboard](#) — PostHog + Google Analytics

## Brand voice
**Tone**: Direct, technical-but-approachable. We write for developers and PMs, not executives.
**Never**: jargon-heavy sales copy, vague "synergy" language, exclamation marks in headlines.

## Tools
| Tool | Purpose |
|---|---|
| PostHog | Product analytics, A/B testing |
| HubSpot | CRM, email marketing |
| Vercel Analytics | Web vitals |
| Ahrefs | Keyword research, backlinks |`,
  });

  const mktSeo = await wikiModel.create({
    projectId: pMkt._id, authorId: mkt, parentId: mktRoot._id,
    title: 'SEO Strategy',
    content: `# SEO Strategy

## Target keywords
| Keyword | Monthly volume | Difficulty | Status |
|---|---|---|---|
| project management software | 110k | 82 | Targeting via blog |
| notion alternative | 22k | 61 | Landing page live |
| spreadsheet project management | 4.4k | 38 | ✅ Ranking #4 |
| kanban board online free | 18k | 55 | Blog post in progress |
| gitlab alternative | 9.9k | 70 | Not yet targeted |

## Technical SEO checklist
- ✅ Core Web Vitals all green on desktop
- ✅ LCP < 2.5s on desktop; mobile LCP fix in progress (issue #19)
- ✅ Sitemap at /sitemap.xml (auto-generated by Next.js)
- ✅ Canonical URLs on all pages
- ⬜ Schema markup (Product, FAQPage) on landing page
- ⬜ Hreflang tags for planned i18n (EN/FR/DE)`,
  });

  await wikiModel.insertMany([
    {
      projectId: pMkt._id, authorId: mkt2, parentId: mktSeo._id,
      title: 'Technical SEO Checklist',
      content: `# Technical SEO Checklist

## Page speed
- ✅ Images served as WebP with correct \`sizes\` attribute
- ✅ Font subsetting via \`next/font\`
- ✅ JavaScript bundle < 200KB first load (currently 178KB)
- ⬜ Remove unused CSS (currently 14KB unused in global.css)

## Crawlability
- ✅ robots.txt allows all, disallows /api
- ✅ XML sitemap submitted to Google Search Console
- ✅ No redirect chains longer than 2 hops
- ⬜ Fix 3 soft 404s flagged in Search Console (blog posts with 200 status but empty content)

## Structured data
Add JSON-LD for:
1. \`Product\` schema on main landing page
2. \`Article\` schema on all blog posts
3. \`FAQPage\` schema on pricing page (reduces SERP space needed for competitors)`,
    },
    {
      projectId: pMkt._id, authorId: mkt, parentId: mktRoot._id,
      title: 'Content Calendar',
      content: `# Content Calendar — Q2 2025

## Blog posts
| Publish date | Title | Author | Status |
|---|---|---|---|
| May 6 | "How we built a Google Sheets clone in Next.js" | Dev Kim | ✅ Published |
| May 13 | "5 project management anti-patterns (and how Prism fixes them)" | Maya | ✅ Published |
| May 20 | "Kanban vs Scrum: which works for remote teams?" | Lena | 🔄 In review |
| May 27 | "How to use spreadsheets for sprint planning" | Jordan | 📝 Draft |
| Jun 3 | "Product Hunt launch debrief" | Maya | 📅 Planned |

## Social media
Posting schedule: Twitter/X 3×/week, LinkedIn 2×/week.
Content mix: 40% product updates, 30% thought leadership, 20% community/team, 10% reposts.

## Email newsletter
Monthly newsletter to 2,847 subscribers. Opens: 38%, CTR: 6.2%. Last send: May 1.`,
    },
    {
      projectId: pMkt._id, authorId: mkt2, parentId: mktRoot._id,
      title: 'Product Hunt Launch Plan',
      content: `# Product Hunt Launch Plan

**Target date:** First Tuesday of June (highest traffic day based on PH data).

## Pre-launch checklist
- ✅ Hero image (1270×760) created and approved
- ✅ Gallery screenshots ×5 uploaded
- ✅ 300-word product description written
- ⬜ 60-second demo video (in production, due May 28)
- ⬜ Maker comment drafted (300 words, personal story)
- ⬜ Hunter identified (reach out to @levelsio / @marc_louvion)
- ⬜ Community posts scheduled (r/SaaS, Hacker News "Show HN", Indie Hackers)

## Day-of plan
1. 00:01 PST — submit (Product Hunt resets at midnight Pacific)
2. 06:00 — team posts comments from personal accounts
3. 08:00 — send newsletter blast to existing users
4. 09:00 — Twitter thread goes out from @prismapp
5. Throughout — reply to every comment within 30 minutes

## Success metrics
- Top 5 of the day: 🥇 goal
- 500+ upvotes: table stakes for visibility
- 100+ new signups on launch day`,
    },
  ]);

  // ── 7d. Mobile wiki ───────────────────────────────────────────────────────
  const mobileRoot = await wikiModel.create({
    projectId: pMobile._id, authorId: cpo, parentId: null,
    title: 'Mobile App — Architecture',
    content: `# Mobile App Architecture

## Tech stack
- **React Native** via Expo SDK 51
- **Expo Router** (file-based navigation)
- **TanStack Query** — shared query key conventions with web app
- **Zustand** — local UI state

## API
Same Prism API. Base URL from \`app.config.ts\`:
- Dev: \`http://localhost:4000/api/v1\`
- Staging: \`https://api-staging.prism.app/api/v1\`
- Prod: \`https://api.prism.app/api/v1\`

## Current beta scope
- Issues list + detail
- Kanban board (view only)
- Notifications inbox
- Profile settings`,
  });

  await wikiModel.insertMany([
    {
      projectId: pMobile._id, authorId: dev, parentId: mobileRoot._id,
      title: 'Push Notifications Setup',
      content: `# Push Notifications Setup

## Architecture
Uses **Expo Push Notifications** which abstracts APNs (iOS) and FCM (Android).

## APNs (.p8 key method)
1. Generate key in Apple Developer → Certificates → Keys
2. Download the \`.p8\` file (keep safe — it cannot be re-downloaded)
3. Upload in Expo dashboard: Project Settings → Push Notifications
4. Set \`APNS_KEY_ID\` and \`APNS_TEAM_ID\` in production env

## Token registration
On login, the mobile app calls \`Notifications.getExpoPushTokenAsync()\` and registers the token via \`POST /notifications/register-device\` (planned, tracked in API backlog).

## Current issue
APNs cert expired 2024-04-01. Fix tracked in issue #25. Temporary workaround: use development profile push token for beta testers.`,
    },
    {
      projectId: pMobile._id, authorId: dev2, parentId: mobileRoot._id,
      title: 'Offline Mode Design',
      content: `# Offline Mode Design

## Goal
Users can view issues and notes without internet. Changes queue locally and sync when reconnected.

## Storage: expo-sqlite
\`\`\`
tables:
  issues     (id, projectId, title, status, priority, assigneeId, updatedAt, synced)
  notes      (id, title, blocks_json, updatedAt, synced)
  sync_queue (id, entity, action, payload_json, created_at)
\`\`\`

## Sync strategy
1. On app foreground + connectivity restored: drain \`sync_queue\` in order
2. Conflict resolution: server wins for issues (status may have changed); client wins for note content (last write with timestamp merge)
3. Optimistic UI: mutations write to SQLite + sync_queue immediately, show pending indicator

## Implementation plan
- Phase 1: read-only offline (issues list, note viewer) — 2 sprints
- Phase 2: offline writes + sync queue — 3 sprints
- Phase 3: conflict UI — 1 sprint`,
    },
    {
      projectId: pMobile._id, authorId: cpo, parentId: mobileRoot._id,
      title: 'Beta Testing Guide',
      content: `# Beta Testing Guide

## TestFlight (iOS)
1. Build via \`eas build --platform ios --profile preview\`
2. Submit to TestFlight: \`eas submit --platform ios\`
3. Add testers in App Store Connect → TestFlight → External Testing
4. Max 10,000 external testers; internal testers (up to 100) get builds immediately

## Google Play Internal Testing (Android)
1. Build via \`eas build --platform android --profile preview\`
2. Upload .aab to Play Console → Internal Testing track
3. Testers must opt-in via the testing link

## Feedback collection
Beta testers report bugs via TestFlight built-in feedback (iOS) or email \`mobile-beta@prism.app\`.
Critical bugs go straight to the Mobile App project as issues with label \`beta-feedback\`.

## Current beta testers
17 iOS, 9 Android. Primarily CPO contacts and design partners. Expand to 50 after push notification fix.`,
    },
  ]);

  console.log('✓ Wiki pages seeded');

  // ── 8. Note folders + notes ───────────────────────────────────────────────

  // ── Dev Kim folders ───────────────────────────────────────────────────────
  const devEngFolder   = await folderModel.create({ name: 'Engineering', ownerId: dev, parentId: null });
  const devArchFolder  = await folderModel.create({ name: 'Architecture', ownerId: dev, parentId: devEngFolder._id });
  const devSprintFolder = await folderModel.create({ name: 'Sprint Notes', ownerId: dev, parentId: devEngFolder._id });

  // ── Chris Park folders ────────────────────────────────────────────────────
  const dev2ResearchFolder = await folderModel.create({ name: 'Research', ownerId: dev2, parentId: null });
  const dev2SprintFolder   = await folderModel.create({ name: 'Sprints', ownerId: dev2, parentId: null });

  // ── CPO folders ───────────────────────────────────────────────────────────
  const cpoProductFolder    = await folderModel.create({ name: 'Product', ownerId: cpo, parentId: null });
  const cpoInterviewsFolder = await folderModel.create({ name: 'Customer Interviews', ownerId: cpo, parentId: cpoProductFolder._id });
  const cpoOkrFolder        = await folderModel.create({ name: 'OKRs', ownerId: cpo, parentId: cpoProductFolder._id });

  // ── Marketing folders ─────────────────────────────────────────────────────
  const mktCampaigns = await folderModel.create({ name: 'Campaigns', ownerId: mkt, parentId: null });
  const mktPHFolder  = await folderModel.create({ name: 'Product Hunt', ownerId: mkt, parentId: mktCampaigns._id });
  const mktBlogFolder = await folderModel.create({ name: 'Blog', ownerId: mkt, parentId: mktCampaigns._id });

  // ── Sales folders ─────────────────────────────────────────────────────────
  const salesFolder = await folderModel.create({ name: 'Accounts', ownerId: sales, parentId: null });
  const sales2Folder = await folderModel.create({ name: 'Pipeline Notes', ownerId: sales2, parentId: null });

  // ── Admin folders ─────────────────────────────────────────────────────────
  const adminMgmtFolder = await folderModel.create({ name: 'Management', ownerId: admin, parentId: null });

  await noteModel.insertMany([
    // ── Dev Kim (Engineering) ───────────────────────────────────────────────
    {
      ownerId: dev, folderId: devArchFolder._id, emoji: '🏗️', pinned: true,
      title: 'Sprint 24 — Architecture Decisions',
      tags: ['architecture', 'sprint', 'adr'],
      blocks: [
        { type: 'heading', value: 'Decision Log — Sprint 24' },
        { type: 'text', value: 'Tracking key architectural decisions made during Sprint 24. Each entry: context, options, chosen path.' },
        { type: 'heading', value: 'ADR-01: Cell storage format' },
        { type: 'text', value: 'Store cells as flat `Record<A1, Cell>` on the Sheet document. A1 notation is the natural key for formula references; MongoDB Mixed/Object handles sparse maps efficiently.' },
        { type: 'heading', value: 'ADR-02: Undo/redo strategy' },
        { type: 'text', value: 'Workbook-snapshot-based undo (full before/after pairs) instead of an operation log. Simpler correctness; 50-snapshot cap keeps memory bounded.' },
        { type: 'heading', value: 'ADR-03: Real-time collaboration approach' },
        { type: 'text', value: 'Deferred to Q3. Two options remain: operational transforms (OT) vs. CRDTs. CRDT favored for offline-first compatibility — will prototype with Yjs.' },
        { type: 'check', value: 'Document cell format in wiki', checked: true },
        { type: 'check', value: 'Benchmark snapshot memory at 1000 cells', checked: true },
        { type: 'check', value: 'Create Yjs prototype branch', checked: false },
        { type: 'check', value: 'Evaluate CRDT for offline mobile sync', checked: false },
      ],
    },
    {
      ownerId: dev, folderId: devSprintFolder._id, emoji: '🗓️', pinned: false,
      title: 'Sprint 25 — Planning Notes',
      tags: ['sprint', 'planning'],
      blocks: [
        { type: 'heading', value: 'Sprint 25 Goals' },
        { type: 'text', value: 'Two-week sprint starting May 19. Team: Dev Kim, Chris Park, Sarah Kim.' },
        { type: 'heading', value: 'Committed items' },
        { type: 'check', value: 'Fix formula bar focus bug (1 SP)', checked: false },
        { type: 'check', value: 'Keyboard shortcut overlay — complete implementation (3 SP)', checked: false },
        { type: 'check', value: 'Conditional formatting color scale (3 SP)', checked: false },
        { type: 'check', value: 'File drag-to-folder Firefox fix (1 SP)', checked: false },
        { type: 'check', value: 'JWT refresh retry (2 SP)', checked: false },
        { type: 'heading', value: 'Stretch goals' },
        { type: 'check', value: 'Workbook public share link (3 SP)', checked: false },
        { type: 'check', value: 'Rate limit fix for XLSX imports (2 SP)', checked: false },
        { type: 'text', value: 'Total committed: 10 SP. Team capacity: 12 SP (buffer for review/support).' },
      ],
    },
    {
      ownerId: dev, folderId: devEngFolder._id, emoji: '🐛', pinned: false,
      title: 'iOS Push Certificate Renewal',
      tags: ['ios', 'ops', 'checklist'],
      blocks: [
        { type: 'heading', value: 'APNs Certificate Renewal Steps' },
        { type: 'check', value: 'Generate new .p8 key in Apple Developer portal', checked: true },
        { type: 'check', value: 'Upload .p8 to Expo push service dashboard', checked: true },
        { type: 'check', value: 'Update APNS_KEY_ID and APNS_TEAM_ID in prod env', checked: false },
        { type: 'check', value: 'Test push delivery on iPhone running iOS 17.4', checked: false },
        { type: 'check', value: 'Update renewal calendar reminder (annual)', checked: false },
        { type: 'text', value: '.p8 key does not expire (unlike old .p12 flow) — this is a one-time migration.' },
        { type: 'text', value: 'Awaiting Apple review of new cert (usually 1–2 business days).' },
      ],
    },
    {
      ownerId: dev, folderId: devArchFolder._id, emoji: '📐', pinned: false,
      title: 'Formula Engine Design Notes',
      tags: ['architecture', 'spreadsheet'],
      blocks: [
        { type: 'heading', value: 'Formula Engine' },
        { type: 'text', value: 'The formula engine lives in `lib/sheets/formula.ts`. It is a 3-phase pipeline:' },
        { type: 'code', value: 'tokenize(raw) → tokens\nparse(tokens) → AST\nevaluate(ast, sheet, workbook) → value', lang: 'text' },
        { type: 'heading', value: 'Circular reference detection' },
        { type: 'text', value: 'Evaluation maintains a Set<cellRef> called `visiting`. Before evaluating a formula cell, we check if it is already in `visiting`. If so, return #CIRCULAR!. This handles both direct (A1→A1) and indirect (A1→B1→A1) cycles.' },
        { type: 'heading', value: 'Named ranges' },
        { type: 'text', value: 'The evaluator first checks `workbook.namedRanges` before treating an identifier as a cell ref. Named range identifiers must match `/^[A-Za-z_][A-Za-z0-9_]*$/` — checked at creation time.' },
        { type: 'heading', value: 'Function registry' },
        { type: 'text', value: 'All built-in functions are registered in `lib/sheets/function-registry.ts` with name, arg count, description. The function wizard UI reads this registry — add new functions there first.' },
      ],
    },
    // ── Chris Park (dev2) ────────────────────────────────────────────────────
    {
      ownerId: dev2, folderId: dev2ResearchFolder._id, emoji: '🔬', pinned: true,
      title: 'CRDT vs OT Research',
      tags: ['architecture', 'research', 'collaboration'],
      blocks: [
        { type: 'heading', value: 'Collaborative Editing Approaches' },
        { type: 'text', value: 'Comparing Operational Transforms (OT) and Conflict-free Replicated Data Types (CRDTs) for the Q3 real-time collaboration feature.' },
        { type: 'heading', value: 'Operational Transforms (OT)' },
        { type: 'text', value: '**Pros:** Battle-tested (Google Docs), predictable merge semantics for linear text.\n**Cons:** Complex transform function matrix; hard to implement correctly for 2D cell structures; server must be in the loop for all transforms.' },
        { type: 'heading', value: 'CRDTs (Yjs)' },
        { type: 'text', value: '**Pros:** Peer-to-peer capable (no central server coordination), proven offline-first support, Yjs has active community and Next.js examples.\n**Cons:** Larger payload, some merge semantics (e.g. concurrent deletes) feel unnatural to users.' },
        { type: 'heading', value: 'Recommendation' },
        { type: 'text', value: '**Yjs** for the cell model. Key factor: offline-first is a hard requirement for mobile. Created a prototype branch `feat/yjs-cells` — initial results look promising.' },
        { type: 'check', value: 'Benchmark Yjs cell sync at 50 concurrent users', checked: false },
        { type: 'check', value: 'Share prototype in next architecture review', checked: false },
      ],
    },
    {
      ownerId: dev2, folderId: dev2SprintFolder._id, emoji: '📋', pinned: false,
      title: 'Sprint 25 — My Tasks',
      tags: ['sprint', 'tasks'],
      blocks: [
        { type: 'heading', value: 'My Sprint 25 Tasks' },
        { type: 'check', value: 'Keyboard shortcut overlay — ShortcutHelpModal component', checked: false },
        { type: 'check', value: 'Keyboard shortcut overlay — global Shift+? listener', checked: false },
        { type: 'check', value: 'Keyboard shortcut overlay — group by section (Navigation, Editing, Spreadsheet)', checked: false },
        { type: 'check', value: 'Conditional format color scale — cond-fmt.ts evaluator', checked: false },
        { type: 'check', value: 'Conditional format color scale — ConditionalFormatPanel UI', checked: false },
        { type: 'check', value: 'Workbook public share link — API endpoint (stretch)', checked: false },
      ],
    },
    // ── CPO (Jordan Lee) ─────────────────────────────────────────────────────
    {
      ownerId: cpo, folderId: cpoProductFolder._id, emoji: '🗺️', pinned: true,
      title: 'Q3 Product Roadmap — Draft',
      tags: ['roadmap', 'q3', 'product'],
      blocks: [
        { type: 'heading', value: 'Q3 2025 Roadmap — CPO Draft' },
        { type: 'text', value: 'Theme: **Collaboration & Scale**. Strong single-user workflows exist. Q3 makes Prism the default for teams.' },
        { type: 'heading', value: 'Tier 1 — Must ship' },
        { type: 'check', value: 'Real-time collaborative editing (CRDT / Yjs)', checked: false },
        { type: 'check', value: 'Team workspaces with role-scoped views', checked: false },
        { type: 'check', value: 'Mobile offline mode (Phase 1: read-only)', checked: false },
        { type: 'check', value: 'Workbook public share link', checked: false },
        { type: 'heading', value: 'Tier 2 — Ship if velocity allows' },
        { type: 'check', value: 'Google Sheets bidirectional sync', checked: false },
        { type: 'check', value: 'Webhook integrations (Slack, Zapier)', checked: false },
        { type: 'check', value: 'Keyboard shortcut help overlay', checked: false },
        { type: 'check', value: 'Biometric login for mobile', checked: false },
        { type: 'divider', value: '' },
        { type: 'text', value: 'All items linked to issues in Prism Web App and Prism API projects. Labels: `roadmap-q3`.' },
        { type: 'table', value: '', table: { cols: 3, headerRow: true, rows: [['Feature', 'Est. Sprints', 'Owner'], ['CRDT collab', '4', 'Chris Park'], ['Team workspaces', '3', 'Dev Kim'], ['Mobile offline', '6', 'Sarah Kim'], ['Share link', '1', 'Chris Park']] } },
      ],
    },
    {
      ownerId: cpo, folderId: cpoInterviewsFolder._id, emoji: '💬', pinned: false,
      title: 'Customer Interview — Acme Corp (May 14)',
      tags: ['customer', 'interview', 'insights'],
      blocks: [
        { type: 'heading', value: 'Interview Notes — Linda Park, Acme Corp' },
        { type: 'text', value: '**Date:** May 14, 2025\n**Duration:** 45 min\n**Role:** VP of Engineering, 80-person team' },
        { type: 'heading', value: 'What they love' },
        { type: 'text', value: 'Spreadsheet integration is the main differentiator. Linda: "We use Excel for everything — sprint tracking, budget, OKRs. Having that inside the project tool removes a whole category of copy-paste work."' },
        { type: 'heading', value: 'Pain points' },
        { type: 'check', value: 'No real-time collaboration — biggest blocker for team adoption', checked: false },
        { type: 'check', value: 'Mobile app missing (engineers on-call need it)', checked: false },
        { type: 'check', value: 'No SSO / SAML support (deal-breaker for enterprise)', checked: false },
        { type: 'heading', value: 'Quotes' },
        { type: 'text', value: '"If you add real-time collaboration before October, I can get you a 5-seat pilot with the platform team."' },
        { type: 'text', value: '"The kanban board is the best I\'ve seen — the role-specific column logic is genius."' },
        { type: 'heading', value: 'Action items' },
        { type: 'check', value: 'Add SSO/SAML to Q3 roadmap consideration', checked: false },
        { type: 'check', value: 'Send Linda early access when CRDT collab is in beta', checked: false },
      ],
    },
    {
      ownerId: cpo, folderId: cpoOkrFolder._id, emoji: '🎯', pinned: false,
      title: 'OKR Tracking — Q2 2025',
      tags: ['okr', 'q2', 'metrics'],
      blocks: [
        { type: 'heading', value: 'Q2 2025 OKRs' },
        { type: 'heading', value: 'O1: Become the default tool for dev teams' },
        { type: 'table', value: '', table: { cols: 3, headerRow: true, rows: [['Key Result', 'Target', 'Current'], ['New signups / month', '500', '387'], ['Team accounts (≥3 users)', '50', '34'], ['7-day retention', '45%', '41%'], ['NPS score', '40', '38']] } },
        { type: 'heading', value: 'O2: Ship Q3 readiness features' },
        { type: 'table', value: '', table: { cols: 3, headerRow: true, rows: [['Key Result', 'Target', 'Current'], ['CRDT prototype merged', 'Jun 30', 'In progress'], ['Mobile TestFlight users', '50', '26'], ['API p95 latency < 200ms', '100%', '97%']] } },
        { type: 'heading', value: 'O3: Grow marketing reach' },
        { type: 'table', value: '', table: { cols: 3, headerRow: true, rows: [['Key Result', 'Target', 'Current'], ['Organic blog traffic / month', '10k', '7.2k'], ['Product Hunt top 5', 'Jun launch', 'Planning'], ['Email subscribers', '3500', '2847']] } },
      ],
    },
    // ── Marketing (Maya Chen) ─────────────────────────────────────────────────
    {
      ownerId: mkt, folderId: mktPHFolder._id, emoji: '📣', pinned: true,
      title: 'Product Hunt Launch — Copy Brief',
      tags: ['launch', 'product-hunt', 'copy'],
      blocks: [
        { type: 'heading', value: 'Product Hunt Launch Brief' },
        { type: 'text', value: '**Target date:** First Tuesday of June 2025.' },
        { type: 'heading', value: 'Tagline options (vote below)' },
        { type: 'check', value: '"The workspace that thinks like a spreadsheet"', checked: false },
        { type: 'check', value: '"Issues, docs, and data — one tab"', checked: false },
        { type: 'check', value: '"Prism: project management for teams who live in spreadsheets"', checked: true },
        { type: 'heading', value: 'Asset status' },
        { type: 'check', value: 'Hero image (1270×760px)', checked: true },
        { type: 'check', value: 'Gallery screenshots ×5', checked: true },
        { type: 'check', value: '60-second demo video', checked: false },
        { type: 'check', value: 'Maker comment draft', checked: false },
        { type: 'check', value: 'Community pre-posts (r/SaaS, IH, HN)', checked: false },
        { type: 'heading', value: 'Day-of schedule (PST)' },
        { type: 'code', value: '00:01 — Submit to Product Hunt\n06:00 — Team engagement push (all hands)\n08:00 — Newsletter blast (2847 subscribers)\n09:00 — Twitter thread (@prismapp)\n10:00 — LinkedIn post (company page)\n12:00 — Check-in: respond to all comments', lang: 'text' },
      ],
    },
    {
      ownerId: mkt, folderId: mktBlogFolder._id, emoji: '✍️', pinned: false,
      title: 'Blog Post — Spreadsheet Clone Deep Dive',
      tags: ['blog', 'technical', 'content'],
      blocks: [
        { type: 'heading', value: 'How We Built a Google Sheets Clone in Next.js' },
        { type: 'text', value: '**Status:** Published May 6, 2025. **Performance:** 2,341 views, 89 shares, 12 backlinks in first week.' },
        { type: 'heading', value: 'Outline' },
        { type: 'check', value: 'Intro: why we built it instead of integrating', checked: true },
        { type: 'check', value: 'Architecture: cell model, formula engine, undo/redo', checked: true },
        { type: 'check', value: 'Challenges: circular refs, merged cells, clipboard TSV', checked: true },
        { type: 'check', value: 'Performance: virtual rendering, memoized formulas', checked: true },
        { type: 'check', value: 'What is next: CRDT real-time collab', checked: true },
        { type: 'heading', value: 'Follow-up post ideas' },
        { type: 'text', value: '1. "How we implemented CRDT collaborative editing" (Q3)\n2. "Building an Excel-compatible import/export with ExcelJS"\n3. "Conditional formatting internals"' },
      ],
    },
    // ── Lena Torres (mkt2) ────────────────────────────────────────────────────
    {
      ownerId: mkt2, folderId: null, emoji: '📊', pinned: false,
      title: 'SEO Keyword Research — H2 2025',
      tags: ['seo', 'keywords', 'research'],
      blocks: [
        { type: 'heading', value: 'SEO Keyword Research — H2 2025' },
        { type: 'text', value: 'Ahrefs data pulled May 15, 2025. Focusing on medium-competition informational keywords to build topical authority.' },
        { type: 'heading', value: 'Priority clusters' },
        { type: 'table', value: '', table: { cols: 4, headerRow: true, rows: [['Cluster', 'Head term', 'Volume', 'KD'], ['Project management', 'kanban board online', '18k', '55'], ['Spreadsheet tools', 'google sheets alternative', '8.1k', '48'], ['Dev tools', 'linear alternative', '5.4k', '44'], ['Documentation', 'notion alternative for developers', '3.2k', '39']] } },
        { type: 'heading', value: 'Content plan' },
        { type: 'check', value: 'Write comparison post: Prism vs Linear', checked: false },
        { type: 'check', value: 'Write guide: Kanban for software teams', checked: false },
        { type: 'check', value: 'Update homepage meta for "project management software"', checked: false },
      ],
    },
    // ── Admin (Alex Morgan) ────────────────────────────────────────────────────
    {
      ownerId: admin, folderId: adminMgmtFolder._id, emoji: '🔒', pinned: true,
      title: 'Security Review Checklist — v1.0 Release',
      tags: ['security', 'release', 'checklist'],
      blocks: [
        { type: 'heading', value: 'Pre-release Security Checklist' },
        { type: 'check', value: 'OWASP Top 10 audit complete', checked: true },
        { type: 'check', value: 'JWT secret rotation documented in runbook', checked: true },
        { type: 'check', value: 'Rate limiting verified on all public endpoints', checked: true },
        { type: 'check', value: 'File upload MIME-type validation (no executables)', checked: true },
        { type: 'check', value: 'Dependency audit — no high/critical CVEs (pnpm audit)', checked: false },
        { type: 'check', value: 'Pen test scheduled with external vendor', checked: false },
        { type: 'check', value: 'GDPR data deletion flow tested end-to-end', checked: false },
        { type: 'check', value: 'CSP headers configured (no unsafe-inline)', checked: false },
        { type: 'text', value: 'External pen test vendor: contact security@prism.app for quote. Budget approved by board.' },
      ],
    },
    {
      ownerId: admin, folderId: adminMgmtFolder._id, emoji: '📅', pinned: false,
      title: 'Team All-Hands — May 19 Notes',
      tags: ['meeting', 'team'],
      blocks: [
        { type: 'heading', value: 'All-Hands Meeting — May 19, 2025' },
        { type: 'text', value: '**Attendees:** Alex, Jordan, Maya, Sam, Dev, Chris, Sarah, Lena, Michael, Priya\n**Duration:** 60 min' },
        { type: 'heading', value: 'Key updates' },
        { type: 'text', value: '- Q2 velocity: 89% of sprint points delivered (target was 85%) — great job team\n- New users: +387 this month, on track for Q2 OKR\n- Product Hunt launch scheduled for June 3 (first Tuesday)\n- iOS push cert issue: fix expected by May 22' },
        { type: 'heading', value: 'Decisions' },
        { type: 'check', value: 'Move CRDT collaboration to Tier 1 for Q3 (approved)', checked: true },
        { type: 'check', value: 'Delay SSO/SAML to Q4 — too complex for Q3 bandwidth', checked: true },
        { type: 'check', value: 'Hire one more senior backend engineer (posting by June 1)', checked: false },
        { type: 'heading', value: 'Action items' },
        { type: 'check', value: 'Jordan: update public roadmap page by May 23', checked: false },
        { type: 'check', value: 'Maya: schedule Product Hunt prep call for May 26', checked: false },
        { type: 'check', value: 'Dev: fix iOS push cert before May 22', checked: false },
      ],
    },
    // ── Sales (Sam Rivera) ────────────────────────────────────────────────────
    {
      ownerId: sales, folderId: salesFolder._id, emoji: '💼', pinned: true,
      title: 'BrightPath Inc — Deal Notes',
      tags: ['account', 'enterprise', 'active'],
      blocks: [
        { type: 'heading', value: 'BrightPath Inc — Active Deal' },
        { type: 'text', value: '**Contact:** Raj Mehta, CTO\n**ARR:** $120,000 / year\n**Stage:** Active Deal\n**Close target:** July 1, 2025' },
        { type: 'heading', value: 'Key requirements' },
        { type: 'check', value: 'SSO / SAML (must-have — in Q4 roadmap, explained workaround)', checked: false },
        { type: 'check', value: 'EU data residency (can be scoped to EU Mongo Atlas cluster)', checked: true },
        { type: 'check', value: 'Self-hosted option (not available, explained SaaS vs infra)', checked: false },
        { type: 'check', value: '99.9% SLA with incident credits', checked: false },
        { type: 'heading', value: 'Call history' },
        { type: 'text', value: '- Apr 22: Discovery — Raj wants to replace Jira + Confluence + Sheets\n- May 5: Demo — spreadsheet feature blew him away\n- May 14: Technical review with their DevOps lead — went well\n- May 21: Proposal sent ($120k/year, 50 seats)' },
        { type: 'heading', value: 'Next steps' },
        { type: 'check', value: 'Follow up May 28 on proposal feedback', checked: false },
        { type: 'check', value: 'Loop in Jordan on SSO roadmap to give Raj confidence', checked: false },
      ],
    },
    {
      ownerId: sales2, folderId: sales2Folder._id, emoji: '📈', pinned: false,
      title: 'Pipeline Overview — Michael Wong',
      tags: ['pipeline', 'q2'],
      blocks: [
        { type: 'heading', value: 'My Q2 Pipeline — Michael Wong' },
        { type: 'table', value: '', table: { cols: 4, headerRow: true, rows: [['Account', 'ARR', 'Stage', 'Close'], ['TechNova Ltd', '$36,000', 'Proposal Sent', 'Jun 30'], ['CloudBridge', '$84,000', 'Active Deal', 'Jul 15'], ['Nexgen Analytics', '$18,000', 'Prospecting', 'Aug 30'], ['PixelFlow', '$60,000', 'Discovery', 'Sep 1']] } },
        { type: 'heading', value: 'Notes' },
        { type: 'text', value: 'TechNova is stalling on legal — need to escalate to decision-maker above Priya (our internal contact there is a champion, not the buyer).\n\nCloudBridge pilot is going well — 8 power users daily. Strong expansion potential.' },
      ],
    },
  ]);

  console.log('✓ Notes + folders seeded');

  // ── 9. File folders + file records ────────────────────────────────────────

  // ── Admin file folders ────────────────────────────────────────────────────
  const fDesign    = await fileFolderModel.create({ name: 'Design Assets', ownerId: admin, parentId: null, grants: [{ role: 'marketing', level: 'read' }, { role: 'dev', level: 'read' }] });
  const fBrand     = await fileFolderModel.create({ name: 'Brand Guidelines', ownerId: admin, parentId: fDesign._id, grants: [] });
  const fMockups   = await fileFolderModel.create({ name: 'UI Mockups', ownerId: admin, parentId: fDesign._id, grants: [{ role: 'dev', level: 'upload' }] });
  const fLegal     = await fileFolderModel.create({ name: 'Legal', ownerId: admin, parentId: null, grants: [] });
  const fContracts = await fileFolderModel.create({ name: 'Contracts', ownerId: admin, parentId: fLegal._id, grants: [] });
  const fCompliance = await fileFolderModel.create({ name: 'Compliance', ownerId: admin, parentId: fLegal._id, grants: [] });
  const fReports   = await fileFolderModel.create({ name: 'Reports', ownerId: admin, parentId: null, grants: [{ role: 'cpo', level: 'read' }, { role: 'sales', level: 'read' }] });

  // ── Dev file folders ──────────────────────────────────────────────────────
  const fEngRoot   = await fileFolderModel.create({ name: 'Engineering', ownerId: dev, parentId: null, grants: [{ role: 'dev', level: 'edit' }] });
  const fDiagrams  = await fileFolderModel.create({ name: 'Architecture Diagrams', ownerId: dev, parentId: fEngRoot._id, grants: [] });
  const fScreens   = await fileFolderModel.create({ name: 'Screenshots', ownerId: dev, parentId: fEngRoot._id, grants: [] });
  const fDocs      = await fileFolderModel.create({ name: 'Docs', ownerId: dev, parentId: fEngRoot._id, grants: [] });

  // ── Marketing file folders ────────────────────────────────────────────────
  const fCampaigns  = await fileFolderModel.create({ name: 'Campaigns', ownerId: mkt, parentId: null, grants: [{ role: 'admin', level: 'read' }, { role: 'cpo', level: 'read' }] });
  const fPHAssets   = await fileFolderModel.create({ name: 'Product Hunt', ownerId: mkt, parentId: fCampaigns._id, grants: [] });
  const fBlogAssets = await fileFolderModel.create({ name: 'Blog', ownerId: mkt, parentId: fCampaigns._id, grants: [] });
  const fSocial     = await fileFolderModel.create({ name: 'Social Media', ownerId: mkt, parentId: fCampaigns._id, grants: [] });
  const fBrandMkt   = await fileFolderModel.create({ name: 'Brand Assets', ownerId: mkt, parentId: null, grants: [{ role: 'dev', level: 'read' }] });

  // ── Sales file folder ─────────────────────────────────────────────────────
  const fSalesDecks = await fileFolderModel.create({ name: 'Sales Decks', ownerId: sales, parentId: null, grants: [{ role: 'admin', level: 'read' }] });
  const fProposals  = await fileFolderModel.create({ name: 'Proposals', ownerId: sales, parentId: fSalesDecks._id, grants: [] });

  await fileModel.insertMany([
    // Brand Guidelines
    { name: 'prism-logo-primary.svg',     storageKey: fakeKey(), mimeType: 'image/svg+xml', size: 24_576,  category: 'image', folderId: fBrand._id,     ownerId: admin },
    { name: 'prism-logo-dark.svg',        storageKey: fakeKey(), mimeType: 'image/svg+xml', size: 18_432,  category: 'image', folderId: fBrand._id,     ownerId: admin },
    { name: 'prism-logo-white.svg',       storageKey: fakeKey(), mimeType: 'image/svg+xml', size: 16_384,  category: 'image', folderId: fBrand._id,     ownerId: admin },
    { name: 'color-palette.png',          storageKey: fakeKey(), mimeType: 'image/png',     size: 57_344,  category: 'image', folderId: fBrand._id,     ownerId: admin },
    { name: 'typography-guide.pdf',       storageKey: fakeKey(), mimeType: 'application/pdf', size: 239_616, category: 'pdf', folderId: fBrand._id,     ownerId: admin },
    // UI Mockups
    { name: 'dashboard-v2.fig',           storageKey: fakeKey(), mimeType: 'application/octet-stream', size: 1_258_291, category: 'other', folderId: fMockups._id,   ownerId: admin },
    { name: 'onboarding-flow.fig',        storageKey: fakeKey(), mimeType: 'application/octet-stream', size: 909_312,  category: 'other', folderId: fMockups._id,   ownerId: admin },
    { name: 'mobile-screens-v3.pdf',      storageKey: fakeKey(), mimeType: 'application/pdf', size: 4_718_592, category: 'pdf', folderId: fMockups._id,   ownerId: admin },
    { name: 'spreadsheet-redesign.fig',   storageKey: fakeKey(), mimeType: 'application/octet-stream', size: 2_097_152, category: 'other', folderId: fMockups._id,   ownerId: admin },
    { name: 'notes-editor-mockup.png',    storageKey: fakeKey(), mimeType: 'image/png',     size: 345_088,  category: 'image', folderId: fMockups._id,   ownerId: admin },
    // Legal — Contracts
    { name: 'vendor-agreement-2025.pdf',  storageKey: fakeKey(), mimeType: 'application/pdf', size: 148_480, category: 'pdf', folderId: fContracts._id, ownerId: admin },
    { name: 'nda-template.pdf',           storageKey: fakeKey(), mimeType: 'application/pdf', size: 91_136,  category: 'pdf', folderId: fContracts._id, ownerId: admin },
    { name: 'aws-enterprise-agreement.pdf', storageKey: fakeKey(), mimeType: 'application/pdf', size: 389_120, category: 'pdf', folderId: fContracts._id, ownerId: admin },
    // Legal — Compliance
    { name: 'gdpr-compliance-checklist.pdf',        storageKey: fakeKey(), mimeType: 'application/pdf', size: 239_616, category: 'pdf', folderId: fCompliance._id, ownerId: admin },
    { name: 'data-processing-agreement.pdf',         storageKey: fakeKey(), mimeType: 'application/pdf', size: 182_272, category: 'pdf', folderId: fCompliance._id, ownerId: admin },
    { name: 'soc2-type2-report-2025.pdf',             storageKey: fakeKey(), mimeType: 'application/pdf', size: 1_572_864, category: 'pdf', folderId: fCompliance._id, ownerId: admin },
    // Reports
    { name: 'Q1-2025-board-report.pdf',   storageKey: fakeKey(), mimeType: 'application/pdf', size: 3_354_624, category: 'pdf', folderId: fReports._id,   ownerId: admin },
    { name: 'Q2-2025-financial-summary.xlsx', storageKey: fakeKey(), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 239_616, category: 'doc', folderId: fReports._id, ownerId: admin },
    { name: 'team-performance-h1-2025.pdf', storageKey: fakeKey(), mimeType: 'application/pdf', size: 1_126_400, category: 'pdf', folderId: fReports._id,   ownerId: admin },
    { name: 'competitor-analysis-q2.pdf', storageKey: fakeKey(), mimeType: 'application/pdf', size: 2_097_152, category: 'pdf', folderId: fReports._id,   ownerId: admin },
    // Dev — Architecture Diagrams
    { name: 'system-architecture-overview.png', storageKey: fakeKey(), mimeType: 'image/png', size: 353_280, category: 'image', folderId: fDiagrams._id, ownerId: dev },
    { name: 'database-erd.png',           storageKey: fakeKey(), mimeType: 'image/png',     size: 239_616,  category: 'image', folderId: fDiagrams._id, ownerId: dev },
    { name: 'api-request-flow.png',       storageKey: fakeKey(), mimeType: 'image/png',     size: 193_536,  category: 'image', folderId: fDiagrams._id, ownerId: dev },
    { name: 'websocket-event-flow.png',   storageKey: fakeKey(), mimeType: 'image/png',     size: 147_456,  category: 'image', folderId: fDiagrams._id, ownerId: dev },
    { name: 'cell-model-diagram.png',     storageKey: fakeKey(), mimeType: 'image/png',     size: 114_688,  category: 'image', folderId: fDiagrams._id, ownerId: dev },
    // Dev — Screenshots
    { name: 'spreadsheet-v2-preview.png', storageKey: fakeKey(), mimeType: 'image/png',     size: 466_944,  category: 'image', folderId: fScreens._id,  ownerId: dev },
    { name: 'dark-mode-kanban.png',       storageKey: fakeKey(), mimeType: 'image/png',     size: 239_616,  category: 'image', folderId: fScreens._id,  ownerId: dev },
    { name: 'notes-editor-slash-cmd.png', storageKey: fakeKey(), mimeType: 'image/png',     size: 182_272,  category: 'image', folderId: fScreens._id,  ownerId: dev },
    { name: 'mobile-app-beta-screens.png', storageKey: fakeKey(), mimeType: 'image/png',    size: 1_048_576, category: 'image', folderId: fScreens._id, ownerId: dev },
    // Dev — Docs
    { name: 'deployment-runbook.pdf',     storageKey: fakeKey(), mimeType: 'application/pdf', size: 580_608, category: 'pdf', folderId: fDocs._id,     ownerId: dev },
    { name: 'incident-postmortem-apr2025.pdf', storageKey: fakeKey(), mimeType: 'application/pdf', size: 239_616, category: 'pdf', folderId: fDocs._id, ownerId: dev },
    { name: 'api-changelog-v1.md',        storageKey: fakeKey(), mimeType: 'text/markdown',  size: 28_672,   category: 'doc',  folderId: fDocs._id,     ownerId: dev },
    // Marketing — Product Hunt
    { name: 'ph-hero-image.png',          storageKey: fakeKey(), mimeType: 'image/png',     size: 1_258_291, category: 'image', folderId: fPHAssets._id, ownerId: mkt },
    { name: 'ph-gallery-1-spreadsheet.png', storageKey: fakeKey(), mimeType: 'image/png',   size: 910_336,  category: 'image', folderId: fPHAssets._id, ownerId: mkt },
    { name: 'ph-gallery-2-kanban.png',    storageKey: fakeKey(), mimeType: 'image/png',     size: 773_120,  category: 'image', folderId: fPHAssets._id, ownerId: mkt },
    { name: 'ph-gallery-3-notes.png',     storageKey: fakeKey(), mimeType: 'image/png',     size: 638_976,  category: 'image', folderId: fPHAssets._id, ownerId: mkt },
    { name: 'ph-gallery-4-dashboard.png', storageKey: fakeKey(), mimeType: 'image/png',     size: 524_288,  category: 'image', folderId: fPHAssets._id, ownerId: mkt },
    { name: 'ph-gallery-5-mobile.png',    storageKey: fakeKey(), mimeType: 'image/png',     size: 409_600,  category: 'image', folderId: fPHAssets._id, ownerId: mkt },
    { name: 'ph-launch-copy.pdf',         storageKey: fakeKey(), mimeType: 'application/pdf', size: 91_136, category: 'pdf',   folderId: fPHAssets._id, ownerId: mkt },
    // Marketing — Blog
    { name: 'spreadsheet-post-cover.png', storageKey: fakeKey(), mimeType: 'image/png',     size: 614_400,  category: 'image', folderId: fBlogAssets._id, ownerId: mkt },
    { name: 'kanban-post-cover.png',      storageKey: fakeKey(), mimeType: 'image/png',     size: 512_000,  category: 'image', folderId: fBlogAssets._id, ownerId: mkt },
    { name: 'seo-keywords-h2-2025.xlsx',  storageKey: fakeKey(), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 148_480, category: 'doc', folderId: fBlogAssets._id, ownerId: mkt },
    { name: 'content-calendar-q2.pdf',    storageKey: fakeKey(), mimeType: 'application/pdf', size: 239_616, category: 'pdf',  folderId: fBlogAssets._id, ownerId: mkt },
    // Marketing — Social
    { name: 'twitter-banner-2025.png',    storageKey: fakeKey(), mimeType: 'image/png',     size: 239_616,  category: 'image', folderId: fSocial._id,   ownerId: mkt },
    { name: 'linkedin-banner.png',        storageKey: fakeKey(), mimeType: 'image/png',     size: 193_536,  category: 'image', folderId: fSocial._id,   ownerId: mkt },
    { name: 'social-template-pack.zip',   storageKey: fakeKey(), mimeType: 'application/zip', size: 4_194_304, category: 'other', folderId: fSocial._id, ownerId: mkt },
    // Marketing — Brand
    { name: 'prism-brand-kit.zip',        storageKey: fakeKey(), mimeType: 'application/zip', size: 8_388_608, category: 'other', folderId: fBrandMkt._id, ownerId: mkt },
    { name: 'brand-colors.pdf',           storageKey: fakeKey(), mimeType: 'application/pdf', size: 91_136,  category: 'pdf',   folderId: fBrandMkt._id, ownerId: mkt },
    // Sales Decks
    { name: 'prism-sales-deck-v4.pdf',    storageKey: fakeKey(), mimeType: 'application/pdf', size: 6_291_456, category: 'pdf',  folderId: fSalesDecks._id, ownerId: sales },
    { name: 'prism-sales-deck-v4.pptx',   storageKey: fakeKey(), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 8_388_608, category: 'doc', folderId: fSalesDecks._id, ownerId: sales },
    { name: 'competitor-battlecard.pdf',  storageKey: fakeKey(), mimeType: 'application/pdf', size: 614_400,  category: 'pdf',   folderId: fSalesDecks._id, ownerId: sales },
    { name: 'roi-calculator.xlsx',        storageKey: fakeKey(), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 239_616, category: 'doc', folderId: fSalesDecks._id, ownerId: sales },
    // Proposals
    { name: 'proposal-brightpath-inc.pdf', storageKey: fakeKey(), mimeType: 'application/pdf', size: 512_000, category: 'pdf',  folderId: fProposals._id, ownerId: sales },
    { name: 'proposal-acme-corp.pdf',     storageKey: fakeKey(), mimeType: 'application/pdf', size: 466_944,  category: 'pdf',   folderId: fProposals._id, ownerId: sales },
    { name: 'proposal-frontier-analytics.pdf', storageKey: fakeKey(), mimeType: 'application/pdf', size: 491_520, category: 'pdf', folderId: fProposals._id, ownerId: sales },
  ]);

  console.log('✓ Files + folders seeded');

  // ── 10. Workbooks ──────────────────────────────────────────────────────────

  await wbModel.insertMany([
    // ── Admin: Q2 Sprint Velocity ──────────────────────────────────────────
    {
      ownerId: admin, name: 'Q2 Sprint Velocity', activeSheetId: 'sv_main',
      grants: [{ role: 'dev', level: 'edit' }, { role: 'cpo', level: 'read' }],
      sheets: [{
        id: 'sv_main', name: 'Velocity', rowCount: 25, colCount: 10, index: 0,
        gridlines: true, frozen: { rows: 1, cols: 1 },
        hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
        colWidths: { A: 110, B: 90, C: 90, D: 70, E: 85, F: 80, G: 100, H: 100 },
        rowHeights: { '0': 28 },
        cells: {
          A1: { v: 'Sprint',     s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          B1: { v: 'Planned SP', s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          C1: { v: 'Completed',  s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          D1: { v: 'Bugs',       s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          E1: { v: 'Velocity %', s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          F1: { v: 'Team size',  s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          G1: { v: 'Start',      s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          H1: { v: 'End',        s: { b: true, bg: '#6366f1', fg: '#ffffff', ha: 'center', va: 'middle' } },
          A2: { v: 'Sprint 19' }, B2: { v: 34 }, C2: { v: 29 }, D2: { v: 3 }, E2: { f: '=C2/B2', v: '=C2/B2', s: { nf: '0%' } }, F2: { v: 4 }, G2: { v: '2025-01-06' }, H2: { v: '2025-01-17' },
          A3: { v: 'Sprint 20' }, B3: { v: 38 }, C3: { v: 38 }, D3: { v: 1 }, E3: { f: '=C3/B3', v: '=C3/B3', s: { nf: '0%' } }, F3: { v: 4 }, G3: { v: '2025-01-20' }, H3: { v: '2025-01-31' },
          A4: { v: 'Sprint 21' }, B4: { v: 40 }, C4: { v: 35 }, D4: { v: 5 }, E4: { f: '=C4/B4', v: '=C4/B4', s: { nf: '0%' } }, F4: { v: 5 }, G4: { v: '2025-02-03' }, H4: { v: '2025-02-14' },
          A5: { v: 'Sprint 22' }, B5: { v: 42 }, C5: { v: 40 }, D5: { v: 2 }, E5: { f: '=C5/B5', v: '=C5/B5', s: { nf: '0%' } }, F5: { v: 5 }, G5: { v: '2025-02-17' }, H5: { v: '2025-02-28' },
          A6: { v: 'Sprint 23' }, B6: { v: 44 }, C6: { v: 44 }, D6: { v: 0 }, E6: { f: '=C6/B6', v: '=C6/B6', s: { nf: '0%' } }, F6: { v: 5 }, G6: { v: '2025-03-03' }, H6: { v: '2025-03-14' },
          A7: { v: 'Sprint 24' }, B7: { v: 46 }, C7: { v: 41 }, D7: { v: 4 }, E7: { f: '=C7/B7', v: '=C7/B7', s: { nf: '0%' } }, F7: { v: 5 }, G7: { v: '2025-03-17' }, H7: { v: '2025-03-28' },
          A8: { v: 'Sprint 25' }, B8: { v: 50 }, C8: { v: 0  }, D8: { v: 0 }, E8: { f: '=IF(B8>0,C8/B8,"")', v: '=IF(B8>0,C8/B8,"")', s: { nf: '0%' } }, F8: { v: 5 }, G8: { v: '2025-05-19' }, H8: { v: '2025-05-30' },
          A10: { v: 'Summary', s: { b: true, bg: '#f8fafc' } },
          A11: { v: 'Avg planned SP', s: { b: true } }, B11: { f: '=AVERAGE(B2:B7)', v: '=AVERAGE(B2:B7)', s: { nf: '0.0' } },
          A12: { v: 'Avg completed SP', s: { b: true } }, C12: { f: '=AVERAGE(C2:C7)', v: '=AVERAGE(C2:C7)', s: { nf: '0.0' } },
          A13: { v: 'Avg velocity %', s: { b: true } }, E13: { f: '=AVERAGE(E2:E7)', v: '=AVERAGE(E2:E7)', s: { nf: '0%' } },
          A14: { v: 'Total bugs', s: { b: true } }, D14: { f: '=SUM(D2:D7)', v: '=SUM(D2:D7)' },
        },
      }],
    },

    // ── Admin: Team OKR Tracker ────────────────────────────────────────────
    {
      ownerId: admin, name: 'Team OKR Tracker — Q3 2025', activeSheetId: 'okr_o1',
      grants: [{ role: 'cpo', level: 'edit' }, { role: 'dev', level: 'read' }, { role: 'marketing', level: 'read' }, { role: 'sales', level: 'read' }],
      sheets: [
        {
          id: 'okr_o1', name: 'O1 — Product', rowCount: 30, colCount: 8, index: 0,
          gridlines: true, frozen: { rows: 2, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [{ r1: 0, c1: 0, r2: 0, c2: 7 }],
          condFmt: [], validations: [], filter: null,
          colWidths: { A: 260, B: 90, C: 90, D: 90, E: 90, F: 80, G: 100, H: 140 },
          rowHeights: { '0': 32 },
          cells: {
            A1: { v: 'O1: Become the default project tool for dev teams', s: { b: true, bg: '#6366f1', fg: '#fff', fs: 12, ha: 'center', va: 'middle' } },
            A2: { v: 'Key Result', s: { b: true, bg: '#eef2ff', ha: 'left' } },
            B2: { v: 'Target', s: { b: true, bg: '#eef2ff', ha: 'center' } },
            C2: { v: 'Current', s: { b: true, bg: '#eef2ff', ha: 'center' } },
            D2: { v: 'Progress %', s: { b: true, bg: '#eef2ff', ha: 'center' } },
            E2: { v: 'Owner', s: { b: true, bg: '#eef2ff', ha: 'center' } },
            F2: { v: 'Status', s: { b: true, bg: '#eef2ff', ha: 'center' } },
            G2: { v: 'Due', s: { b: true, bg: '#eef2ff', ha: 'center' } },
            H2: { v: 'Notes', s: { b: true, bg: '#eef2ff', ha: 'left' } },
            A3: { v: 'New signups / month' }, B3: { v: 500 }, C3: { v: 387 }, D3: { f: '=C3/B3', v: '=C3/B3', s: { nf: '0%' } }, E3: { v: 'Maya Chen' }, F3: { v: 'On Track' }, G3: { v: '2025-09-30' }, H3: { v: 'Product Hunt launch should boost Jun numbers' },
            A4: { v: 'Team accounts (≥3 users)' }, B4: { v: 50 }, C4: { v: 34 }, D4: { f: '=C4/B4', v: '=C4/B4', s: { nf: '0%' } }, E4: { v: 'Sam Rivera' }, F4: { v: 'At Risk' }, G4: { v: '2025-09-30' }, H4: { v: 'Needs enterprise outreach push' },
            A5: { v: '7-day retention' }, B5: { v: 0.45 }, C5: { v: 0.41 }, D5: { f: '=C5/B5', v: '=C5/B5', s: { nf: '0%' } }, E5: { v: 'Jordan Lee' }, F5: { v: 'On Track' }, G5: { v: '2025-09-30' }, H5: { v: 'Onboarding flow improvements planned for Jun' },
            A6: { v: 'NPS score' }, B6: { v: 40 }, C6: { v: 38 }, D6: { f: '=C6/B6', v: '=C6/B6', s: { nf: '0%' } }, E6: { v: 'Jordan Lee' }, F6: { v: 'On Track' }, G6: { v: '2025-09-30' }, H6: { v: 'Last survey: 142 respondents' },
            A7: { v: 'Avg active features / power user' }, B7: { v: 4 }, C7: { v: 2.8 }, D7: { f: '=C7/B7', v: '=C7/B7', s: { nf: '0%' } }, E7: { v: 'Jordan Lee' }, F7: { v: 'At Risk' }, G7: { v: '2025-09-30' }, H7: { v: 'Most users only use Issues + Kanban; push spreadsheet adoption' },
          },
        },
        {
          id: 'okr_o2', name: 'O2 — Engineering', rowCount: 30, colCount: 8, index: 1,
          gridlines: true, frozen: { rows: 2, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [{ r1: 0, c1: 0, r2: 0, c2: 7 }],
          condFmt: [], validations: [], filter: null,
          colWidths: { A: 260, B: 110, C: 110, D: 90, E: 100, F: 80, G: 100, H: 160 },
          rowHeights: { '0': 32 },
          cells: {
            A1: { v: 'O2: Ship Q3-ready platform foundation', s: { b: true, bg: '#0ea5e9', fg: '#fff', fs: 12, ha: 'center', va: 'middle' } },
            A2: { v: 'Key Result', s: { b: true, bg: '#e0f2fe', ha: 'left' } },
            B2: { v: 'Target', s: { b: true, bg: '#e0f2fe', ha: 'center' } },
            C2: { v: 'Current', s: { b: true, bg: '#e0f2fe', ha: 'center' } },
            D2: { v: 'Progress %', s: { b: true, bg: '#e0f2fe', ha: 'center' } },
            E2: { v: 'Owner', s: { b: true, bg: '#e0f2fe', ha: 'center' } },
            F2: { v: 'Status', s: { b: true, bg: '#e0f2fe', ha: 'center' } },
            G2: { v: 'Due', s: { b: true, bg: '#e0f2fe', ha: 'center' } },
            H2: { v: 'Notes', s: { b: true, bg: '#e0f2fe', ha: 'left' } },
            A3: { v: 'CRDT prototype merged' }, B3: { v: 'Jun 30' }, C3: { v: 'In progress' }, D3: { v: 0.3, s: { nf: '0%' } }, E3: { v: 'Chris Park' }, F3: { v: 'On Track' }, G3: { v: '2025-06-30' }, H3: { v: 'Yjs prototype on feat/yjs-cells branch' },
            A4: { v: 'API p95 latency < 200ms' }, B4: { v: 1.0 }, C4: { v: 0.97 }, D4: { f: '=C4/B4', v: '=C4/B4', s: { nf: '0%' } }, E4: { v: 'Dev Kim' }, F4: { v: 'On Track' }, G4: { v: '2025-09-30' }, H4: { v: 'Bulk workbook PATCH endpoint is bottleneck — rate limit issue open' },
            A5: { v: 'Test coverage > 70%' }, B5: { v: 0.7 }, C5: { v: 0.44 }, D5: { f: '=C5/B5', v: '=C5/B5', s: { nf: '0%' } }, E5: { v: 'Sarah Kim' }, F5: { v: 'At Risk' }, G5: { v: '2025-09-30' }, H5: { v: 'Integration tests missing for 2FA and file upload flows' },
            A6: { v: 'Zero P0 incidents in Q3' }, B6: { v: 0 }, C6: { v: 1 }, D6: { v: 0, s: { nf: '0%' } }, E6: { v: 'Alex Morgan' }, F6: { v: 'At Risk' }, G6: { v: '2025-09-30' }, H6: { v: 'iOS push cert expired — P0 declared May 20, fix underway' },
          },
        },
        {
          id: 'okr_o3', name: 'O3 — Growth', rowCount: 25, colCount: 7, index: 2,
          gridlines: true, frozen: { rows: 2, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [{ r1: 0, c1: 0, r2: 0, c2: 6 }],
          condFmt: [], validations: [], filter: null,
          colWidths: { A: 240, B: 100, C: 100, D: 90, E: 100, F: 80, G: 160 },
          rowHeights: { '0': 32 },
          cells: {
            A1: { v: 'O3: Grow brand awareness and qualified pipeline', s: { b: true, bg: '#f59e0b', fg: '#fff', fs: 12, ha: 'center', va: 'middle' } },
            A2: { v: 'Key Result', s: { b: true, bg: '#fef3c7', ha: 'left' } },
            B2: { v: 'Target', s: { b: true, bg: '#fef3c7', ha: 'center' } },
            C2: { v: 'Current', s: { b: true, bg: '#fef3c7', ha: 'center' } },
            D2: { v: 'Progress %', s: { b: true, bg: '#fef3c7', ha: 'center' } },
            E2: { v: 'Owner', s: { b: true, bg: '#fef3c7', ha: 'center' } },
            F2: { v: 'Status', s: { b: true, bg: '#fef3c7', ha: 'center' } },
            G2: { v: 'Notes', s: { b: true, bg: '#fef3c7', ha: 'left' } },
            A3: { v: 'Organic blog traffic / month' }, B3: { v: 10000 }, C3: { v: 7200 }, D3: { f: '=C3/B3', v: '=C3/B3', s: { nf: '0%' } }, E3: { v: 'Lena Torres' }, F3: { v: 'On Track' }, G3: { v: 'Spreadsheet post driving most traffic (2.3k views)' },
            A4: { v: 'Product Hunt top 5 of the day' }, B4: { v: 'Jun launch' }, C4: { v: 'Planning' }, D4: { v: 0.4, s: { nf: '0%' } }, E4: { v: 'Maya Chen' }, F4: { v: 'On Track' }, G4: { v: 'Launch date confirmed: Jun 3. Demo video pending.' },
            A5: { v: 'Email subscribers' }, B5: { v: 3500 }, C5: { v: 2847 }, D5: { f: '=C5/B5', v: '=C5/B5', s: { nf: '0%' } }, E5: { v: 'Maya Chen' }, F5: { v: 'On Track' }, G5: { v: 'Growing ~200/month. Newsletter open rate 38%.' },
            A6: { v: 'Qualified sales pipeline ($)' }, B6: { v: 500000 }, C6: { v: 378000 }, D6: { f: '=C6/B6', v: '=C6/B6', s: { nf: '0%' } }, E6: { v: 'Sam Rivera' }, F6: { v: 'On Track' }, G6: { v: 'BrightPath ($120k) + 6 active deals' },
          },
        },
      ],
    },

    // ── Sales: Pipeline Q2 ─────────────────────────────────────────────────
    {
      ownerId: sales, name: 'Sales Pipeline — Q2 2025', activeSheetId: 'sp_deals',
      grants: [{ role: 'admin', level: 'read' }, { role: 'cpo', level: 'read' }],
      sheets: [
        {
          id: 'sp_deals', name: 'Active Deals', rowCount: 35, colCount: 9, index: 0,
          gridlines: true, frozen: { rows: 1, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
          colWidths: { A: 180, B: 130, C: 100, D: 100, E: 110, F: 80, G: 100, H: 90, I: 150 },
          rowHeights: { '0': 28 },
          cells: {
            A1: { v: 'Company',       s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            B1: { v: 'Contact',       s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            C1: { v: 'Stage',         s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            D1: { v: 'ARR (USD)',     s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            E1: { v: 'Close Date',    s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            F1: { v: 'Probability',   s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            G1: { v: 'Owner',         s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            H1: { v: 'Last Contact',  s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'center' } },
            I1: { v: 'Notes',         s: { b: true, bg: '#0ea5e9', fg: '#fff', ha: 'left' } },

            A2: { v: 'Acme Corp' },           B2: { v: 'Linda Park' },    C2: { v: 'Proposal Sent' }, D2: { v: 48000 },  E2: { v: '2025-06-15' }, F2: { v: 0.7, s: { nf: '0%' } },  G2: { v: 'Sam Rivera' },   H2: { v: '2025-05-21' }, I2: { v: 'Waiting on legal review' },
            A3: { v: 'BrightPath Inc' },      B3: { v: 'Raj Mehta' },     C3: { v: 'Active Deal' },   D3: { v: 120000 }, E3: { v: '2025-07-01' }, F3: { v: 0.5, s: { nf: '0%' } },  G3: { v: 'Sam Rivera' },   H3: { v: '2025-05-14' }, I3: { v: 'Needs SSO confirmation — escalate to Jordan' },
            A4: { v: 'Circadian Labs' },      B4: { v: 'Tara Ellis' },    C4: { v: 'Closed Won' },    D4: { v: 24000 },  E4: { v: '2025-04-30' }, F4: { v: 1.0, s: { nf: '0%' } },  G4: { v: 'Sam Rivera' },   H4: { v: '2025-04-30' }, I4: { v: 'Signed. Onboarding May 5.' },
            A5: { v: 'DataNexus' },           B5: { v: 'Omar Farooq' },   C5: { v: 'Prospecting' },   D5: { v: 60000 },  E5: { v: '2025-08-20' }, F5: { v: 0.2, s: { nf: '0%' } },  G5: { v: 'Sam Rivera' },   H5: { v: '2025-05-08' }, I5: { v: 'Intro call went well, demo scheduled' },
            A6: { v: 'Evora Systems' },       B6: { v: 'Sophie Grant' },  C6: { v: 'Active Deal' },   D6: { v: 36000 },  E6: { v: '2025-06-30' }, F6: { v: 0.6, s: { nf: '0%' } },  G6: { v: 'Sam Rivera' },   H6: { v: '2025-05-19' }, I6: { v: 'Pilot with 5 users ongoing' },
            A7: { v: 'Frontier Analytics' },  B7: { v: 'James Wu' },      C7: { v: 'Proposal Sent' }, D7: { v: 90000 },  E7: { v: '2025-07-15' }, F7: { v: 0.65, s: { nf: '0%' } }, G7: { v: 'Michael Wong' }, H7: { v: '2025-05-20' }, I7: { v: 'Proposal sent May 20, follow up May 27' },
            A8: { v: 'GreenLeaf SaaS' },      B8: { v: 'Amira Hassan' },  C8: { v: 'Prospecting' },   D8: { v: 18000 },  E8: { v: '2025-09-01' }, F8: { v: 0.15, s: { nf: '0%' } }, G8: { v: 'Priya Sharma' }, H8: { v: '2025-05-12' }, I8: { v: 'LinkedIn outreach, waiting for reply' },
            A9: { v: 'HorizonPay' },          B9: { v: 'Carlos Diaz' },   C9: { v: 'Closed Won' },    D9: { v: 72000 },  E9: { v: '2025-05-10' }, F9: { v: 1.0, s: { nf: '0%' } },  G9: { v: 'Sam Rivera' },   H9: { v: '2025-05-10' }, I9: { v: 'Signed. 30-seat annual deal.' },
            A10: { v: 'TechNova Ltd' },       B10: { v: 'Wei Zhang' },    C10: { v: 'Proposal Sent' },D10: { v: 36000 }, E10: { v: '2025-06-30' }, F10: { v: 0.55, s: { nf: '0%' } },G10: { v: 'Michael Wong' },H10: { v: '2025-05-18' }, I10: { v: 'Stalled on legal — escalate to CTO' },
            A11: { v: 'CloudBridge' },        B11: { v: 'Ana Torres' },   C11: { v: 'Active Deal' },  D11: { v: 84000 }, E11: { v: '2025-07-15' }, F11: { v: 0.7, s: { nf: '0%' } }, G11: { v: 'Michael Wong' },H11: { v: '2025-05-21' }, I11: { v: 'Pilot going well — 8 daily actives' },
            A12: { v: 'Nexgen Analytics' },   B12: { v: 'Ravi Patel' },   C12: { v: 'Discovery' },    D12: { v: 18000 }, E12: { v: '2025-08-30' }, F12: { v: 0.25, s: { nf: '0%' } },G12: { v: 'Priya Sharma' },H12: { v: '2025-05-15' }, I12: { v: 'Discovery call done. Demo scheduled Jun 2.' },
            A13: { v: 'PixelFlow' },          B13: { v: 'Sarah Kim' },    C13: { v: 'Discovery' },    D13: { v: 60000 }, E13: { v: '2025-09-01' }, F13: { v: 0.2, s: { nf: '0%' } }, G13: { v: 'Priya Sharma' },H13: { v: '2025-05-20' }, I13: { v: 'Large design team (40 people) — good fit for notes+wiki' },

            A15: { v: 'Summary', s: { b: true, bg: '#f1f5f9' } },
            A16: { v: 'Total pipeline (open ARR)', s: { b: true } },
            D16: { f: '=SUMIF(C2:C13,"Active Deal",D2:D13)+SUMIF(C2:C13,"Proposal Sent",D2:D13)+SUMIF(C2:C13,"Prospecting",D2:D13)+SUMIF(C2:C13,"Discovery",D2:D13)', v: 0, s: { nf: '$#,##0' } },
            A17: { v: 'Weighted pipeline', s: { b: true } },
            D17: { f: '=SUMPRODUCT(D2:D13,F2:F13)', v: 0, s: { nf: '$#,##0' } },
            A18: { v: 'Closed won (Q2)', s: { b: true } },
            D18: { f: '=SUMIF(C2:C13,"Closed Won",D2:D13)', v: 0, s: { nf: '$#,##0' } },
            A19: { v: 'Avg deal size', s: { b: true } },
            D19: { f: '=AVERAGE(D2:D13)', v: 0, s: { nf: '$#,##0' } },
          },
        },
        {
          id: 'sp_monthly', name: 'Monthly Revenue', rowCount: 20, colCount: 6, index: 1,
          gridlines: true, frozen: { rows: 1, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
          colWidths: { A: 100, B: 110, C: 110, D: 110, E: 100, F: 110 },
          rowHeights: { '0': 28 },
          cells: {
            A1: { v: 'Month', s: { b: true, bg: '#10b981', fg: '#fff', ha: 'center' } },
            B1: { v: 'New ARR', s: { b: true, bg: '#10b981', fg: '#fff', ha: 'center' } },
            C1: { v: 'Expansion', s: { b: true, bg: '#10b981', fg: '#fff', ha: 'center' } },
            D1: { v: 'Churn', s: { b: true, bg: '#10b981', fg: '#fff', ha: 'center' } },
            E1: { v: 'Net MRR', s: { b: true, bg: '#10b981', fg: '#fff', ha: 'center' } },
            F1: { v: 'Cumulative ARR', s: { b: true, bg: '#10b981', fg: '#fff', ha: 'center' } },
            A2: { v: 'Jan 2025' }, B2: { v: 12000 }, C2: { v: 2400 }, D2: { v: 0 },    E2: { f: '=(B2+C2-D2)/12', v: 0, s: { nf: '$#,##0' } }, F2: { v: 12000 },
            A3: { v: 'Feb 2025' }, B3: { v: 18000 }, C3: { v: 1200 }, D3: { v: 0 },    E3: { f: '=(B3+C3-D3)/12', v: 0, s: { nf: '$#,##0' } }, F3: { f: '=F2+B3+C3-D3', v: 0 },
            A4: { v: 'Mar 2025' }, B4: { v: 24000 }, C4: { v: 3600 }, D4: { v: 2400 }, E4: { f: '=(B4+C4-D4)/12', v: 0, s: { nf: '$#,##0' } }, F4: { f: '=F3+B4+C4-D4', v: 0 },
            A5: { v: 'Apr 2025' }, B5: { v: 36000 }, C5: { v: 4800 }, D5: { v: 0 },    E5: { f: '=(B5+C5-D5)/12', v: 0, s: { nf: '$#,##0' } }, F5: { f: '=F4+B5+C5-D5', v: 0 },
            A6: { v: 'May 2025' }, B6: { v: 48000 }, C6: { v: 6000 }, D6: { v: 1200 }, E6: { f: '=(B6+C6-D6)/12', v: 0, s: { nf: '$#,##0' } }, F6: { f: '=F5+B6+C6-D6', v: 0 },
            A8: { v: 'Total',  s: { b: true } },
            B8: { f: '=SUM(B2:B6)', v: 0, s: { b: true, nf: '$#,##0' } },
            C8: { f: '=SUM(C2:C6)', v: 0, s: { b: true, nf: '$#,##0' } },
            D8: { f: '=SUM(D2:D6)', v: 0, s: { b: true, nf: '$#,##0' } },
          },
        },
      ],
    },

    // ── CPO: Feature Prioritization ────────────────────────────────────────
    {
      ownerId: cpo, name: 'Feature Prioritization — Q3 2025', activeSheetId: 'fp_rice',
      grants: [{ role: 'admin', level: 'edit' }, { role: 'dev', level: 'read' }],
      sheets: [{
        id: 'fp_rice', name: 'RICE Score', rowCount: 25, colCount: 8, index: 0,
        gridlines: true, frozen: { rows: 1, cols: 1 },
        hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
        colWidths: { A: 220, B: 80, C: 80, D: 80, E: 80, F: 90, G: 80, H: 140 },
        rowHeights: { '0': 28 },
        cells: {
          A1: { v: 'Feature', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'left' } },
          B1: { v: 'Reach', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'center' } },
          C1: { v: 'Impact', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'center' } },
          D1: { v: 'Confidence', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'center' } },
          E1: { v: 'Effort (wks)', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'center' } },
          F1: { v: 'RICE Score', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'center' } },
          G1: { v: 'Priority', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'center' } },
          H1: { v: 'Notes', s: { b: true, bg: '#8b5cf6', fg: '#fff', ha: 'left' } },
          A2: { v: 'Real-time collaborative editing (CRDT)' }, B2: { v: 800 }, C2: { v: 3 }, D2: { v: 0.7 }, E2: { v: 8 }, F2: { f: '=B2*C2*D2/E2', v: 0 }, G2: { v: 'P1' }, H2: { v: 'Top request from enterprise prospects' },
          A3: { v: 'Team workspaces + RBAC' }, B3: { v: 600 }, C3: { v: 3 }, D3: { v: 0.9 }, E3: { v: 6 }, F3: { f: '=B3*C3*D3/E3', v: 0 }, G3: { v: 'P1' }, H3: { v: 'Needed before any enterprise deal' },
          A4: { v: 'Workbook public share link' }, B4: { v: 400 }, C4: { v: 2 }, D4: { v: 0.95 }, E4: { v: 2 }, F4: { f: '=B4*C4*D4/E4', v: 0 }, G4: { v: 'P1' }, H4: { v: 'Low effort, high value for external sharing' },
          A5: { v: 'Mobile offline mode (Phase 1)' }, B5: { v: 300 }, C5: { v: 2 }, D5: { v: 0.8 }, E5: { v: 12 }, F5: { f: '=B5*C5*D5/E5', v: 0 }, G5: { v: 'P2' }, H5: { v: 'Hard req for field sales users' },
          A6: { v: 'Google Sheets bidirectional sync' }, B6: { v: 500 }, C6: { v: 2 }, D6: { v: 0.6 }, E6: { v: 10 }, F6: { f: '=B6*C6*D6/E6', v: 0 }, G6: { v: 'P2' }, H6: { v: 'High demand but complex OAuth + conflict resolution' },
          A7: { v: 'Webhook integrations (Slack/Zapier)' }, B7: { v: 400 }, C7: { v: 2 }, D7: { v: 0.85 }, E7: { v: 4 }, F7: { f: '=B7*C7*D7/E7', v: 0 }, G7: { v: 'P2' }, H7: { v: 'Unblocks enterprise workflows' },
          A8: { v: 'Biometric login (mobile)' }, B8: { v: 200 }, C8: { v: 1 }, D8: { v: 0.9 }, E8: { v: 2 }, F8: { f: '=B8*C8*D8/E8', v: 0 }, G8: { v: 'P3' }, H8: { v: 'Nice-to-have for mobile beta' },
          A9: { v: 'SSO / SAML' }, B9: { v: 150 }, C9: { v: 3 }, D9: { v: 0.95 }, E9: { v: 8 }, F9: { f: '=B9*C9*D9/E9', v: 0 }, G9: { v: 'Q4' }, H9: { v: 'Deal-breaker for enterprise — moved to Q4' },
          A10: { v: 'Conditional formatting color scale' }, B10: { v: 300 }, C10: { v: 1 }, D10: { v: 0.95 }, E10: { v: 1 }, F10: { f: '=B10*C10*D10/E10', v: 0 }, G10: { v: 'P2' }, H10: { v: 'In sprint 25' },
          A12: { v: 'Avg RICE score', s: { b: true } }, F12: { f: '=AVERAGE(F2:F10)', v: 0, s: { b: true } },
          A13: { v: 'Max RICE score', s: { b: true } }, F13: { f: '=MAX(F2:F10)', v: 0, s: { b: true } },
        },
      }],
    },

    // ── Dev: Performance Benchmarks ────────────────────────────────────────
    {
      ownerId: dev, name: 'API Performance Benchmarks', activeSheetId: 'pb_latency',
      grants: [{ role: 'admin', level: 'read' }, { role: 'cpo', level: 'read' }],
      sheets: [
        {
          id: 'pb_latency', name: 'Response Times (ms)', rowCount: 30, colCount: 7, index: 0,
          gridlines: true, frozen: { rows: 1, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [], condFmt: [
            { id: 'cf1', range: { r1: 1, c1: 1, r2: 20, c2: 4 }, type: 'cellIs', op: 'greaterThan', value: 500, style: { bg: '#fee2e2', fg: '#991b1b' } },
            { id: 'cf2', range: { r1: 1, c1: 1, r2: 20, c2: 4 }, type: 'cellIs', op: 'lessThanOrEqual', value: 200, style: { bg: '#dcfce7', fg: '#166534' } },
          ],
          validations: [], filter: null,
          colWidths: { A: 220, B: 80, C: 80, D: 80, E: 80, F: 80, G: 100 },
          rowHeights: { '0': 28 },
          cells: {
            A1: { v: 'Endpoint',  s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'left' } },
            B1: { v: 'p50 (ms)',  s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'center' } },
            C1: { v: 'p90 (ms)',  s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'center' } },
            D1: { v: 'p95 (ms)',  s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'center' } },
            E1: { v: 'p99 (ms)',  s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'center' } },
            F1: { v: 'Req/min',   s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'center' } },
            G1: { v: 'Notes',     s: { b: true, bg: '#1e293b', fg: '#fff', ha: 'left' } },
            A2: { v: 'GET /auth/me' },                     B2: { v: 18 },  C2: { v: 34 },  D2: { v: 48 },  E2: { v: 120 },  F2: { v: 1240 }, G2: { v: 'Cached JWT decode' },
            A3: { v: 'POST /auth/login' },                 B3: { v: 145 }, C3: { v: 210 }, D3: { v: 280 }, E3: { v: 450 },  F3: { v: 320 },  G3: { v: 'bcrypt cost 12 — expected slow' },
            A4: { v: 'POST /auth/refresh' },               B4: { v: 22 },  C4: { v: 45 },  D4: { v: 68 },  E4: { v: 190 },  F4: { v: 890 },  G4: { v: 'OK; add retry for replica failover' },
            A5: { v: 'GET /issues?projectId=X' },          B5: { v: 34 },  C5: { v: 67 },  D5: { v: 98 },  E5: { v: 230 },  F5: { v: 2100 }, G5: { v: 'Index on projectId+status working well' },
            A6: { v: 'PATCH /workbooks/:id (full WB)' },   B6: { v: 180 }, C6: { v: 420 }, D6: { v: 680 }, E6: { v: 1400 }, F6: { v: 180 },  G6: { v: '⚠ Large payload; bottleneck at scale' },
            A7: { v: 'GET /workbooks/:id' },                B7: { v: 45 },  C7: { v: 90 },  D7: { v: 140 }, E7: { v: 320 },  F7: { v: 640 },  G7: { v: '' },
            A8: { v: 'GET /notes' },                        B8: { v: 28 },  C8: { v: 55 },  D8: { v: 82 },  E8: { v: 190 },  F8: { v: 980 },  G8: { v: 'ownerId+folderId+updatedAt index OK' },
            A9: { v: 'POST /notes' },                       B9: { v: 42 },  C9: { v: 78 },  D9: { v: 110 }, E9: { v: 250 },  F9: { v: 340 },  G9: { v: '' },
            A10: { v: 'GET /files (folder listing)' },      B10: { v: 31 }, C10: { v: 62 }, D10: { v: 91 }, E10: { v: 210 }, F10: { v: 560 }, G10: { v: '' },
            A11: { v: 'POST /files/upload (GridFS)' },      B11: { v: 890 },C11: { v: 1450 },D11: { v: 2100 },E11: { v: 4500 },F11: { v: 45 },  G11: { v: '⚠ Depends on file size; measured at 1MB avg' },
            A12: { v: 'GET /activity?limit=200' },          B12: { v: 56 }, C12: { v: 112 },D12: { v: 168 },E12: { v: 390 }, F12: { v: 420 }, G12: { v: 'Compound index actorId+createdAt used' },
            A13: { v: 'GET /projects' },                    B13: { v: 24 }, C13: { v: 48 }, D13: { v: 72 }, E13: { v: 160 }, F13: { v: 760 }, G13: { v: '' },
            A15: { v: 'Summary', s: { b: true, bg: '#f8fafc' } },
            A16: { v: 'Avg p95 (ms)', s: { b: true } }, D16: { f: '=AVERAGE(D2:D13)', v: 0, s: { nf: '0.0' } },
            A17: { v: 'Max p95 (ms)', s: { b: true } }, D17: { f: '=MAX(D2:D13)', v: 0 },
            A18: { v: 'Endpoints > 500ms p95', s: { b: true } }, D18: { f: '=COUNTIF(D2:D13,">500")', v: 0 },
          },
        },
        {
          id: 'pb_errors', name: 'Error Rates', rowCount: 20, colCount: 6, index: 1,
          gridlines: true, frozen: { rows: 1, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
          colWidths: { A: 220, B: 80, C: 80, D: 80, E: 80, F: 140 },
          rowHeights: { '0': 28 },
          cells: {
            A1: { v: 'Endpoint',  s: { b: true, bg: '#dc2626', fg: '#fff', ha: 'left' } },
            B1: { v: '4xx rate',  s: { b: true, bg: '#dc2626', fg: '#fff', ha: 'center' } },
            C1: { v: '5xx rate',  s: { b: true, bg: '#dc2626', fg: '#fff', ha: 'center' } },
            D1: { v: 'Req/day',   s: { b: true, bg: '#dc2626', fg: '#fff', ha: 'center' } },
            E1: { v: 'Errors/day',s: { b: true, bg: '#dc2626', fg: '#fff', ha: 'center' } },
            F1: { v: 'Top error', s: { b: true, bg: '#dc2626', fg: '#fff', ha: 'left' } },
            A2: { v: 'POST /auth/login' },               B2: { v: 0.082, s: { nf: '0.0%' } }, C2: { v: 0.001, s: { nf: '0.0%' } }, D2: { v: 4608 },  E2: { f: '=D2*(B2+C2)', v: 0 }, F2: { v: '401 invalid credentials' },
            A3: { v: 'POST /auth/refresh' },             B3: { v: 0.014, s: { nf: '0.0%' } }, C3: { v: 0.003, s: { nf: '0.0%' } }, D3: { v: 12816 }, E3: { f: '=D3*(B3+C3)', v: 0 }, F3: { v: '401 token expired' },
            A4: { v: 'PATCH /workbooks/:id' },           B4: { v: 0.006, s: { nf: '0.0%' } }, C4: { v: 0.012, s: { nf: '0.0%' } }, D4: { v: 2592 },  E4: { f: '=D4*(B4+C4)', v: 0 }, F4: { v: '500 MongoNetworkError (replica failover)' },
            A5: { v: 'POST /files/upload' },             B5: { v: 0.021, s: { nf: '0.0%' } }, C5: { v: 0.004, s: { nf: '0.0%' } }, D5: { v: 648 },   E5: { f: '=D5*(B5+C5)', v: 0 }, F5: { v: '413 file too large' },
            A6: { v: 'GET /workbooks/:id' },             B6: { v: 0.003, s: { nf: '0.0%' } }, C6: { v: 0.001, s: { nf: '0.0%' } }, D6: { v: 9216 },  E6: { f: '=D6*(B6+C6)', v: 0 }, F6: { v: '403 no grant' },
          },
        },
      ],
    },

    // ── Marketing: Campaign Metrics ────────────────────────────────────────
    {
      ownerId: mkt, name: 'Campaign Metrics — Q2 2025', activeSheetId: 'cm_traffic',
      grants: [{ role: 'admin', level: 'read' }, { role: 'cpo', level: 'read' }],
      sheets: [
        {
          id: 'cm_traffic', name: 'Traffic Sources', rowCount: 25, colCount: 7, index: 0,
          gridlines: true, frozen: { rows: 1, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
          colWidths: { A: 150, B: 80, C: 80, D: 80, E: 80, F: 90, G: 80 },
          rowHeights: { '0': 28 },
          cells: {
            A1: { v: 'Source',           s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'left' } },
            B1: { v: 'Sessions',         s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'center' } },
            C1: { v: 'Signups',          s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'center' } },
            D1: { v: 'Conv. rate',       s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'center' } },
            E1: { v: 'Avg session',      s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'center' } },
            F1: { v: 'Bounce rate',      s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'center' } },
            G1: { v: 'CAC ($)',          s: { b: true, bg: '#f59e0b', fg: '#fff', ha: 'center' } },
            A2: { v: 'Organic Search' },  B2: { v: 7200 },  C2: { v: 216 }, D2: { f: '=C2/B2', v: 0, s: { nf: '0.0%' } }, E2: { v: '3:24' }, F2: { v: 0.38, s: { nf: '0%' } }, G2: { v: 0 },
            A3: { v: 'Direct' },          B3: { v: 2100 },  C3: { v: 84 },  D3: { f: '=C3/B3', v: 0, s: { nf: '0.0%' } }, E3: { v: '5:12' }, F3: { v: 0.22, s: { nf: '0%' } }, G3: { v: 0 },
            A4: { v: 'Twitter / X' },     B4: { v: 3400 },  C4: { v: 102 }, D4: { f: '=C4/B4', v: 0, s: { nf: '0.0%' } }, E4: { v: '2:08' }, F4: { v: 0.54, s: { nf: '0%' } }, G4: { v: 12, s: { nf: '$#,##0' } },
            A5: { v: 'Hacker News' },     B5: { v: 4800 },  C5: { v: 192 }, D5: { f: '=C5/B5', v: 0, s: { nf: '0.0%' } }, E5: { v: '4:41' }, F5: { v: 0.29, s: { nf: '0%' } }, G5: { v: 0 },
            A6: { v: 'LinkedIn' },        B6: { v: 1560 },  C6: { v: 31 },  D6: { f: '=C6/B6', v: 0, s: { nf: '0.0%' } }, E6: { v: '3:55' }, F6: { v: 0.47, s: { nf: '0%' } }, G6: { v: 18, s: { nf: '$#,##0' } },
            A7: { v: 'Reddit' },          B7: { v: 2200 },  C7: { v: 66 },  D7: { f: '=C7/B7', v: 0, s: { nf: '0.0%' } }, E7: { v: '2:55' }, F7: { v: 0.51, s: { nf: '0%' } }, G7: { v: 0 },
            A8: { v: 'Email newsletter' },B8: { v: 980 },   C8: { v: 59 },  D8: { f: '=C8/B8', v: 0, s: { nf: '0.0%' } }, E8: { v: '6:30' }, F8: { v: 0.15, s: { nf: '0%' } }, G8: { v: 0 },
            A9: { v: 'Product Hunt' },    B9: { v: 1200 },  C9: { v: 48 },  D9: { f: '=C9/B9', v: 0, s: { nf: '0.0%' } }, E9: { v: '4:18' }, F9: { v: 0.31, s: { nf: '0%' } }, G9: { v: 0 },
            A10: { v: 'Referral / Other' },B10:{ v: 1340 }, C10:{ v: 40 },  D10:{ f: '=C10/B10', v: 0, s: { nf: '0.0%' } }, E10:{ v: '3:10' }, F10:{ v: 0.44, s: { nf: '0%' } }, G10:{ v: 8, s: { nf: '$#,##0' } },
            A12: { v: 'Total', s: { b: true } }, B12: { f: '=SUM(B2:B10)', v: 0, s: { b: true } }, C12: { f: '=SUM(C2:C10)', v: 0, s: { b: true } },
            D12: { f: '=C12/B12', v: 0, s: { b: true, nf: '0.0%' } },
          },
        },
        {
          id: 'cm_blog', name: 'Blog Performance', rowCount: 20, colCount: 6, index: 1,
          gridlines: true, frozen: { rows: 1, cols: 1 },
          hiddenRows: [], hiddenCols: [], merges: [], condFmt: [], validations: [], filter: null,
          colWidths: { A: 280, B: 80, C: 80, D: 80, E: 80, F: 80 },
          rowHeights: { '0': 28 },
          cells: {
            A1: { v: 'Post Title',     s: { b: true, bg: '#ec4899', fg: '#fff', ha: 'left' } },
            B1: { v: 'Published',      s: { b: true, bg: '#ec4899', fg: '#fff', ha: 'center' } },
            C1: { v: 'Views',          s: { b: true, bg: '#ec4899', fg: '#fff', ha: 'center' } },
            D1: { v: 'Signups',        s: { b: true, bg: '#ec4899', fg: '#fff', ha: 'center' } },
            E1: { v: 'Avg read time',  s: { b: true, bg: '#ec4899', fg: '#fff', ha: 'center' } },
            F1: { v: 'Backlinks',      s: { b: true, bg: '#ec4899', fg: '#fff', ha: 'center' } },
            A2: { v: 'How we built a Google Sheets clone' },  B2: { v: '2025-05-06' }, C2: { v: 2341 }, D2: { v: 89 }, E2: { v: '7:24' }, F2: { v: 12 },
            A3: { v: '5 project management anti-patterns' },  B3: { v: '2025-05-13' }, C3: { v: 1890 }, D3: { v: 67 }, E3: { v: '5:51' }, F3: { v: 7 },
            A4: { v: 'Kanban vs Scrum for remote teams' },    B4: { v: '2025-05-20' }, C4: { v: 1102 }, D4: { v: 44 }, E4: { v: '4:38' }, F4: { v: 3 },
            A5: { v: 'Spreadsheets for sprint planning' },    B5: { v: '2025-05-27' }, C5: { v: 0 },    D5: { v: 0 },  E5: { v: 'Scheduled' }, F5: { v: 0 },
            A7: { v: 'Totals', s: { b: true } }, C7: { f: '=SUM(C2:C4)', v: 0, s: { b: true } }, D7: { f: '=SUM(D2:D4)', v: 0, s: { b: true } },
          },
        },
      ],
    },
  ]);

  console.log('✓ Workbooks seeded');
  console.log('\n🌱 Seed complete — users, projects, issues, kanban, MRs, wiki (30+ pages), notes (20+ notes), files (50+ records), workbooks (6) created.\n');
  await app.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

