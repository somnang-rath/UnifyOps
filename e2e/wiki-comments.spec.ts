import { expect, test, type Page } from '@playwright/test';
import { inviteTokenFrom, waitForMail } from './support/mailbox';

/**
 * §21.13's demonstrable outcome for slice 21, in a browser:
 *
 *   "Ask a question on the onboarding page, mention its owner, have it reach
 *   their inbox under the preference they already set, and have them answer in
 *   the thread."
 *
 * All four are here, and the fourth is the one worth having: **the answer**. A
 * comment box that only notifies the person who was named is a suggestion box,
 * and §21.6's whole argument for a thread is that the person who found the page
 * wrong is usually not the person who can fix it. So the second half of the
 * first test is the owner replying and the asker seeing it.
 *
 * The **inbox** assertion is doing more work than it looks. Until this slice the
 * worker dropped every notification whose subject was not a work item — a
 * slice-18 defect that `loadContext`'s inner join caused and nothing caught,
 * because a page *mention* is written by `saveWikiPage` and read by nobody in
 * the e2e suite. A page comment is the first thing in the product that makes it
 * visible, and this is the assertion that would have.
 *
 * §21.14's check 5 — "a Guest on one project can comment on that space's pages,
 * cannot write one, and cannot see the company space at all" — is the second
 * test, and it is §21.13's stated definition of done for this slice.
 *
 * The database half is `__tenancy__/page-comments.test.ts`, which pins what only
 * Postgres can say: the subject CHECKs, the cascade, and the author link.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e7).toString(36)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/*
 * Labels are matched at their **start**, never end-anchored — §12's field shell
 * appends a required marker, so the label reads `Title*` while the accessible
 * name is `Title` and a `$` matches nothing. Recorded four times now (password
 * reset, slice 18, slice 19, slice 20).
 */

/**
 * Sign up, optionally against an invitation token.
 *
 * The invitation is exchanged on the **sign-up form**, not on `/invite/<token>`
 * -- that route is the landing page an invited person is sent to, and it names
 * the company rather than asking for a password. `membership.spec.ts` and
 * `notifications.spec.ts` both take this path; this file learned it the way they
 * did, by timing out on a form that was never there.
 */
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

async function newWorkspace(
  page: Page,
  locale: string,
  company: string,
  email: string,
  name = 'Handbook Owner',
): Promise<string> {
  await signUp(page, locale, { name, email });

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
  return slug;
}

/**
 * A space's URL, read off the space list rather than guessed.
 *
 * A space slug is derived at signup (the company one) or from the project's name
 * (a project one), so neither is safe to construct: slice 18 recorded the same
 * lesson when a test assumed `ENG-1`. The link is matched by its `href` shape
 * rather than by position, because the space list also carries the shell's own
 * navigation and `.first()` would find whichever the layout happened to render
 * first -- slice 20's scar, where `.first()` matched the sidebar instead of the
 * body.
 */
async function openSpace(
  page: Page,
  locale: string,
  slug: string,
  name?: RegExp,
): Promise<string> {
  await page.goto(`/${locale}/${slug}/wiki`);

  const spaces = page.locator('main').locator(`a[href^="/${locale}/${slug}/wiki/"]`);
  const link = name ? spaces.filter({ hasText: name }).first() : spaces.first();

  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/wiki/[^/]+$`));
  return new URL(page.url()).pathname;
}

/** A page, written through the real create form. Returns its URL. */
async function writePage(page: Page, spaceUrl: string, title: string): Promise<string> {
  await page.goto(`${spaceUrl}/new`);
  await page.getByLabel(/^title|^ចំណងជើង/i).fill(title);
  await page.getByRole('button', { name: /create|បង្កើត/i }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  return new URL(page.url()).pathname;
}

/**
 * Post one comment and wait for it to land.
 *
 * The wait is on the **box clearing**, which the composer only does on a *new*
 * `postedAt` — so it is a signal the server produced rather than a control
 * closing on submit. That distinction is slice 20's scar, recorded in the wiki
 * spec: "a control closing is a client event; only something that requires the
 * server's new answer is proof of a commit."
 */
async function postComment(page: Page, body: string): Promise<void> {
  const box = page.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);
  await box.fill(body);
  await page.getByRole('button', { name: /^(post|ផ្សាយ)$/i }).click();
  await expect(box).toHaveValue('');
}

test.describe('comments on a page', () => {
  test('a question, a mention that reaches the inbox, and an answer in the thread', async ({
    browser,
  }, testInfo) => {
    /**
     * Longer than the 30s default, for `notifications.spec.ts`'s reason: two
     * signups, an invitation round trip through the mailbox, a page, a comment
     * -- and then a wait on a **second process** picking the outbox row up on
     * its five-second sweep. That seam has a clock in it.
     */
    test.setTimeout(120_000);

    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('Handbook', testInfo);
    const ownerEmail = `${unique('owner', testInfo)}@example.com`;
    const askerEmail = `${unique('asker', testInfo)}@example.com`;

    // --- the owner, who writes the page -------------------------------------
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const slug = await newWorkspace(ownerPage, locale, company, ownerEmail, 'Policy Owner');

    // Invited from the onboarding step this redirect already landed on.
    await ownerPage.getByLabel(/email addresses|អាសយដ្ឋានអ៊ីមែល/i).fill(askerEmail);
    await ownerPage.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i }).click();
    await expect(ownerPage.locator('form').getByRole('status')).toBeVisible();

    const token = inviteTokenFrom(await waitForMail(askerEmail));

    const spaceUrl = await openSpace(ownerPage, locale, slug);
    const pageUrl = await writePage(ownerPage, spaceUrl, 'Onboarding');

    // --- the new hire, who finds it wrong -----------------------------------
    const askerContext = await browser.newContext();
    const askerPage = await askerContext.newPage();

    await signUp(askerPage, locale, { name: 'New Hire', email: askerEmail }, { invite: token });
    await expect(askerPage).toHaveURL(new RegExp(`/${locale}/${slug}$`));

    await askerPage.goto(pageUrl);

    /*
     * The `@` picker, driven the way a person drives it: type the trigger, then
     * enough of a name to narrow it, then Enter. The stored body holds a member
     * id and never a name (§13), which is precisely why the assertion below is
     * on the *rendered* chip rather than on what was typed.
     */
    const box = askerPage.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);
    await box.fill('Is this still the current process? @Policy');
    await expect(askerPage.getByRole('option', { name: 'Policy Owner' })).toBeVisible();
    await box.press('Enter');

    await askerPage.getByRole('button', { name: /^(post|ផ្សាយ)$/i }).click();
    await expect(box).toHaveValue('');

    const thread = askerPage.getByRole('list').filter({ hasText: 'Is this still the current' });
    await expect(thread).toContainText('@Policy Owner');

    // --- the owner's inbox --------------------------------------------------
    /*
     * §21.13: "have it reach their inbox under the preference they already set."
     * `mention` is on by default (§6-6), so nobody configured anything — which is
     * the point of the sentence.
     *
     * The worker is a real second process and `serve.ts` runs one; the sweep is
     * every five seconds, so this is the one assertion in the file that has to
     * wait on something outside the browser. Playwright's own retry is the wait.
     */
    await expect(async () => {
      await ownerPage.goto(`/${locale}/${slug}/inbox`);
      await expect(ownerPage.locator('main')).toContainText('Onboarding');
    }).toPass({ timeout: 30_000 });

    /*
     * Never a raw key, and the namespace is matched loosely on purpose.
     *
     * The first version of this line looked for `notification.` and the key that
     * was actually missing was `inbox.subject.page` — a page subject had never
     * been *rendered* in an inbox before this slice, because the worker dropped
     * every one of them, so the string had never been needed. next-intl swallows
     * a `MISSING_MESSAGE` into the server log and `messages.test.ts` stays green
     * on parity when a key is absent from *both* catalogues: slice 10's `soon`
     * defect and slice 13's `due` grouping, for the third time.
     */
    await expect(ownerPage.locator('main')).not.toHaveText(/(inbox|notification)\.[a-z]/i);

    // The click lands on the comment, not merely on the page (§7.8). The anchor
    // did not exist before slice 21 — every `#comment-…` deep link the product
    // has ever sent pointed at nothing.
    await ownerPage.locator('main').getByRole('link').filter({ hasText: 'Onboarding' }).first().click();
    await expect(ownerPage).toHaveURL(/#comment-/);

    // --- the answer ---------------------------------------------------------
    await postComment(ownerPage, 'It changed in March. I will update it today.');

    await askerPage.reload();
    await expect(askerPage.locator('main')).toContainText('It changed in March');
  });

  test('a Guest can comment on a project space and cannot write in it (§21.14-5)', async ({
    browser,
  }, testInfo) => {
    // Two signups, an invitation, a project, a space, a page and a role change.
    test.setTimeout(120_000);

    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('Contract', testInfo);
    const ownerEmail = `${unique('lead', testInfo)}@example.com`;
    const guestEmail = `${unique('contractor', testInfo)}@example.com`;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const slug = await newWorkspace(ownerPage, locale, company, ownerEmail);

    await ownerPage.getByLabel(/email addresses|អាសយដ្ឋានអ៊ីមែល/i).fill(guestEmail);
    await ownerPage.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i }).click();
    await expect(ownerPage.locator('form').getByRole('status')).toBeVisible();

    const token = inviteTokenFrom(await waitForMail(guestEmail));

    // A **workspace-visible** project, so the Guest's access comes from an
    // explicit project membership rather than from the visibility §10 grants
    // Members — which is the whole point of a Guest seat (§10's "Guests get
    // nothing implicitly").
    await ownerPage.goto(`/${locale}/${slug}/projects/new`);
    await ownerPage.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Field Ops');
    await ownerPage.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/field-ops[?]view=board&new=1$`),
    );

    // The project's own space, and a page in it for the Guest to comment on.
    const spaceUrl = await openSpace(ownerPage, locale, slug, /field ops/i);
    const pageUrl = await writePage(ownerPage, spaceUrl, 'Runbook');

    // --- the contractor joins, and is made a Guest --------------------------
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    await signUp(guestPage, locale, { name: 'Contractor', email: guestEmail }, { invite: token });
    await expect(guestPage).toHaveURL(new RegExp(`/${locale}/${slug}$`));

    // Added to the project *first*: demoting to Guest strips every implicit
    // role, so the order matters — the other way round the owner would be
    // adding somebody who can no longer be found in the picker's list.
    await ownerPage.goto(`/${locale}/${slug}/projects/field-ops/settings`);
    /*
     * Named by its `name` attribute rather than by its label, and deliberately.
     * The add form's two selects are labelled "Name" and "Role", and every member
     * row above them carries a "Role" select of its own — so a label match is
     * ambiguous by one and `.first()` would resolve it by document order, which
     * is the shape slice 15 recorded for the accent picker and slice 19 for the
     * owner picker: an assertion a control beside the thing can satisfy.
     */
    const addMember = ownerPage.locator('form').filter({
      has: ownerPage.locator('select[name="memberId"]'),
    });

    await addMember.locator('select[name="memberId"]').selectOption({ label: 'Contractor' });
    await addMember.getByRole('button').click();

    /*
     * The membership **row**, not the page's text.
     *
     * `expect(main).toContainText('Contractor')` passes whether or not the add
     * succeeded, because the picker's own `<option>` carries that name -- the
     * exact trap slice 15 recorded for the accent picker and slice 19 for the
     * owner picker, walked into a third time while writing this test. The
     * membership list is a `<ul>`, and the picker is a `<select>`, so a listitem
     * filter can only be satisfied by a row that actually exists.
     */
    await expect(
      ownerPage.getByRole('listitem').filter({ hasText: 'Contractor' }),
    ).toBeVisible();

    await ownerPage.goto(`/${locale}/${slug}/settings/members`);
    /*
     * The row is found by its **email cell**, exact-matched, rather than by a
     * substring of the whole row. A name substring matched two rows: the member's
     * own and the availability row that renders under it, and Playwright then
     * resolved the role select across both. The address is the one cell in the
     * table guaranteed unique.
     */
    const row = ownerPage
      .getByRole('row')
      .filter({ has: ownerPage.getByRole('cell', { name: guestEmail, exact: true }) });

    const roleSelect = row.locator('select[name="role"]');
    await roleSelect.selectOption('guest');
    await expect(roleSelect).toHaveValue('guest');

    // --- what a Guest may do ------------------------------------------------
    await guestPage.goto(pageUrl);
    await expect(guestPage.getByRole('heading', { name: 'Runbook' })).toBeVisible();

    /*
     * §21.6: "anyone who can read the space may comment in it, which for a
     * project space includes a Guest who can see the project — deliberately,
     * because the whole value of a comment on documentation comes from the
     * person who found it wrong, and that is disproportionately the newest
     * person in the room."
     */
    await postComment(guestPage, 'Step 4 refers to a server we decommissioned.');
    await expect(guestPage.locator('main')).toContainText('decommissioned');

    /*
     * And what they may not. §20.5's write row caps a Guest out, which is the
     * one line §20.0 and §21.16 both say should be confirmed against the plan's
     * prose before a pilot — so it is asserted rather than assumed, and a
     * reversal has to come here and change this test on purpose.
     *
     * The control is *absent*, not disabled: a disabled Edit invites somebody to
     * go looking for the permission that would enable it.
     */
    await expect(guestPage.getByRole('link', { name: /^edit|^កែសម្រួល/i })).toHaveCount(0);

    /*
     * The route itself, not only the link — a hidden control is not a permission.
     *
     * The editor **redirects a reader back to the page** rather than 404ing, and
     * that is deliberate: `edit/page.tsx` says so in as many words, "`notFound()`
     * would be wrong here: the page exists and they can see it." So what is
     * asserted is where they ended up, and that the editor's own controls are
     * not on screen — a positive claim about the reader rather than an absence
     * on a page that might simply not have arrived (slice 16's rule, learned
     * again here when the previous form of this assertion left the following
     * `goto` racing a render and failing with `net::ERR_ABORTED`).
     */
    await guestPage.goto(`${pageUrl}/edit`);
    await expect(guestPage).toHaveURL(new RegExp(`${pageUrl}$`));
    await expect(guestPage.getByRole('button', { name: /^save|^រក្សាទុក/i })).toHaveCount(0);

    /*
     * "…and cannot see the company space at all." §20.5 draws that line at §10's
     * *See workspace-visible projects*, which a Guest does not have — so the
     * company space is not in their list rather than being in it and refusing.
     */
    await guestPage.goto(`/${locale}/${slug}/wiki`);
    await expect(guestPage.locator('main')).not.toContainText(company);
  });
});
