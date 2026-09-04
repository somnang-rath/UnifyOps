import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 13:
 *
 *   "My Work + Needs attention + workload + **availability** — The §7.3 and
 *    §7.4 loops; a member on leave shows as such instead of as idle capacity."
 *
 * Both loops, in a browser, because both are made of things no unit test can
 * see: that the app *lands* on My Work rather than a project list, that an item
 * falls into the bucket its date says it should, that Needs Attention finds the
 * five kinds of trouble, and — the sentence §14 chose for the outcome — that a
 * member marked away reads as away rather than as somebody free.
 *
 * Run in `en` and `km` like every other spec (§15). The Khmer run earns its
 * place here for the reason slice 12's did: `myWork`, `dashboards`,
 * `needsAttention`, `workload` and `availability` are five new message blocks,
 * and a missing key renders as a raw `myWork.bucket.today` on screen while
 * every unit test still passes — next-intl swallows the error into the server
 * log, which is exactly how slice 10's `soon` defect stayed invisible.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e7).toString(36)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/** `YYYY-MM-DD`, `days` from today. The workspace defaults to Asia/Phnom_Penh. */
function isoDate(days: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

async function newProject(
  page: Page,
  locale: string,
  company: string,
): Promise<{ slug: string; projectSlug: string }> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Dashboard Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(`${company}@example.test`);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

  await page.goto(`/${locale}/${slug}/projects/new`);
  await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Field Ops');
  await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
  // §7.1's last step: creating a project lands on the **board**, with the six
  // default states drawn and the first column's composer focused. The specs
  // below this helper each want the project's own default view, so the helper
  // asserts the landing and then starts them from the bare URL.
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/${slug}/projects/field-ops[?]view=board&new=1$`),
  );
  await page.goto(`/${locale}/${slug}/projects/field-ops`);

  return { slug, projectSlug: 'field-ops' };
}

const addTask = (page: Page) => page.getByLabel(/add a task|បន្ថែមការងារ/i);

/**
 * A drag, driven by the mouse — `board.spec.ts`'s helper, for the same reason.
 *
 * Playwright's `dragTo` dispatches HTML5 drag events and `dnd-kit`'s
 * `PointerSensor` listens for pointer events, so `dragTo` does nothing here. The
 * move is stepped rather than instantaneous because the sensor has a 6px
 * activation distance a single jump never crosses in a way it sees.
 */
async function dragHandleOnto(page: Page, handle: Locator, target: Locator): Promise<void> {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('a drag needs both ends on screen');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();

  const endX = to.x + to.width / 2;
  const endY = to.y + Math.min(to.height / 2, 60);
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      from.x + ((endX - from.x) * step) / 8,
      from.y + ((endY - from.y) * step) / 8,
    );
  }

  await page.mouse.up();
}

async function createItem(page: Page, title: string): Promise<void> {
  const input = addTask(page).first();
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
}

/**
 * Opens an item, assigns it to the only member, and gives it a due date.
 *
 * Waits for each control to re-enable before touching the next one. That is
 * slice 8's rule and it is not decoration: a server action aborted mid-flight
 * shows up as `The destination stream closed early` in the log and as a
 * mutation that silently did not happen on screen.
 */
async function prepareItem(
  page: Page,
  base: string,
  title: string,
  options: { due?: string; assign?: boolean; block?: boolean } = {},
): Promise<void> {
  await page.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/\\d+$`));

  if (options.assign) {
    // §4: assignment is multiple, so the control is a set of checkboxes posted
    // whole. Waiting for the button to re-enable is slice 8's rule and not
    // decoration — navigating away mid-action aborts it, which shows up in the
    // server log as `The destination stream closed early` and on screen as a
    // mutation that silently did not happen.
    const save = page.getByRole('button', { name: /save assignees|រក្សាទុកអ្នកទទួលបន្ទុក/i });
    await page.getByRole('checkbox').first().check();
    await save.click();
    await expect(save).toBeEnabled();
  }

  if (options.due) {
    const save = page.getByRole('button', { name: /^(save|រក្សាទុក)$/i }).first();
    await page.getByLabel(/^(due date|ថ្ងៃផុតកំណត់)$/i).fill(options.due);
    await save.click();
    await expect(save).toBeEnabled();
  }

  if (options.block) {
    const save = page.getByRole('button', { name: /mark blocked|សម្គាល់ថាជាប់គាំង/i });
    await page
      .getByLabel(/what is blocking this|តើអ្វីធ្វើឲ្យការងារនេះជាប់គាំង/i)
      .fill('Waiting on parts');
    await save.click();
    // The form swaps to the unblock control once the flag is set, which is the
    // signal that the transition committed.
    await expect(page.getByRole('button', { name: /clear blocked|ដកការជាប់គាំង/i })).toBeVisible();
  }

  await page.goto(base);
}

test.describe('§7.3 — the daily employee loop', () => {
  test('the workspace opens on My Work, grouped by due date', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('mywork', testInfo);
    const { slug, projectSlug } = await newProject(page, locale, company);
    const base = `/${locale}/${slug}/projects/${projectSlug}`;

    await createItem(page, 'Replace the site generator');
    await createItem(page, 'File the quarterly return');

    await prepareItem(page, base, 'Replace the site generator', {
      assign: true,
      due: isoDate(-3),
    });
    await prepareItem(page, base, 'File the quarterly return', {
      assign: true,
      due: isoDate(30),
    });

    // §7.3: "Open app → lands on MY WORK (never a project list)."
    await page.goto(`/${locale}/${slug}`);

    const overdue = page.getByRole('region', { name: /overdue|ហួសកំណត់/i });
    const later = page.getByRole('region', { name: /^later$|^ក្រោយមក$/i });

    await expect(overdue.getByRole('link', { name: 'Replace the site generator' })).toBeVisible();
    await expect(later.getByRole('link', { name: 'File the quarterly return' })).toBeVisible();

    // The item that is 30 days out must not also be in the overdue bucket — the
    // buckets are exclusive by construction (one SQL expression), and this is
    // the assertion that would fail if the counts query and the page query ever
    // stopped sharing it.
    await expect(overdue.getByRole('link', { name: 'File the quarterly return' })).toHaveCount(0);
  });

  test('an empty My Work reads as good news, not as no results', async ({ page }, testInfo) => {
    /**
     * §7.3, verbatim: "nothing assigned → 'You're clear. Here's what your team
     * is working on' + team view link. **Never a bare 'No results'** — an empty
     * My Work is good news and should read that way."
     *
     * §11 makes the same demand of every view's empty state, and this is the one
     * place in the product where the empty state is the *desired* outcome.
     */
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('clear', testInfo);
    const { slug } = await newProject(page, locale, company);

    await page.goto(`/${locale}/${slug}`);

    await expect(page.getByText(/you're clear|អ្នកអស់ការងារហើយ/i)).toBeVisible();
    await expect(page.getByText(/no results|មិនមានលទ្ធផល/i)).toHaveCount(0);

    // And the link out, which is the other half of the sentence.
    await page.getByRole('link', { name: /see the team's work|មើលការងាររបស់ក្រុម/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/team`));
  });
});

test.describe('§7.4 — the manager loop', () => {
  test('needs attention finds the trouble, and says nothing when there is none', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('attention', testInfo);
    const { slug, projectSlug } = await newProject(page, locale, company);
    const base = `/${locale}/${slug}/projects/${projectSlug}`;

    // A fresh workspace has nothing wrong with it, and §7.4 asks for that to be
    // stated: "nothing needs attention → explicit 'Nothing needs your attention'
    // **confirmation** state".
    await page.goto(`/${locale}/${slug}/team?tab=attention`);
    await expect(
      page.getByText(/nothing needs your attention|គ្មានអ្វីត្រូវការការយកចិត្តទុកដាក់ទេ/i),
    ).toBeVisible();

    // Now give it something to find: one overdue, one blocked, and one that is
    // simply unassigned and undated.
    await page.goto(base);
    await createItem(page, 'Chase the customs broker');
    await createItem(page, 'Rewire the compressor');
    await createItem(page, 'Decide on the new supplier');

    await prepareItem(page, base, 'Chase the customs broker', { assign: true, due: isoDate(-2) });
    await prepareItem(page, base, 'Rewire the compressor', { assign: true, block: true });

    await page.goto(`/${locale}/${slug}/team?tab=attention`);

    const overdue = page.getByRole('region', { name: /^overdue$|^ហួសកំណត់$/i });
    const blocked = page.getByRole('region', { name: /^blocked$|^ជាប់គាំង$/i });
    const unassigned = page.getByRole('region', {
      name: /^unassigned$|^គ្មានអ្នកទទួលបន្ទុក$/i,
    });

    await expect(overdue.getByRole('link', { name: 'Chase the customs broker' })).toBeVisible();
    await expect(blocked.getByRole('link', { name: 'Rewire the compressor' })).toBeVisible();
    await expect(
      unassigned.getByRole('link', { name: 'Decide on the new supplier' }),
    ).toBeVisible();

    /**
     * The rows overlap on purpose (`getNeedsAttention`): an item can be overdue
     * *and* blocked and appears under both, because every precedence order that
     * picks one reason is wrong for somebody. The unassigned item is undated
     * too, so it is in two rows — which is the assertion that would fail if
     * somebody "tidied" the rows into a classification.
     */
    const undated = page.getByRole('region', { name: /no due date|គ្មានកាលបរិច្ឆេទកំណត់/i });
    await expect(undated.getByRole('link', { name: 'Decide on the new supplier' })).toBeVisible();
  });

  test('a member on leave shows as away, not as idle capacity', async ({ page }, testInfo) => {
    /**
     * §14's outcome sentence for this slice, and §17-25's finding: "Workload
     * assumed everyone is always available — §7.4 promises the manager an honest
     * picture and had no way to know someone is on leave, so the picture was
     * confidently wrong about the one person it mattered most about."
     *
     * The assertion that matters is not the badge. It is the **capacity line**:
     * a person on leave must leave the "who has capacity" arithmetic, or the
     * badge is decoration on a number that is still wrong.
     */
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('away', testInfo);
    const { slug } = await newProject(page, locale, company);

    await page.goto(`/${locale}/${slug}/team?tab=workload`);

    // One member, present: the capacity line counts one person here.
    await expect(page.getByText(/1 person here|1 នាក់មានវត្តមាន/i)).toBeVisible();
    await expect(page.getByText(/away until|អវត្តមានរហូតដល់/i)).toHaveCount(0);

    // Mark them away through their own settings screen (§4: it is their flag).
    await page.goto(`/${locale}/${slug}/settings/availability`);
    /*
     * The page's own status banner: `main`-scoped, because the shell carries the
     * unverified-email banner as a `status` too and an unscoped role query is
     * ambiguous on every workspace screen until somebody verifies.
     *
     * By role rather than by text, because §11 asks a status to be *stated* and
     * the date field's help text says something similar a few pixels below it.
     */
    const status = page.getByRole('main').getByRole('status');
    await expect(status).toHaveText(/you're available|អ្នកមានវត្តមាន/i);

    const until = page.getByLabel(/back on|ត្រឡប់មកវិញនៅ/i);
    await until.fill(isoDate(10));
    await page.getByLabel(/reason|មូលហេតុ/i).fill('Annual leave');
    await page.getByRole('button', { name: /^save$|^រក្សាទុក$/i }).click();

    await expect(status).toHaveText(/marked away until|សម្គាល់ថាអវត្តមានរហូតដល់/i);

    // The workload now says so, and — the point — stops counting them.
    await page.goto(`/${locale}/${slug}/team?tab=workload`);
    await expect(page.getByText(/away until|អវត្តមានរហូតដល់/i).first()).toBeVisible();
    await expect(page.getByText(/1 away|1 នាក់អវត្តមាន/i)).toBeVisible();
    await expect(page.getByText(/0 people here|0 នាក់មានវត្តមាន/i)).toBeVisible();

    // Coming back is one click, and §6's safety rule says it must never be
    // harder than going away.
    await page.goto(`/${locale}/${slug}/settings/availability`);
    await page.getByRole('button', { name: /i'm back|ខ្ញុំត្រឡប់មកវិញហើយ/i }).click();
    await expect(status).toHaveText(/you're available|អ្នកមានវត្តមាន/i);
  });

  test('the team scope and tabs live in the URL', async ({ page }, testInfo) => {
    // §5: any view state is a URL you can paste in chat. The tab and the team
    // are both scope, so both travel with the link.
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('scope', testInfo);
    const { slug } = await newProject(page, locale, company);

    await page.goto(`/${locale}/${slug}/team`);
    await page.getByRole('link', { name: /needs attention|ត្រូវការការយកចិត្តទុកដាក់/i }).click();
    await expect(page).toHaveURL(/tab=attention/);

    await page.getByRole('link', { name: /^workload$|^បន្ទុកការងារ$/i }).click();
    await expect(page).toHaveURL(/tab=workload/);

    // The seeded team, picked from the switcher, pins itself alongside the tab.
    await page
      .getByRole('navigation', { name: /^team$|^ក្រុម$/i })
      .getByRole('link')
      .nth(1)
      .click();
    await expect(page).toHaveURL(/tab=workload&team=/);
  });

  test('a card dragged between columns changes who owns it', async ({ page }, testInfo) => {
    /**
     * §7.4: "drag a card between people to reassign (notifies both)".
     *
     * The gesture means something different from §7.5's — that one changes a
     * state and computes a rank, this one changes an assignee and computes
     * nothing — so it posts to `api/internal/reassign` rather than to
     * `reorder`. The assertion that matters is the one after the reload: an
     * optimistic move that the server refused looks identical until then.
     */
    test.skip(
      testInfo.project.name === 'mobile-km',
      'A pointer drag needs both columns on screen at once; the mobile viewport scrolls them.',
    );

    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('reassign', testInfo);
    const { slug, projectSlug } = await newProject(page, locale, company);
    const base = `/${locale}/${slug}/projects/${projectSlug}`;

    await createItem(page, 'Recover the stalled shipment');
    await prepareItem(page, base, 'Recover the stalled shipment', { assign: true });

    await page.goto(`/${locale}/${slug}/team?tab=workload`);

    const owner = page.getByRole('region', { name: 'Dashboard Owner' });
    const unassigned = page.getByRole('region', {
      name: /^unassigned$|^គ្មានអ្នកទទួលបន្ទុក$/i,
    });

    await expect(owner.getByRole('link', { name: 'Recover the stalled shipment' })).toBeVisible();

    /*
     * The handle, not the card — a card that is entirely draggable is a card
     * nobody can click through to the item (§12, slice 6).
     *
     * And the **list** inside the target column, not the column: the droppable
     * is the `ul`, so a drop aimed at the section's centre can land in its
     * header and be seen by nothing.
     */
    await dragHandleOnto(
      page,
      owner.getByRole('button', { name: /FO-1/ }),
      unassigned.getByRole('list'),
    );

    // Optimistic, so it is there before the server answers (§11).
    await expect(
      unassigned.getByRole('link', { name: 'Recover the stalled shipment' }),
    ).toBeVisible();

    // And it survives a reload, which is the half that proves the server agreed
    // rather than the browser having drawn a hopeful picture.
    await page.reload();
    await expect(
      page
        .getByRole('region', { name: /^unassigned$|^គ្មានអ្នកទទួលបន្ទុក$/i })
        .getByRole('link', { name: 'Recover the stalled shipment' }),
    ).toBeVisible();
  });
});
