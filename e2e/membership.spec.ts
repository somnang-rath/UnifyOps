import { expect, test, type Page } from '@playwright/test';
import { inviteTokenFrom, waitForMail } from './support/mailbox';

/**
 * §14's definition of done for slice 3:
 *
 *   "Two users sign up, one invites the other, both land in the same workspace;
 *    a pasted list of ten addresses goes out in one action."
 *
 * Both halves are below, and both run in `en` and `km` — §15 asks the slice's
 * primary flow to be exercised in both, which is what stops Khmer from becoming
 * the path nobody walks.
 *
 * Every account is unique per run and per project, because the projects share
 * one database and a fixed address would make the second project fail with
 * "email taken" — a failure that says nothing about the product.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function signUp(
  page: Page,
  locale: string,
  account: { name: string; email: string },
  options: { invite?: string } = {},
): Promise<void> {
  const path = options.invite
    ? `/${locale}/sign-up?invite=${encodeURIComponent(options.invite)}`
    : `/${locale}/sign-up`;

  await page.goto(path);

  // By label, not by selector. §12 requires a real label above every field, so
  // if this stops working the accessibility baseline broke before the test did.
  await page.getByLabel(/name|ឈ្មោះ/i).fill(account.name);
  await page.getByLabel(/email|អ៊ីមែល/i).fill(account.email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
}

test.describe('membership', () => {
  test('an owner signs up, creates a company, and invites ten people at once', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const owner = `${unique('owner', testInfo)}@example.com`;
    const company = unique('Acme', testInfo);

    await signUp(page, locale, { name: 'Workspace Owner', email: owner });

    // §7.1: signup leads straight to naming the company. No configuration step.
    await expect(page).toHaveURL(new RegExp(`/${locale}/new-workspace$`));

    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);

    // §7.1: "slug auto-derived and editable". Derived on the client from the
    // same pure function the server validates with.
    const slugField = page.getByLabel(/workspace address|អាសយដ្ឋានកន្លែងធ្វើការ/i);
    await expect(slugField).toHaveValue(company.toLowerCase());

    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

    // Straight into the invite step, which is skippable and whose Skip is
    // visually equal to Send (§7.1).
    await expect(page).toHaveURL(new RegExp(`/${locale}/${company.toLowerCase()}/invite$`));
    // Matched on the whole label: slice 16 put a "Skip to content" link first in
    // every document (§11's keyboard baseline), and a bare /skip/ now finds two.
    await expect(page.getByRole('link', { name: /skip for now|រំលងសិន/i })).toBeVisible();

    // --- the bulk half ------------------------------------------------------
    // Ten addresses, one malformed, one duplicate — because that is what a
    // pasted spreadsheet column actually contains.
    const invitees = Array.from(
      { length: 10 },
      (_, i) => `${unique(`invitee${i}`, testInfo)}@example.com`,
    );
    const pasted = [...invitees, 'not-an-email', invitees[0]].join('\n');

    await page.getByLabel(/email addresses|អាសយដ្ឋានអ៊ីមែល/i).fill(pasted);

    // §7.10: each address becomes a chip, and the malformed one is flagged in
    // place rather than failing the batch.
    //
    // Scoped to the chip list. The textarea still holds the pasted text — that
    // is the design, so the entry can be corrected rather than silently
    // dropped — which means an unscoped text match finds it twice.
    const chips = page.getByRole('listitem');
    await expect(chips.filter({ hasText: 'not-an-email' })).toHaveCount(1);
    for (const email of invitees.slice(0, 3)) {
      await expect(chips.filter({ hasText: email })).toHaveCount(1);
    }

    await page.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i }).click();

    // Scoped to the form: the unverified-email banner is also a `status`, and
    // matching both would fail on strictness rather than on the product.
    //
    // Ten sent, not eleven and not twelve — the duplicate was collapsed and the
    // malformed entry was never a recipient.
    await expect(page.locator('form').getByRole('status')).toContainText('10');

    // Every one of them really was sent. The mailbox is the development
    // transport's own record, written by the same code path production uses.
    for (const email of invitees) {
      await waitForMail(email);
    }
  });

  test('an invited person signs up from the link and lands in the same workspace', async ({
    browser,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const owner = `${unique('host', testInfo)}@example.com`;
    const invitee = `${unique('guest', testInfo)}@example.com`;
    const company = unique('Borey', testInfo);
    const slug = company.toLowerCase();

    // --- the owner ----------------------------------------------------------
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await signUp(ownerPage, locale, { name: 'Company Owner', email: owner });
    await ownerPage.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await ownerPage.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

    await ownerPage.getByLabel(/email addresses|អាសយដ្ឋានអ៊ីមែល/i).fill(invitee);
    await ownerPage.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i }).click();
    await expect(ownerPage.locator('form').getByRole('status')).toBeVisible();

    const token = inviteTokenFrom(await waitForMail(invitee));

    // --- the invitee, in a browser that has never seen this product ----------
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();

    await inviteePage.goto(`/${locale}/invite/${token}`);
    await expect(inviteePage.getByRole('heading', { level: 1 })).toContainText(company);

    await signUp(inviteePage, locale, { name: 'Invited Person', email: invitee }, { invite: token });

    /**
     * §7.10: "lands directly in the workspace, in the right teams, **on My
     * Work**" — not in onboarding, and not in a company of their own.
     *
     * The heading is My Work rather than the company name from slice 13 on, and
     * that is §7.3 being kept rather than a regression: "Open app → lands on MY
     * WORK (never a project list)." The company is still named, in the shell's
     * header link, which is where it belongs on every screen instead of only on
     * this one.
     */
    await expect(inviteePage).toHaveURL(new RegExp(`/${locale}/${slug}$`));
    await expect(inviteePage.getByRole('banner').getByRole('link', { name: company })).toBeVisible();
    await expect(inviteePage.getByRole('heading', { level: 1 })).toHaveText(
      /my work|ការងាររបស់ខ្ញុំ/i,
    );

    /**
     * Both people, one workspace — the sentence §14 asks for.
     *
     * Asserted from the **owner's** members screen below rather than from the
     * invitee's landing page, which since slice 13 is My Work and lists work
     * rather than people (§7.3: "never a project list", and never a directory
     * either). §7.4's workload would show one column per member, but this test
     * creates no project, so its scope is legitimately empty — the invitee-side
     * proof here is that the workspace resolved at all, which is what the two
     * assertions above establish. RLS makes a 404 the alternative (§15).
     */

    // And the owner's members screen agrees.
    await ownerPage.goto(`/${locale}/${slug}/settings/members`);
    await expect(ownerPage.getByRole('cell', { name: invitee })).toBeVisible();
    await expect(ownerPage.getByRole('cell', { name: owner })).toBeVisible();

    await ownerContext.close();
    await inviteeContext.close();
  });

  test('another company cannot be reached by pasting its URL', async ({ page }, testInfo) => {
    // §15's manual check #2, automated. RLS returns zero rows and the layout
    // turns that into a 404 — not an empty page, and not a page that says the
    // workspace exists.
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const outsider = `${unique('outsider', testInfo)}@example.com`;
    const company = unique('Outsider', testInfo);

    await signUp(page, locale, { name: 'Outsider', email: outsider });
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${company.toLowerCase()}/invite$`));

    const response = await page.goto(`/${locale}/some-other-company`);
    expect(response?.status()).toBe(404);
  });

  test('the whole flow stays free of Khmer numerals', async ({ page }, testInfo) => {
    // §13 pins Latin digits for both locales. The signup path is where a
    // formatted number first reaches a user, so it is where a missing
    // numberingSystem would first show.
    test.skip(!testInfo.project.name.includes('km'), 'Khmer projects only');

    const email = `${unique('digits', testInfo)}@example.com`;
    await signUp(page, 'km', { name: 'អ្នកប្រើ', email });

    // The Khmer name carries a unique suffix because the projects share one
    // database and the form submits the slug it derived. Two companies with the
    // same name is a real collision the product reports on the field — correct
    // behaviour, and not what this test is about.
    await page.getByLabel(/ឈ្មោះក្រុមហ៊ុន/).fill(`ក្រុមហ៊ុន សាកល្បង ${unique('km', testInfo)}`);
    await page.getByRole('button', { name: /បង្កើតក្រុមហ៊ុន/ }).click();

    await page.getByLabel(/អាសយដ្ឋានអ៊ីមែល/).fill('a@example.com\nb@example.com');

    await expect(page.locator('body')).not.toContainText(/[០-៩]/);
  });
});
