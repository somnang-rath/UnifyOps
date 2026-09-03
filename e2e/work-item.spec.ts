import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 5:
 *
 *   "Work items + list query + List view — Create, edit, filter, group,
 *   paginate."
 *
 * Run in `en` and `km` like every other spec (§15). The Khmer run is not a
 * formality here: the inline create input, the filter bar and the group
 * headings are all new surfaces, and a missing catalogue key shows up as a raw
 * `workItems.addPlaceholder` on screen rather than as a failing unit test.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/** Signup through to a project with its six seeded states, ready for work. */
async function newProject(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<{ slug: string; projectSlug: string }> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Item Owner');
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
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/field-ops$`));

  return { slug, projectSlug: 'field-ops' };
}

const addTask = (page: Page) => page.getByLabel(/add a task|បន្ថែមការងារ/i);

test.describe('work items', () => {
  test('an item is created inline, opens by its human id, and takes an edit', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Items', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    // §7.2: inline `+` at the bottom of a group → type a title → Enter. There
    // is no create-task modal in the default path, so there is no button to
    // find first — the input is already on screen, once per group.
    const first = addTask(page).first();
    await first.fill('Ship the invoice export');
    await first.press('Enter');

    await expect(page.getByRole('link', { name: 'Ship the invoice export' })).toBeVisible();

    // §7.2 again: "input stays focused for the next". Typing five titles in a
    // row is the real Monday-morning behaviour, and a form that loses focus
    // turns that into five clicks.
    await expect(addTask(page).first()).toBeFocused();
    await expect(addTask(page).first()).toHaveValue('');

    // A second item in the same group, to prove the first was not a fluke and
    // that the counter keeps issuing numbers.
    await addTask(page).first().fill('Chase the signed contract');
    await addTask(page).first().press('Enter');
    await expect(page.getByRole('link', { name: 'Chase the signed contract' })).toBeVisible();

    // §9: the human identifier. `FO-1` for the first item in a project keyed
    // FO — and the URL is the number, because §7.9 makes that string something
    // people paste to each other.
    await expect(page.locator('body')).toContainText('FO-1');

    await page.getByRole('link', { name: 'Ship the invoice export' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/${projectSlug}/1$`),
    );

    // §14's "edit". The description is a plain textarea this slice; the editor
    // is slice 8's decision, made once for this field and comments together.
    await page.getByLabel(/^(description|ការពិពណ៌នា)$/i).fill('Due before the audit.');
    await page.getByLabel(/^(priority|អាទិភាព)$/i).selectOption('urgent');
    await page.getByRole('button', { name: /^(save|រក្សាទុក)$/i }).first().click();

    await expect(page.getByLabel(/^(priority|អាទិភាព)$/i)).toHaveValue('urgent');
  });

  test('the list filters and groups, and the URL carries both', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Filter', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await addTask(page).first().fill('Urgent thing');
    await addTask(page).first().press('Enter');
    await expect(page.getByRole('link', { name: 'Urgent thing' })).toBeVisible();

    await addTask(page).first().fill('Ordinary thing');
    await addTask(page).first().press('Enter');
    await expect(page.getByRole('link', { name: 'Ordinary thing' })).toBeVisible();

    // Make one of them urgent, so a priority filter has something to separate.
    await page.getByRole('link', { name: 'Urgent thing' }).click();
    await page.getByLabel(/^(priority|អាទិភាព)$/i).selectOption('urgent');
    await page.getByRole('button', { name: /^(save|រក្សាទុក)$/i }).first().click();
    await expect(page.getByLabel(/^(priority|អាទិភាព)$/i)).toHaveValue('urgent');

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}`);

    // §12's FilterBar over the §9 DSL. The control is the filter bar's
    // "Priority", which sits inside the bar rather than on an item.
    await page
      .getByRole('combobox', { name: /^(priority|អាទិភាព)$/i })
      .first()
      .selectOption('urgent');

    // §5: "Any view state is a URL." The filter is in the query string, so the
    // link is shareable and the back button works.
    await expect(page).toHaveURL(/[?&]pr=urgent/);
    await expect(page.getByRole('link', { name: 'Urgent thing' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ordinary thing' })).toHaveCount(0);

    // The same URL, opened cold, shows the same list — which is the whole
    // promise of putting view state in the address bar.
    const filtered = page.url();
    await page.goto(filtered);
    await expect(page.getByRole('link', { name: 'Urgent thing' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ordinary thing' })).toHaveCount(0);

    // Regrouping is the other half of §14's outcome. Grouped by priority, the
    // five priorities are the five groups — including the empty ones, because a
    // group that vanishes when it empties cannot be added to.
    await page.goto(`/${locale}/${slug}/projects/${projectSlug}?by=priority`);
    await expect(page.getByRole('region')).toHaveCount(5);
    await expect(page.getByRole('link', { name: 'Urgent thing' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ordinary thing' })).toBeVisible();
  });

  test('a state change from the list sticks', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Advance', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await addTask(page).first().fill('Move me along');
    await addTask(page).first().press('Enter');
    await expect(page.getByRole('link', { name: 'Move me along' })).toBeVisible();

    // §7.3: "click a state pill to advance an item (one click, optimistic)".
    // The row's state control is a select, so the whole create → advance loop
    // is reachable without a mouse (§11's accessibility baseline).
    //
    // Addressed by the item it belongs to, not by "State" — the filter bar has
    // a control by that name too, and fifty rows would otherwise be fifty
    // identically-named controls for a screen reader as well as for this test.
    const rowState = page.getByRole('combobox', { name: /FO-1/ });
    const options = await rowState.locator('option').all();
    const target = await options[2]!.getAttribute('value');
    await rowState.selectOption(target!);

    // The select disables itself while the transition is in flight (see
    // `state-select.tsx`), so waiting for it to come back is what makes the
    // navigation below assert a committed write rather than race it. Without
    // this, `goto` can abort the server action mid-flight — which shows up in
    // the server log as "The destination stream closed early" and here as a
    // state change that silently did not happen.
    await expect(rowState).toBeEnabled();

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}`);
    // Reloaded from the server, so this asserts the write landed rather than
    // that the optimistic update rendered.
    await expect(page.getByRole('combobox', { name: /FO-1/ })).toHaveValue(target!);
  });
});
