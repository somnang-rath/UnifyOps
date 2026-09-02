import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 4:
 *
 *   "Create a project, six default states, switch to Khmer, all translated."
 *
 * Run in `en` and `km` like every other spec, and the Khmer run is the point of
 * this one: the six states are seeded by the server with a message key, so a
 * state that renders as "In Progress" in the Khmer run means the seeded-default
 * mechanism (§13) has quietly stopped working — which is exactly the failure
 * that would otherwise be noticed a slice or two later, by a customer.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/** Signup through to a workspace with nothing in it. */
async function newWorkspace(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<string> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Project Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
  return slug;
}

test.describe('projects', () => {
  test('a new project lands on a board with six default states', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('Proj', testInfo);
    const slug = await newWorkspace(
      page,
      locale,
      company,
      `${unique('owner', testInfo)}@example.com`,
    );

    await page.goto(`/${locale}/${slug}/projects`);

    // §11: the empty state offers the one action that fills it, rather than
    // being a shrug.
    await page.getByRole('link', { name: /new project|គម្រោងថ្មី/i }).first().click();

    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Website Redesign');

    // §7.1: "prefix auto-suggested". Derived on the client from the same pure
    // function the server validates with, so the preview cannot disagree with
    // what is saved.
    await expect(page.getByLabel(/item prefix|បុព្វបទកិច្ចការ/i)).toHaveValue('WR');
    await expect(page.getByLabel(/project address|អាសយដ្ឋានគម្រោង/i)).toHaveValue(
      'website-redesign',
    );

    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();

    // §7.1: land on the BOARD, six default states already present.
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/website-redesign$`));

    const board = page.getByRole('list', { name: /board|ក្តារការងារ/i });
    await expect(board.getByRole('listitem')).toHaveCount(6);

    // The names themselves, per locale. Asserting the count alone would pass
    // with six columns all reading "defaultState.todo".
    if (locale === 'km') {
      // The catalogue's own values rather than a guess at them — km.json is
      // the authority on what "In Progress" and "Done" read as in Khmer.
      await expect(board).toContainText('កំពុងដំណើរការ');
      await expect(board).toContainText('បានបញ្ចប់');
      await expect(board).not.toContainText('In Progress');
    } else {
      await expect(board).toContainText('In Progress');
      await expect(board).toContainText('Done');
    }
  });

  test('a lead renames a seeded state and the rename sticks in both languages', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('States', testInfo);
    const slug = await newWorkspace(
      page,
      locale,
      company,
      `${unique('lead', testInfo)}@example.com`,
    );

    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Field Ops');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();

    await page.getByRole('link', { name: /project settings|ការកំណត់គម្រោង/i }).click();
    await expect(page).toHaveURL(/\/projects\/field-ops\/settings$/);

    // §6-3: add, rename, recolour, reorder, regroup. The rename is the one that
    // matters for §13 — it clears the seeded message key, so from here on the
    // literal wins in every locale.
    const nameFields = page.getByLabel(/state name|ឈ្មោះស្ថានភាព/i);
    await nameFields.first().fill('Icebox');
    await page
      .getByRole('button', { name: /^(save state|រក្សាទុកស្ថានភាព)$/i })
      .first()
      .click();

    // Wait for the *rendered* name, not the field's own value: the input is
    // uncontrolled, so it holds "Icebox" the instant it is typed whether or not
    // the save ever completed. The pill beside it comes from server data, so it
    // only changes once the action has landed and the page has revalidated —
    // which is also what stops the next navigation from racing the write.
    await expect(page.getByText('Icebox').first()).toBeVisible();

    // The board shows it too, and — because the key is now cleared — shows the
    // same literal whichever language the reader is in.
    await page.goto(`/${locale}/${slug}/projects/field-ops`);
    await expect(page.locator('body')).toContainText('Icebox');

    const other = locale === 'km' ? 'en' : 'km';
    await page.goto(`/${other}/${slug}/projects/field-ops`);
    await expect(page.locator('body')).toContainText('Icebox');
  });
});
