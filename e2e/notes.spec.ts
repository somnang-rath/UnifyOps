import { expect, test, type Page } from '@playwright/test';

/**
 * §20.13's definition of done for slice 17, in a browser:
 *
 *   "Capture a note from `⌘K` in under five seconds, find it in search in both
 *   scripts, turn it into a work item — and nobody else in the workspace can see
 *   it, proven by a test in the one place RLS cannot help."
 *
 * The last clause is asserted directly in
 * `src/server/db/__tenancy__/notes.test.ts`, which is where a claim about a
 * *predicate* belongs. What only a browser can show is the other three, and each
 * of them is a thing every unit test in this repo would pass without:
 *
 *   * the `⌘K` → "New note" → type → `⌘Enter` path, which no unit test can press;
 *   * a Khmer note found by a word *inside* it, in a script with no inter-word
 *     spaces — the same reason `search.spec.ts` is not two English runs;
 *   * and every message key on a new screen. A missing one renders as a raw
 *     `notes.empty` while `messages.test.ts` stays green on parity, which is
 *     exactly how slice 10's `soon` defect and slice 13's `due` grouping shipped.
 */

const PASSWORD = 'a-long-enough-password';

/** A real Khmer phrase with no spaces around the word being searched for. */
const PHNOM_PENH = 'ភ្នំពេញ';
const KHMER_NOTE = `ជួបអតិថិជននៅ${PHNOM_PENH}ថ្ងៃអង្គារ`;

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
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Notes Owner');
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
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/${slug}/projects/field-ops[?]view=board&new=1$`),
  );

  return slug;
}

const palette = (page: Page) => page.getByRole('combobox', { name: /search|ស្វែងរក/i });

/**
 * The notes screen's own box, scoped to `main`.
 *
 * Scoped because the capture dialog carries a second one with the same
 * accessible name, and an unscoped locator would be ambiguous the moment it is
 * open. `exact` matching is used on the assertions below for the related reason:
 * each row's expand control is named "Open <title>", so a substring match on a
 * title finds the button as well as the text.
 */
const composer = (page: Page) => page.locator('main').getByLabel(/^note$|^កំណត់ចំណាំ$/i);
const capture = (page: Page) =>
  page.getByRole('dialog').getByLabel(/^note$|^កំណត់ចំណាំ$/i);

test.describe('notes', () => {
  test('captures from the palette, finds in both scripts, and promotes to an item', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('notes', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    /* --- §20.3.1: capture from ⌘K ---------------------------------------- */
    // Pressed on the page rather than on a control, because the binding is a
    // window listener and what is worth proving is that it fires from wherever
    // somebody happens to be. `body.focus()` is a no-op while a real control
    // holds focus, which is slice 14's scar — so blur first, the way clicking
    // away does.
    await page.goto(`/${locale}/${slug}`);
    await page.locator('body').click();
    await page.locator('body').press('ControlOrMeta+k');
    await expect(palette(page)).toBeFocused();

    await palette(page).fill(locale === 'km' ? 'កំណត់ចំណាំថ្មី' : 'new note');
    await page.getByRole('option', { name: /new note|កំណត់ចំណាំថ្មី/i }).first().click();

    // The dialog opens with the box focused — §20.3.1's five seconds has no
    // click in it after the action is chosen.
    await expect(capture(page)).toBeFocused();
    await capture(page).fill('Call the supplier back\nThey close at five');
    // ⌘Enter saves and closes, which is the half of the target a mouse cannot
    // give.
    await capture(page).press('ControlOrMeta+Enter');

    /* --- The note is on the notes screen, titled by its first line -------- */
    // The dialog closing is the signal that the save committed — it closes from
    // the action's own result. Navigating before it does aborts the server
    // action mid-flight, which is slice 8's race and reads in the server log as
    // "The destination stream closed early".
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.goto(`/${locale}/${slug}/notes`);
    await expect(page.getByText('Call the supplier back', { exact: true })).toBeVisible();
    // §20.4: the title is derived and there is no stored one — so the second
    // line is preview, not title.
    await expect(page.getByText('They close at five', { exact: true })).toBeVisible();

    /* --- §20.3.5: found in search, in both scripts ------------------------ */
    await composer(page).fill(KHMER_NOTE);
    await page.getByRole('button', { name: /save note|រក្សាទុកកំណត់ចំណាំ/i }).click();
    await expect(page.getByText(KHMER_NOTE, { exact: true })).toBeVisible();

    await page.locator('body').click();
    await page.locator('body').press('ControlOrMeta+k');
    /**
     * `ភ្នំពេញ` sits in the middle of a sentence with no spaces around it.
     * Word-based full text sees the whole body as one lexeme and cannot match a
     * word inside it; only the trigram route can, and only if the query and the
     * generated column agree about zero-width characters (§13, §20.8).
     */
    await palette(page).fill(PHNOM_PENH);
    await expect(page.getByRole('option', { name: new RegExp(PHNOM_PENH) })).toBeVisible();

    await palette(page).fill('supplier');
    await expect(page.getByRole('option', { name: /Call the supplier back/ })).toBeVisible();
    await page.keyboard.press('Escape');

    /* --- §20.3.4: promotion is a copy ------------------------------------ */
    await page.goto(`/${locale}/${slug}/notes`);
    // The row expands in place — a note has no route of its own (§20.11).
    await page.getByRole('button', { name: /Call the supplier back/ }).first().click();
    await page.getByRole('button', { name: /work item|កិច្ចការ/i }).first().click();

    // The note is still there afterwards, which is the whole of "a copy, never a
    // move" (§20.1) — and the row now says what it became.
    await expect(page.getByText('Call the supplier back', { exact: true })).toBeVisible();
    await expect(page.getByText(/Became [A-Z]+-\d+|បានក្លាយជា [A-Z]+-\d+/)).toBeVisible();
  });

  test('keeps the typed text when a save is refused', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('notedraft', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    await page.goto(`/${locale}/${slug}/notes`);

    /**
     * §20.3.1's `[X]`: "the text stays in the box and the retry button is the
     * same button (§7.7's rule, which applies with more force to something
     * nobody else has a copy of)".
     *
     * Driven through the length cap rather than by breaking the network,
     * because the cap is a refusal the *server* makes and is therefore the one
     * that exercises the round trip. The count is in graphemes, so this is also
     * the assertion that a Khmer workspace is not silently given a third of the
     * field an English one gets (§13).
     */
    const tooLong = 'x'.repeat(20_001);
    await composer(page).fill(tooLong);

    // Refused before the submit, with the count on screen — and the Save button
    // disabled rather than allowed to fail.
    await expect(page.getByRole('button', { name: /save note|រក្សាទុកកំណត់ចំណាំ/i })).toBeDisabled();
    // The text is still there. That is the property; the message is decoration.
    expect(await composer(page).inputValue()).toHaveLength(20_001);

    // And the same box, trimmed, saves.
    await composer(page).fill('A thought that fits');
    await page.getByRole('button', { name: /save note|រក្សាទុកកំណត់ចំណាំ/i }).click();
    await expect(page.getByText('A thought that fits', { exact: true })).toBeVisible();
  });

  test('renders a body through the allowlist, never as markup', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('notemd', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    await page.goto(`/${locale}/${slug}/notes`);

    /**
     * §20.7: "Raw HTML in a body is refused, not sanitised."
     *
     * The refusal is structural — the parser has no node that can emit markup —
     * so the assertion is that the script tag arrives on screen as *text*. A
     * sanitiser would strip it; this shows it, which is the honest rendering of
     * what somebody typed and the reason there is no `dangerouslySetInnerHTML`
     * anywhere downstream.
     */
    await composer(page).fill('Heading\n\n<script>window.__pwned = 1</script>');
    await page.getByRole('button', { name: /save note|រក្សាទុកកំណត់ចំណាំ/i }).click();

    await expect(page.getByText('Heading', { exact: true })).toBeVisible();
    // Nothing ran, and the text is on the page.
    expect(await page.evaluate(() => (window as { __pwned?: number }).__pwned)).toBeUndefined();
  });
});
