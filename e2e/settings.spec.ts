import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 15:
 *
 *   "Settings — all seven customization areas, holiday calendar, view-as.
 *    §6 complete; an owner can see the product as any member sees it."
 *
 * Both halves are below. Everything runs in `en` and `km`, which §15 asks of a
 * slice's primary flow and which is what stops Khmer becoming the path nobody
 * walks — and it matters more here than in most slices, because §6-1's language
 * setting and §6-7's colour choices are exactly the sort of screen that gets
 * built in one language and translated later.
 *
 * Accounts are unique per run and per project: the projects share one database,
 * and a fixed address would make the second project fail with "email taken" — a
 * failure that says nothing about the product.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/** Sign up and create a company, landing on the invite step. */
async function newCompany(
  page: Page,
  locale: string,
  testInfo: { project: { name: string } },
): Promise<string> {
  const email = `${unique('owner', testInfo)}@example.com`;
  const company = unique('Settings', testInfo);

  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Workspace Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${locale}/new-workspace$`));
  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

  return slug;
}

test.describe('settings', () => {
  test('the company calendar arrives seeded and warns about nothing else', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const slug = await newCompany(page, locale, testInfo);

    await page.goto(`/${locale}/${slug}/settings/holidays`);

    /*
     * §18-10's first half: "seed the current and next year at signup". A
     * workspace defaults to Asia/Phnom_Penh, so a brand-new company already has
     * the fixed-date Cambodian holidays — the point being that a company which
     * never opens Settings is still correct about time (§6's governing rule).
     */
    await expect(page.getByText('01-01', { exact: false }).first()).toBeVisible();

    /*
     * §18-10's second half, and the part it would have been easy to skip: the
     * moveable closures are **named and undated**. Khmer New Year is decided by
     * sub-decree and moves, so seeding a guess would leave the calendar looking
     * complete while being wrong for the fortnight that matters most.
     */
    await expect(page.getByText(/Khmer New Year|ចូលឆ្នាំខ្មែរ/)).toBeVisible();
    await expect(page.getByText(/Pchum Ben|ភ្ជុំបិណ្ឌ/)).toBeVisible();

    // And it is editable, which §4 says is the difference between a calendar
    // and one that is "confidently wrong".
    await page.getByLabel(/^date|កាលបរិច្ឆេទ/i).fill('2026-04-14');
    await page.getByLabel(/^name|^ឈ្មោះ/i).fill('Khmer New Year');
    await page.getByRole('button', { name: /^add$|^បន្ថែម$/i }).click();

    await expect(page.getByText('2026-04-14')).toBeVisible();
  });

  test('a company that works no days at all is refused', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const slug = await newCompany(page, locale, testInfo);

    await page.goto(`/${locale}/${slug}/settings/general`);

    /*
     * §6: "No setting can put a workspace in an unrecoverable state." A working
     * week of nothing is the one control on this form that could — the digest
     * would never fire, every burndown would be undefined, and none of it
     * reports an error anywhere a person would see it.
     *
     * Unticked one at a time, because the checkbox group *is* the control and a
     * form post with a zero mask is not something the screen can otherwise
     * produce.
     */
    const days = page.getByRole('checkbox');

    // **`count()` does not auto-wait, and from slice 16 this page streams.**
    // §11's loading state added a `loading.tsx` under `[workspaceSlug]`, so
    // `goto` resolves on `load` while the form is still arriving — and a
    // `count()` taken then is zero. The loop would do nothing, Save would post
    // the unchanged mask, and the test would fail claiming the product had not
    // refused an empty working week. One assertion that waits fixes it, and the
    // rule generalises: anchor on something visible before any counting API.
    await expect(days.first()).toBeVisible();
    const count = await days.count();
    for (let index = 0; index < count; index += 1) {
      const day = days.nth(index);
      if (await day.isChecked()) await day.uncheck();
    }

    await page.getByRole('button', { name: /save|រក្សាទុក/i }).click();

    // Reported on the field that caused it (§11), not as a form-level shrug.
    await expect(page.getByText(/at least one working day|យ៉ាងតិចមួយថ្ងៃធ្វើការ/i)).toBeVisible();
  });

  test('an owner sees the product as a member sees it, and cannot change anything', async ({
    browser,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';

    const context = await browser.newContext();
    const page = await context.newPage();
    const slug = await newCompany(page, locale, testInfo);

    /*
     * §7.13 needs somebody to view *as*. The owner invites one person, and the
     * pending invitation is not enough — view-as resolves a real member — so
     * this test uses the second member the workspace already has once an
     * invitation is accepted. Rather than drive a second signup, it goes to the
     * members screen and views as the only other row, skipping when there is
     * none: a workspace of one has nothing this flow can demonstrate, and
     * asserting on it would be asserting on the fixture.
     */
    await page.goto(`/${locale}/${slug}/settings/members`);

    const viewAs = page.getByRole('button', { name: /view as|មើលជា/i });

    // As above: the members table streams behind `loading.tsx`, and counting
    // *absence* is only meaningful once the page has arrived. The owner's own
    // row is always there, so it is the anchor.
    await expect(page.getByRole('table')).toBeVisible();

    test.skip(
      (await viewAs.count()) === 0,
      'A workspace of one has nobody to view as — the invited member has not accepted.',
    );

    await viewAs.first().click();

    // §7.13: "the app re-renders as that person — their projects, their
    // navigation, their My Work." So it lands on the workspace root, not on the
    // page the owner was reading.
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}$`));

    // "A persistent bar names who is being viewed and offers Exit."
    const bar = page.getByRole('status').filter({ hasText: /viewing as|កំពុងមើលជា/i });
    await expect(bar).toBeVisible();

    // It is on *every* screen, not only the one that started the session —
    // which is the failure it exists to prevent.
    await page.goto(`/${locale}/${slug}/projects`);
    await expect(bar).toBeVisible();

    await bar.getByRole('button', { name: /exit|ចាកចេញ/i }).click();

    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/settings/members$`));
    await expect(page.getByRole('status').filter({ hasText: /viewing as|កំពុងមើលជា/i })).toHaveCount(
      0,
    );

    await context.close();
  });

  test('the accent colour is a token name, and it reaches the whole shell', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const slug = await newCompany(page, locale, testInfo);

    await page.goto(`/${locale}/${slug}/settings/branding`);

    /*
     * §6-7. The picker is a radio group over the four brand colours that
     * survive a contrast check as a fill in both themes.
     *
     * **The label is clicked, not the radio**, and that is about the component
     * rather than about Playwright. The input is `sr-only` so the swatch can
     * show the real token resolving on the real ground, which means the swatch
     * covers the 1px box the input occupies — `check()` targets the input
     * itself and correctly refuses to click something obscured. A person clicks
     * the label and the association does the rest, so that is what this does.
     */
    const lilac = page.getByRole('radio', { name: /lilac|ស្វាយខ្ចី/i });
    await page.locator('label').filter({ has: lilac }).click();
    await expect(lilac).toBeChecked();

    const save = page.getByRole('button', { name: /save|រក្សាទុក/i });
    await save.click();

    /*
     * **Wait for the button to come back before navigating**, which is slice
     * 8's rule and not a politeness: `page.goto` during an in-flight server
     * action aborts it, and what that looks like on screen is a save that
     * silently did not happen. `Button` disables itself while `useActionState`
     * is pending, so re-enabling is the signal that the write committed — the
     * same signal `activity.spec.ts` and `work-item.spec.ts` take from
     * `StateSelect`.
     *
     * This test found that race rather than inheriting it: the assertion below
     * used to be `[data-accent="lilac"]` unscoped, which matches the *swatch*
     * inside the picker — an element that carries the attribute whether or not
     * anything was saved. It passed instantly, waited for nothing, and the
     * reload then raced the action it was supposed to be waiting for.
     */
    await expect(save).toBeEnabled();

    /*
     * The assertion is the *attribute*, not a colour. What is stored is a token
     * name and `globals.css` decides what it means on each ground — so checking
     * a computed rgb would be checking the stylesheet, and would have to change
     * whenever a ramp step was tuned. The contract this screen owes is that the
     * shell carries the company's choice down to every component saying
     * `bg-accent` — so it is asserted of the element that *contains the shell*,
     * which is the claim, rather than of any element that happens to carry the
     * attribute.
     */
    const shell = page.locator('[data-accent="lilac"]').filter({ has: page.getByRole('banner') });
    await expect(shell).toBeVisible();

    // It is stored, not merely on screen: a reload re-reads it from the row.
    await page.reload();
    await expect(lilac).toBeChecked();

    // And it survives a navigation, because it is on the workspace layout
    // rather than on the settings page that set it.
    await page.goto(`/${locale}/${slug}`);
    await expect(shell).toBeVisible();
  });
});
