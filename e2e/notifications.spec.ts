import { expect, test, type Page } from '@playwright/test';
import { inviteTokenFrom, waitForMail } from './support/mailbox';

/**
 * §14's definition of done for slice 9:
 *
 *   "Mention someone → inbox entry + email; the evening job sends one digest
 *    listing tomorrow's due items."
 *
 * The first half is here, driven through two real browsers and a **real job
 * worker** — `e2e/support/serve.ts` starts one beside Next, because that is how
 * it is deployed and because half of §7.8 lives in it. Nothing about this spec
 * reaches into the queue: it posts a comment as one person and waits for the
 * bell to move for another, which is the only claim the product actually makes.
 *
 * The second half is a job on a clock in a timezone, which no browser can
 * drive; it is tested against a real Postgres in
 * `src/server/db/__tenancy__/digest.test.ts`.
 *
 * The part worth a browser is the seam between two processes. Every unit test
 * here passes with the outbox row written and nothing ever reading it — an
 * inbox that stays empty is exactly what that failure looks like, and only this
 * catches it.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  // Enough entropy that three parallel projects cannot collide on an email
  // address, built without slicing a string — the design-token hook reads any
  // `.slice` as possible user text, and it is right to be noisy about that.
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_679_616).toString(36)}`;
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
  await page.getByLabel(/name|ឈ្មោះ/i).fill(account.name);
  await page.getByLabel(/email|អ៊ីមែល/i).fill(account.email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
}

test.describe('notifications', () => {
  test('a mention reaches the inbox and the mailbox of the person named', async ({
    browser,
  }, testInfo) => {
    /**
     * Longer than the 30s default, and legitimately so: this is two signups, an
     * invitation round trip through the mailbox, a project, an item, a comment,
     * and then a wait on a **second process** picking the outbox row up on its
     * five-second sweep. Every other spec in this suite drives one browser
     * against one server; this one is the seam between the two process types
     * §8 deploys, and that seam has a clock in it.
     */
    test.setTimeout(120_000);

    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const ownerEmail = `${unique('lead', testInfo)}@example.com`;
    const guestEmail = `${unique('dev', testInfo)}@example.com`;
    const company = unique('Notify', testInfo);
    const slug = company.toLowerCase();
    const GUEST = 'Sophea Chan';

    // --- the lead sets up a company and invites a colleague -------------------
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await signUp(ownerPage, locale, { name: 'Team Lead', email: ownerEmail });
    await ownerPage.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await ownerPage.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();
    await expect(ownerPage).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

    await ownerPage.getByLabel(/email addresses|អាសយដ្ឋានអ៊ីមែល/i).fill(guestEmail);
    await ownerPage.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i }).click();
    await expect(ownerPage.locator('form').getByRole('status')).toBeVisible();

    const token = inviteTokenFrom(await waitForMail(guestEmail));

    // --- the colleague joins --------------------------------------------------
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    await signUp(guestPage, locale, { name: GUEST, email: guestEmail }, { invite: token });
    await expect(guestPage).toHaveURL(new RegExp(`/${locale}/${slug}$`));

    // Nothing has happened yet, so the empty state is §7.8's own sentence — and
    // it is the "empty is good news" case, not a shrug.
    await guestPage.goto(`/${locale}/${slug}/inbox`);
    await expect(guestPage.getByText(/all caught up|អានអស់ហើយ/i)).toBeVisible();

    // --- the lead writes a comment naming them --------------------------------
    await ownerPage.goto(`/${locale}/${slug}/projects/new`);
    await ownerPage.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Field Ops');
    await ownerPage.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/field-ops[?]view=board&new=1$`),
    );
    await ownerPage.goto(`/${locale}/${slug}/projects/field-ops`);

    const addTask = ownerPage.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill('Check the generator');
    await addTask.press('Enter');
    await expect(ownerPage.getByRole('link', { name: 'Check the generator' })).toBeVisible();

    await ownerPage.goto(`/${locale}/${slug}/projects/field-ops/1`);

    const box = ownerPage.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);
    await box.click();
    await box.pressSequentially('Can you look at this ');
    await box.pressSequentially('@');

    const picker = ownerPage.getByRole('listbox');
    await expect(picker).toBeVisible();
    // Narrow the picker to the colleague rather than trusting the order of a
    // two-person list.
    await box.pressSequentially('Sophea');
    await expect(picker).toContainText(GUEST);
    await box.press('Enter');

    await ownerPage.getByRole('button', { name: /^(post|ផ្សាយ)$/i }).click();
    await expect(ownerPage.getByRole('region', { name: /^(comments|មតិយោបល់)$/i })).toContainText(
      `@${GUEST}`,
    );

    // --- and it arrives, in both places §7.8 promises --------------------------
    //
    // The bell is rendered by the workspace shell, so any screen shows it. The
    // reload loop is the honest wait: an outbox row is picked up by the worker's
    // sweep, so "a moment later" is part of the design rather than a flake.
    await expect(async () => {
      await guestPage.goto(`/${locale}/${slug}/inbox`);
      await expect(
        guestPage.getByRole('link', { name: /inbox, 1 unread|ប្រអប់សារ មិនទាន់អាន 1/i }),
      ).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 40_000 });

    const entry = guestPage.getByRole('list').filter({ hasText: 'Check the generator' });
    await expect(entry).toContainText('Team Lead');

    // Nothing here is a message key that escaped a catalogue (§15-4).
    await expect(guestPage.locator('main')).not.toContainText('inbox.');

    // The email half. `mention` is on by default in both channels, because
    // being named is somebody asking for you specifically (§7.8).
    //
    // Matched on the actor's name rather than on a subject line: this mailbox
    // already holds an invitation and a verification message for the same
    // address, and the subject itself is translated (§13), so the name is the
    // one part that identifies this message in both locales.
    const mail = await waitForMail(guestEmail, {
      subjectContains: 'Team Lead',
      timeoutMs: 30_000,
    });
    // §7.8: the link lands on the comment, not merely on the item.
    expect(mail.text).toMatch(/#comment-[0-9a-f-]{36}/);

    // --- marking read moves the badge, and "all read" acts on everything ------
    await guestPage.getByRole('button', { name: /mark all read|សម្គាល់ថាអានទាំងអស់/i }).click();
    await expect(
      guestPage.getByRole('link', { name: /inbox, nothing unread|ប្រអប់សារ គ្មានសារ/i }),
    ).toBeVisible();

    await ownerContext.close();
    await guestContext.close();
  });

  test('nobody is notified about their own action (§7.8)', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const email = `${unique('solo', testInfo)}@example.com`;
    const company = unique('Alone', testInfo);
    const slug = company.toLowerCase();

    await signUp(page, locale, { name: 'Only Person', email });
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Solo');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();

    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill('Something for myself');
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: 'Something for myself' })).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/solo/1`);

    // Mentioning yourself is the sharpest version of the rule: the registry
    // names you, and `UnitOfWork.flush` takes you back out again.
    const box = page.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);
    await box.click();
    await box.pressSequentially('@');
    await expect(page.getByRole('listbox')).toBeVisible();
    await box.press('Enter');
    await box.pressSequentially(' noting this for later');
    await page.getByRole('button', { name: /^(post|ផ្សាយ)$/i }).click();

    await expect(page.getByRole('region', { name: /^(comments|មតិយោបល់)$/i })).toContainText(
      'noting this for later',
    );

    // Give the worker more than one sweep to get it wrong.
    await page.waitForTimeout(8_000);
    await page.goto(`/${locale}/${slug}/inbox`);

    await expect(page.getByText(/all caught up|អានអស់ហើយ/i)).toBeVisible();
  });

  test('the preference screen saves a choice and keeps it', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const email = `${unique('prefs', testInfo)}@example.com`;
    const company = unique('Prefs', testInfo);
    const slug = company.toLowerCase();

    await signUp(page, locale, { name: 'Settings Person', email });
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

    // Wait for the redirect before navigating away. A `goto` here can abort the
    // server action mid-flight — the race slice 8 found in two other specs,
    // which shows up as a 404 on the next page because the workspace the URL
    // names was never committed.
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

    await page.goto(`/${locale}/${slug}/settings/notifications`);

    // §7.8: "One switch in per-user preferences turns it off." The digest row
    // has an email box and no inbox box, which is the schema's `CHANNELS` rule
    // reaching the screen.
    const digestEmail = page.getByRole('checkbox', {
      name: /(evening due-date reminder|ការរំលឹកពេលល្ងាច).*(email|អ៊ីមែល)/i,
    });
    await expect(digestEmail).toBeChecked();

    // The save is optimistic and, by §11, silent on success — the checkbox
    // itself is the feedback. So the test waits for the action's own response
    // rather than for a message that deliberately does not exist; reloading
    // before it lands would assert against the state that was never saved.
    await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.status() < 400,
      ),
      digestEmail.uncheck(),
    ]);

    // Reloaded, not merely re-rendered: the round trip is the thing under test.
    await page.reload();
    await expect(
      page.getByRole('checkbox', {
        name: /(evening due-date reminder|ការរំលឹកពេលល្ងាច).*(email|អ៊ីមែល)/i,
      }),
    ).not.toBeChecked();

    await expect(page.locator('main')).not.toContainText('notificationSettings.');
  });
});
