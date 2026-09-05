import { expect, test, type Page } from '@playwright/test';

/**
 * §21.13's demonstrable outcome for slice 19, in a browser:
 *
 *   "Mark the leave policy verified for 180 days, see it turn amber a week
 *   before it lapses, receive it in Tuesday evening's digest, and find every
 *   unowned page in the company space in one filtered list."
 *
 * Two of those four are asserted against real Postgres instead, and
 * deliberately: the amber transition needs a clock a browser cannot move, and
 * the digest is a job on a timer in a timezone. `__tenancy__/wiki-verification
 * .test.ts` pins the first and `__tenancy__/digest.test.ts` the second — which
 * is what §21.13's definition of done asks for in as many words ("the digest
 * section is asserted in the worker's own test rather than only through the
 * UI").
 *
 * What only a browser can show is here:
 *
 *   1. Verifying is **one click** and the badge appears with its date (§21.3's
 *      `[S]`).
 *   2. **Editing a verified page clears the verification**, and the writer is
 *      told on the screen where it happened. §21.3: "without it the whole
 *      feature is decoration" — and a badge that survived the edit would look
 *      exactly like one that correctly persisted, which is why this needs an
 *      assertion rather than an inspection.
 *   3. The All-pages view filters to *owned by nobody* and the filter is a URL.
 *
 * And, as with every new screen since slice 13: **every message key**. A missing
 * one renders as a raw `wiki.verification.verify` while `messages.test.ts` stays
 * green on parity — exactly how slice 10's `soon` defect and slice 13's `due`
 * grouping shipped.
 */

const PASSWORD = 'a-long-enough-password';

/*
 * Labels are matched at their **start**, never end-anchored — §12's field shell
 * appends a required marker, so the label reads `Title*` while the accessible
 * name is `Title` and a `$` matches nothing. Recorded twice already (password
 * reset, then slice 18) and still worth restating where the next person looks.
 */

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e7).toString(36)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function newWorkspace(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<string> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Policy Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
  return slug;
}

/** The company space's URL, read off the space list rather than guessed. */
async function openCompanySpace(page: Page, locale: string, slug: string): Promise<string> {
  await page.goto(`/${locale}/${slug}/wiki`);

  const first = page.locator('main').getByRole('link').first();
  await expect(first).toBeVisible();
  await first.click();

  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/wiki/[^/]+$`));
  return new URL(page.url()).pathname;
}

/** A page, written through the real create form. */
async function writePage(page: Page, spaceUrl: string, title: string): Promise<void> {
  await page.goto(`${spaceUrl}/new`);
  await page.getByLabel(/^title|^ចំណងជើង/i).fill(title);
  await page.getByRole('button', { name: /create|បង្កើត/i }).click();

  // §20.3.2 lands the writer on the page it created. Waiting for the heading
  // rather than for the URL, because the slug is derived and this assertion is
  // about the page having been written, not about `slugify`.
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test.describe('page ownership and verification', () => {
  test('verifies a page in one click, and an edit clears it', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('verify', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);
    await writePage(page, spaceUrl, 'Leave policy');
    const pageUrl = new URL(page.url()).pathname;

    /* --- the starting state, which is not a fault ------------------------- */
    /*
     * §21.3's `[E]`: a page nobody has vouched for reads as "not reviewed",
     * which is "a true and actionable sentence rather than a fault". Asserted
     * because the alternative — colouring day one red — is the thing that
     * teaches people the badge means nothing.
     */
    await expect(page.getByText(/not reviewed|មិនទាន់ត្រួតពិនិត្យ/i)).toBeVisible();

    /* --- one click ------------------------------------------------------- */
    /*
     * §21.3's `[S]`: "verifying is one click and the badge appears with its
     * date." The period select is already set to the space's default, so the
     * only interaction is the button.
     */
    await page.getByRole('button', { name: /mark as accurate|បញ្ជាក់ថាត្រឹមត្រូវ/i }).click();

    await expect(page.getByText(/^verified|^បានផ្ទៀងផ្ទាត់/i).first()).toBeVisible();

    /*
     * Who and when, which is the whole content of the assertion (§21.3).
     *
     * Matched on the **sentence**, not on the name alone: the owner picker on
     * the same panel lists every member as an `<option>`, so a bare
     * `/Policy Owner/` is a strict-mode violation against three elements — and
     * one of the three would have matched whether or not the page was ever
     * verified, which is the assertion quietly not testing anything.
     */
    await expect(
      page.getByText(/by Policy Owner|ដោយ Policy Owner/).first(),
    ).toBeVisible();

    /* --- editing clears it ------------------------------------------------ */
    /*
     * §21.3's only automatic transition, and the one the feature stands on:
     * "a badge that survives the edit that invalidated it is worse than no
     * badge, because it is a false claim carrying the product's authority."
     */
    await page.goto(`${pageUrl}/edit`);
    await page.getByLabel(/^body|^content|^ខ្លឹមសារ/i).fill('The policy changed in March.');

    const save = page.getByRole('button', { name: /^save|^រក្សាទុក/i });
    await save.click();

    // The writer is told, on the screen where it happened (§21.3: "the writer
    // sees it happen and can re-verify in the same visit").
    await expect(page.getByText(/cleared its review|បានលុបការផ្ទៀងផ្ទាត់/i)).toBeVisible();

    /*
     * Navigate only once the mutation has landed — slice 8's race, still live
     * and recorded again by slice 18. The signal here is the save button
     * re-enabling, which is what `useActionState`'s pending flag drives.
     */
    await expect(save).toBeEnabled();
    await page.goto(pageUrl);

    // And the badge is genuinely gone from the stored row, not merely from the
    // optimistic render — which is what the reload proves.
    await expect(page.getByText(/not reviewed|មិនទាន់ត្រួតពិនិត្យ/i)).toBeVisible();
  });

  test('finds every unowned page in one filtered list', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('unowned', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);

    await writePage(page, spaceUrl, 'Expense rules');
    const ownedUrl = new URL(page.url()).pathname;

    await writePage(page, spaceUrl, 'Orphan notes');

    /* --- claim one of them ------------------------------------------------ */
    await page.goto(ownedUrl);

    // The owner picker offers "nobody" plus every live member; taking it on is
    // the one-click path §21.3 puts beside the select.
    const claim = page.getByRole('button', { name: /take this on|ទទួលយកទំព័រនេះ/i });
    await claim.click();
    await expect(claim).toBeHidden();

    /* --- the filtered list, which is a URL -------------------------------- */
    /*
     * §21.3 makes the All-pages view "one query over one space", and §5 makes a
     * view a URL somebody can paste. Navigated to directly rather than clicked,
     * because the URL being the whole of the state is the property being
     * asserted.
     */
    await page.goto(`${spaceUrl}/pages?filter=unowned`);

    await expect(page.getByRole('link', { name: 'Orphan notes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expense rules' })).toBeHidden();

    // And the unfiltered list still has both, so the filter is filtering rather
    // than the page being broken.
    await page.goto(`${spaceUrl}/pages`);
    await expect(page.getByRole('link', { name: 'Orphan notes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expense rules' })).toBeVisible();
  });
});
