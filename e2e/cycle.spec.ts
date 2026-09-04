import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 11:
 *
 *   "Cycles + progress + burndown — Run a two-week cycle end to end."
 *
 * So this walks §7.6 in order: create with a date range, add items from the
 * backlog, watch progress move, and answer the end-of-cycle prompt. Run in `en`
 * and `km` like every other spec (§15).
 *
 * The Khmer run is not a formality. The cycle pages are entirely new surfaces
 * with a large new message block, and a missing key renders as a raw
 * `cycles.close.heading` on screen rather than as a failing unit test — the
 * exact failure §13 says is the most expensive available mistake to retrofit.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/** `YYYY-MM-DD`, `days` from today. The form takes native date inputs. */
function day(offset: number): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

async function newProject(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<{ slug: string; projectSlug: string }> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Cycle Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
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

/** Creates one item from the inline composer and waits for it to land. */
async function createItem(page: Page, title: string): Promise<void> {
  const input = addTask(page).first();
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
}

test.describe('cycles', () => {
  test('a cycle runs end to end: plan, fill, progress, close', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Cyc', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    const base = `/${locale}/${slug}/projects/${projectSlug}`;

    // Two items in the backlog for the cycle to be filled with.
    await createItem(page, 'Ship the invoice export');
    await createItem(page, 'Chase the signed contract');

    // §8's `projects/[projectId]/ views · cycles · settings` — the link is on
    // the project header, visible to anyone who can see the project.
    await page.getByRole('link', { name: /^(cycles|វដ្តការងារ)$/i }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/cycles$`));

    // §11: the empty state says what a cycle is for, above a live form.
    await expect(page.getByRole('button', { name: /create cycle|បង្កើតវដ្តការងារ/i })).toBeVisible();

    // ---- §7.6 step one: create with a date range --------------------------
    // A fortnight, which is §14's own phrasing for what a cycle is.
    await page.getByLabel(/^(name|ឈ្មោះ)\*?$/i).fill('Sprint 1');
    await page.getByLabel(/^(starts|ចាប់ផ្ដើម)\*?$/i).fill(day(0));
    await page.getByLabel(/^(ends|បញ្ចប់)\*?$/i).fill(day(13));
    await page.getByLabel(/^(goal|គោលដៅ)$/i).fill('Clear the invoicing backlog.');
    await page.getByRole('button', { name: /create cycle|បង្កើតវដ្តការងារ/i }).click();

    // §7.6's next step is adding work, so creation lands on the cycle itself.
    await expect(page).toHaveURL(new RegExp(`${base}/cycles/[0-9a-f-]+$`));
    await expect(page.getByRole('heading', { name: /Sprint 1/ })).toBeVisible();

    // Derived from the dates and today, never stored — a cycle starting today
    // is active without anything having run to make it so.
    await expect(page.locator('body')).toContainText(
      locale === 'km' ? 'កំពុងដំណើរការ' : 'Active',
    );

    // ---- §7.6 step two: add items, multi-select from backlog --------------
    await page.getByRole('checkbox', { name: /Ship the invoice export/ }).check();
    await page.getByRole('button', { name: /add 1 item|បន្ថែម 1 កិច្ចការ/i }).click();

    // ---- Progress reads off the state group, and the burndown is drawn ----
    const bar = page.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '0');

    // The chart is present and reachable, not merely painted: §11's baseline
    // asks for correct roles, and a chart announced as nothing is a chart a
    // screen-reader user is told exists and no more.
    await expect(page.getByRole('img').first()).toBeVisible();

    // ---- Finish the work, and watch the bar move --------------------------
    await page.getByRole('link', { name: 'Ship the invoice export' }).click();

    // §4: completion derives from the state *group*, so the seeded "Done"
    // state is what moves the bar — not a state whose name happens to say so.
    // Named for the item it belongs to (`State of FO-1`), which is what makes
    // it unambiguous on a list of rows — the same selector `activity.spec.ts`
    // and `work-item.spec.ts` use.
    const stateSelect = page.getByRole('combobox', { name: /FO-1/ });
    await stateSelect.selectOption({ label: locale === 'km' ? 'បានបញ្ចប់' : 'Done' });
    // Slice 8's rule, and the reason two earlier specs were fixed: wait for the
    // control that owns the mutation to re-enable itself before navigating, or
    // the server action is aborted mid-flight.
    await expect(stateSelect).toBeEnabled();

    await page.goBack();
    await page.reload();
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('the end-of-cycle prompt is a decision, and answering it closes the cycle', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Close', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    const base = `/${locale}/${slug}/projects/${projectSlug}`;
    await createItem(page, 'Unfinished business');

    await page.goto(`${base}/cycles`);

    // A cycle that has already ended, so §7.6's prompt is due. Nothing runs on
    // a schedule to produce this state — it is derived from the dates being in
    // the past and nobody having answered yet, which is the whole reason there
    // is no status column.
    await page.getByLabel(/^(name|ឈ្មោះ)\*?$/i).fill('Last sprint');
    await page.getByLabel(/^(starts|ចាប់ផ្ដើម)\*?$/i).fill(day(-14));
    await page.getByLabel(/^(ends|បញ្ចប់)\*?$/i).fill(day(-1));
    await page.getByRole('button', { name: /create cycle|បង្កើតវដ្តការងារ/i }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/cycles/[0-9a-f-]+$`));

    await expect(page.locator('body')).toContainText(
      locale === 'km' ? 'ផុតកំណត់' : 'Ended',
    );

    // §7.6's prompt, present the moment the cycle has ended.
    await expect(
      page.getByRole('button', { name: /close cycle|បិទវដ្តការងារ/i }),
    ).toBeVisible();

    // "Return them to the backlog" is one of the three answers, and the work
    // has to survive it — the point of the prompt is that nothing moves without
    // somebody choosing.
    await page.getByRole('radio', { name: /backlog|បញ្ជីការងាររង់ចាំ/i }).check();
    await page.getByRole('button', { name: /close cycle|បិទវដ្តការងារ/i }).click();

    // Answered, so the cycle is closed and the prompt is gone — a prompt that
    // reappeared after being dismissed is one nobody ever finishes answering.
    await expect(page.locator('body')).toContainText(
      locale === 'km' ? 'បានបិទ' : 'Closed',
    );
    await expect(page.getByRole('button', { name: /close cycle|បិទវដ្តការងារ/i })).toHaveCount(0);

    // And the item is still there, back in the project's work.
    await page.goto(base);
    await expect(page.getByRole('link', { name: 'Unfinished business' })).toBeVisible();
  });

  test('the list filters by cycle, and the backlog is a real choice', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Filt', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    const base = `/${locale}/${slug}/projects/${projectSlug}`;
    await createItem(page, 'Planned work');
    await createItem(page, 'Unplanned work');

    await page.goto(`${base}/cycles`);
    await page.getByLabel(/^(name|ឈ្មោះ)\*?$/i).fill('Sprint 2');
    await page.getByLabel(/^(starts|ចាប់ផ្ដើម)\*?$/i).fill(day(0));
    await page.getByLabel(/^(ends|បញ្ចប់)\*?$/i).fill(day(13));
    await page.getByRole('button', { name: /create cycle|បង្កើតវដ្តការងារ/i }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/cycles/[0-9a-f-]+$`));

    // Plan exactly one of the two.
    // The checkbox's accessible name comes from its own label, which carries
    // the identifier and the title — so the selection names the item rather
    // than trusting the order the backlog happened to come back in.
    await page.getByRole('checkbox', { name: /Planned work/ }).check();
    await page.getByRole('button', { name: /add 1 item|បន្ថែម 1 កិច្ចការ/i }).click();

    // §5: "any view state is a URL". The cycle filter rides in the query string
    // the same way every other filter does, so this is shareable.
    await page.goto(base);
    const cycleFilter = page.getByRole('combobox', {
      name: /^(cycle|វដ្តការងារ)$/i,
    });
    await cycleFilter.selectOption({ label: 'Sprint 2' });

    await expect(page).toHaveURL(/[?&]c=/);
    await expect(page.getByRole('link', { name: 'Unplanned work' })).toHaveCount(0);

    // The backlog is a first-class choice, not the absence of one — "what is
    // not planned into anything" is the question sprint planning opens with.
    await cycleFilter.selectOption({ label: locale === 'km' ? 'បញ្ជីការងាររង់ចាំ' : 'Backlog' });
    await expect(page.getByRole('link', { name: 'Unplanned work' })).toBeVisible();
  });
});
