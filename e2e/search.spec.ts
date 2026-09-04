import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 14:
 *
 *   "Command palette + search + shortcuts — `⌘K` finds anything, in both
 *   scripts."
 *
 * "In both scripts" is the phrase this spec exists for, and it is not satisfied
 * by running the same English query twice under two locales. Every unit test in
 * the repo passes with the Khmer route wired to the wrong column, and the
 * tenancy suite proves the SQL in isolation — what neither can show is that a
 * person typing Khmer into the palette on a Khmer screen reaches the item. So
 * both runs create an item with a **Khmer** title and search for a word inside
 * it, which in a script with no inter-word spaces is the case that only trigram
 * matching can answer.
 *
 * The other three things asserted here each failed silently in an earlier slice
 * of this product's history and would fail silently again:
 *
 *   * the `⌘K` binding itself, which no unit test can press;
 *   * `ENG-142` short-circuiting, whose whole value is that it works when the
 *     text search would not;
 *   * and every message key on two new screens — a missing one renders as a raw
 *     `search.sections.items` while `messages.test.ts` stays green on parity.
 *     That is exactly how slice 10's `soon` defect survived to production-shaped
 *     code, and how slice 13's `due` grouping did an hour later.
 */

const PASSWORD = 'a-long-enough-password';

/** A real Khmer phrase with no inter-word spaces, and a word inside it. */
const PHNOM_PENH = 'ភ្នំពេញ';
const KHMER_TITLE = `បើកសាខានៅ${PHNOM_PENH}ក្នុងខែក្រោយ`;

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
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Search Owner');
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

async function createItem(page: Page, title: string): Promise<void> {
  const input = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
}

/** The palette's own input, which is the combobox the dialog is built around. */
const palette = (page: Page) => page.getByRole('combobox', { name: /search|ស្វែងរក/i });

test.describe('search and the command palette', () => {
  test('⌘K finds work in both scripts, and ENG-142 short-circuits', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('search', testInfo);
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      company,
      `${company}@example.test`,
    );

    await createItem(page, 'Replace the intake filter');
    await createItem(page, KHMER_TITLE);

    // --- The shortcut --------------------------------------------------------
    // Pressed on the page, not on a control: the binding is a window listener,
    // and the thing worth proving is that it fires from wherever the caret
    // happens to be sitting on an ordinary screen.
    await page.goto(`/${locale}/${slug}/projects/${projectSlug}`);
    await page.locator('body').press('ControlOrMeta+k');
    await expect(palette(page)).toBeFocused();

    // --- Latin ---------------------------------------------------------------
    await palette(page).fill('intake');
    await expect(
      page.getByRole('option', { name: /Replace the intake filter/ }),
    ).toBeVisible();

    /**
     * The Khmer half, and the reason this spec is not two English runs.
     *
     * `ភ្នំពេញ` sits in the middle of a title with no spaces around it. Word
     * based full-text sees that whole title as one lexeme and cannot match a
     * word inside it; only the trigram route can, and only if the query and the
     * indexed column agree about zero-width characters (§13).
     */
    await palette(page).fill(PHNOM_PENH);
    await expect(page.getByRole('option', { name: new RegExp(PHNOM_PENH) })).toBeVisible();

    // --- Keyboard-only, all the way to the item -------------------------------
    // §11: "keyboard-operable throughout". Arrow into the list and open with
    // Enter, without the pointer touching anything.
    await palette(page).press('ArrowDown');
    await palette(page).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/${projectSlug}/\\d+$`));

    // The identifier the item page prints is what §7.9 promises to resolve.
    // Scoped to `main`, because the shell has a `<header>` of its own.
    const identifier = (await page.locator('main header span').first().innerText()).trim();
    expect(identifier).toMatch(/^[A-Z][A-Z0-9]{1,4}-\d+$/);

    // --- The short-circuit ---------------------------------------------------
    await page.goto(`/${locale}/${slug}`);
    await page.locator('body').press('ControlOrMeta+k');
    await palette(page).fill(identifier);
    // Its own section above everything: typing an identifier means you already
    // know which item you want.
    await page.getByRole('option', { name: new RegExp(identifier) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/${projectSlug}/\\d+$`));

    // --- Escape closes, without losing the page ------------------------------
    await page.locator('body').press('ControlOrMeta+k');
    await expect(palette(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
  });

  test('the results screen is a URL, and says when it found nothing', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('searchpage', testInfo);
    const { slug } = await newProject(page, locale, company, `${company}@example.test`);

    await createItem(page, 'Calibrate the flow meter');

    // Typed straight into the address bar, because that is the property the
    // screen exists to have: §5's "paste it in chat and a colleague sees what
    // you see", applied to a search rather than to a filtered list.
    await page.goto(`/${locale}/${slug}/search?q=calibrate`);
    await expect(page.getByRole('link', { name: 'Calibrate the flow meter' })).toBeVisible();

    // The form is a plain GET, so submitting rewrites the URL and nothing else.
    const box = page.getByRole('searchbox', { name: /search|ស្វែងរក/i });
    await box.fill('nothing-matches-this-at-all');
    await page.getByRole('button', { name: /^search$|^ស្វែងរក$/i }).click();
    await expect(page).toHaveURL(/q=nothing-matches-this-at-all/);

    // §7.9's `[E]`: not a shrug. The empty state names the query and offers the
    // half of the corpus the search had quietly excluded.
    await expect(page.getByText(/nothing-matches-this-at-all/)).toBeVisible();
    await expect(
      page.getByRole('link', { name: /include archived|បណ្ណសារ/i }),
    ).toBeVisible();
  });

  test('the ? sheet lists the shortcuts, and typing never triggers one', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('shortcuts', testInfo);
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      company,
      `${company}@example.test`,
    );

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}`);

    /**
     * The property that decides whether shortcuts are a feature or a hazard.
     *
     * `/` and `?` inside a text field have to be characters. Without the
     * typing-target guard this opens the palette mid-word and eats the
     * keystroke — §7.7 is emphatic that typed text is never lost, and this is
     * the cheapest way for a product to lose some.
     */
    const input = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await input.fill('what/ever? fine');
    await expect(input).toHaveValue('what/ever? fine');
    await expect(palette(page)).toBeHidden();
    await input.clear();

    /**
     * Focus has to actually leave the field, and `locator('body').press()` is
     * not enough to make it: `body.focus()` is a no-op while a real control
     * holds focus, so the event still arrives with the input as its target and
     * the guard above correctly swallows it. Blurring first is what a person
     * does by clicking away, and it is the difference between testing the
     * shortcut and testing the guard twice.
     */
    await input.blur();

    // Outside a field, `?` opens the sheet.
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: /shortcut|ផ្លូវកាត់/i })).toBeVisible();
    await page.keyboard.press('Escape');

    // And `g` then `m` navigates — the chord, end to end, in a browser.
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}$`));
  });
});
