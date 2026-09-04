import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 12:
 *
 *   "Table + Calendar + saved views — All four view types."
 *
 * So this walks all four, in one session, on one project: switch between them
 * through the segmented control, resize a table column with the keyboard,
 * page the calendar to another month, and save the view — then come back to it
 * by name and check it restored the filter it was named for.
 *
 * Run in `en` and `km` like every other spec (§15). The Khmer run is not a
 * formality here either: the table's column headings, the calendar's month
 * navigation and the whole saved-views bar are new message blocks, and a
 * missing key renders as a raw `table.columns.title` on screen while every unit
 * test still passes — next-intl swallows the error into the server log, which
 * is exactly how slice 10's `soon` defect stayed invisible.
 *
 * The month and weekday names are deliberately **not** asserted as literal
 * strings. They come from `Intl` in the reader's locale, so pinning "September"
 * would fail the Khmer run for the right reason and the wrong one at once —
 * what matters is that navigating changes the month, not what the month is
 * called.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e7).toString(36)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function newProject(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<{ slug: string; projectSlug: string }> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('View Owner');
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

async function createItem(page: Page, title: string): Promise<void> {
  const input = addTask(page).first();
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
}

test.describe('the four view types', () => {
  test('list, board, table and calendar all render the same project', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('views', testInfo);
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      company,
      `${company}@example.test`,
    );
    const base = `/${locale}/${slug}/projects/${projectSlug}`;

    await createItem(page, 'Survey the north site');
    await createItem(page, 'Order the replacement pump');

    // --- Table ---------------------------------------------------------------
    // Through the switcher rather than by typing the URL, because the switcher
    // carrying the rest of the query is half of what §5 promises.
    await page.getByRole('link', { name: /^table$|^តារាង$/i }).click();
    await expect(page).toHaveURL(new RegExp(`${base}[?].*view=table`));

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByRole('link', { name: 'Survey the north site' })).toBeVisible();
    await expect(table.getByRole('link', { name: 'Order the replacement pump' })).toBeVisible();

    // §12's sticky header, as column headers a screen reader can find. Seven
    // default columns; asserting the count rather than the names keeps this
    // honest in both locales.
    await expect(table.getByRole('columnheader')).toHaveCount(7);

    // --- Calendar ------------------------------------------------------------
    await page.getByRole('link', { name: /^calendar$|^ប្រតិទិន$/i }).click();
    await expect(page).toHaveURL(new RegExp(`${base}[?].*view=calendar`));

    // No month in the URL yet, and that is deliberate: an unpinned calendar
    // link means "the current month", the same bargain `d=overdue` makes.
    await expect(page).not.toHaveURL(/m=\d{4}-\d{2}/);

    // Paging pins one, so a link shared from here names the month it showed.
    await page.getByRole('link', { name: /next month|ខែបន្ទាប់/i }).click();
    await expect(page).toHaveURL(/m=\d{4}-\d{2}/);
    const paged = new URL(page.url()).searchParams.get('m');

    // And back. Asserted as "no longer the month we paged to" rather than as a
    // match on `m=`, which the stale URL would satisfy the instant it is read.
    await page.getByRole('link', { name: /this month|ខែនេះ/i }).click();
    await expect(page).not.toHaveURL(new RegExp(`m=${paged}(&|$)`));
    await expect(page).toHaveURL(/m=\d{4}-\d{2}/);

    // --- Back to the list ----------------------------------------------------
    await page.getByRole('link', { name: /^list$|^បញ្ជី$/i }).click();
    await expect(page.getByRole('link', { name: 'Survey the north site' })).toBeVisible();
  });

  test('a table column can be resized with the keyboard alone', async ({ page }, testInfo) => {
    // §11's baseline is "keyboard-operable throughout", and a resize handle is
    // not exempt because the usual way to use it is a drag.
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('resize', testInfo);
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      company,
      `${company}@example.test`,
    );

    await createItem(page, 'Measurable work');

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}?view=table`);

    const handles = page.getByRole('separator');
    const first = handles.first();
    const before = Number(await first.getAttribute('aria-valuenow'));

    await first.focus();
    await page.keyboard.press('ArrowRight');

    await expect
      .poll(async () => Number(await first.getAttribute('aria-valuenow')))
      .toBeGreaterThan(before);

    // And back the other way, so the control is not one-directional.
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await first.getAttribute('aria-valuenow'))).toBe(before);
  });
});

test.describe('saved views', () => {
  test('a filter can be named, returned to, and deleted', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('saved', testInfo);
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      company,
      `${company}@example.test`,
    );
    const base = `/${locale}/${slug}/projects/${projectSlug}`;

    await createItem(page, 'Urgent repair');

    // A filter worth naming, and one the new item matches — so the table draws
    // a table rather than its empty state, and returning to the view can assert
    // that the *whole* view state came back. Set through the URL rather than
    // the controls: this spec is about the saving, and the filter bar has its
    // own coverage.
    await page.goto(`${base}?view=table&d=none`);

    await page.getByRole('button', { name: /save this view|រក្សាទុកទិដ្ឋភាពនេះ/i }).click();
    await page.getByLabel(/view name|ឈ្មោះទិដ្ឋភាព/i).fill('Urgent work');
    await page.getByRole('button', { name: /^save$|^រក្សាទុក$/i }).click();

    const chip = page.getByRole('link', { name: 'Urgent work' });
    await expect(chip).toBeVisible();
    // It describes what is on screen, so it marks itself current.
    await expect(chip).toHaveAttribute('aria-current', 'page');

    // Navigate away from the filter, then come back by name.
    await page.goto(base);
    await expect(page.getByRole('link', { name: 'Urgent work' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByRole('link', { name: 'Urgent work' }).click();
    // The whole view state came back — the filter *and* which renderer drew it.
    await expect(page).toHaveURL(new RegExp(`${base}[?].*view=table`));
    await expect(page).toHaveURL(/d=none/);
    await expect(page.getByRole('table')).toBeVisible();

    // Naming a second view the same thing is refused, in the field that caused
    // it, and the typed name is kept (§11).
    await page.getByRole('button', { name: /save this view|រក្សាទុកទិដ្ឋភាពនេះ/i }).click();
    const nameField = page.getByLabel(/view name|ឈ្មោះទិដ្ឋភាព/i);
    await nameField.fill('Urgent work');
    await page.getByRole('button', { name: /^save$|^រក្សាទុក$/i }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(nameField).toHaveValue('Urgent work');

    // And it can be removed again.
    await page.getByRole('button', { name: /delete the view Urgent work|លុបទិដ្ឋភាព Urgent work/i }).click();
    await expect(page.getByRole('link', { name: 'Urgent work' })).toHaveCount(0);
  });
});
