import { expect, test, type Page } from '@playwright/test';

/**
 * §21.13's demonstrable outcome for slice 20, in a browser:
 *
 *   "Write a page referencing two others and watch both list it without anybody
 *   maintaining an index; insert a table from the `/` menu; jump to a heading
 *   from a generated table of contents; hover a reference and read its first
 *   line."
 *
 * All four are here, plus the one §21.13 names as this slice's definition of
 * done — **the ref table is rebuilt, not appended to**: "removing a sentence
 * removes its edge while an authored `wiki_page_link` survives the same edit —
 * asserted directly, because that distinction is the one §20.0 found the hard
 * way." That is the last test in the file and the reason the file exists.
 *
 * The database half of the same distinction is `__tenancy__/wiki-backlinks.test
 * .ts`, which pins what only Postgres can say — uniqueness, the self-reference
 * CHECK, the composite keys, and the soft-delete/hard-delete asymmetry.
 *
 * And, as with every new screen since slice 13: **every message key**. A missing
 * one renders as a raw `wiki.editor.insert.table` while `messages.test.ts` stays
 * green on parity — exactly how slice 10's `soon` defect and slice 13's `due`
 * grouping shipped.
 */

const PASSWORD = 'a-long-enough-password';

/*
 * Labels are matched at their **start**, never end-anchored — §12's field shell
 * appends a required marker, so the label reads `Title*` while the accessible
 * name is `Title` and a `$` matches nothing. Recorded three times now (password
 * reset, slice 18, slice 19).
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
  /**
   * Whether to create a project as well.
   *
   * Only the authored-link test needs one, and creating it unconditionally
   * would add a form round trip to four tests that never visit a project.
   */
  withProject = false,
): Promise<string> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Handbook Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

  if (withProject) {
    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Field Ops');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/field-ops[?]view=board&new=1$`),
    );
  }

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

/** A page, written through the real create form. Returns its URL. */
async function writePage(page: Page, spaceUrl: string, title: string): Promise<string> {
  await page.goto(`${spaceUrl}/new`);
  await page.getByLabel(/^title|^ចំណងជើង/i).fill(title);
  await page.getByRole('button', { name: /create|បង្កើត/i }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  return new URL(page.url()).pathname;
}

/**
 * The `#[uuid]` token that references a page, built from the page's own URL.
 *
 * A body stores an **id**, never a slug (§20.7), and the id is not on the
 * reader — so it is read off the editor's own hidden `pageId` field, which is
 * the one place the browser is told it. Read rather than assumed: the lesson
 * slice 18 recorded when a test assumed `ENG-1` and passed on body text while
 * the link row was never created.
 */
async function pageToken(page: Page, pageUrl: string): Promise<string> {
  await page.goto(`${pageUrl}/edit`);
  const id = await page.locator('input[name="pageId"]').inputValue();
  return `#[${id}]`;
}

/** Replace the body and save, waiting for the save to land before navigating. */
async function setBody(page: Page, pageUrl: string, body: string): Promise<void> {
  await page.goto(`${pageUrl}/edit`);

  const field = page.getByLabel(/^body|^ខ្លឹមសារ/i);
  await field.fill(body);

  const save = page.getByRole('button', { name: /^save|^រក្សាទុក/i });
  await save.click();

  /*
   * Slice 8's race, still live: navigate only after the mutation has landed.
   * The signal here is the button re-enabling, which is what `useActionState`
   * does when the action resolves — a `page.goto` before that aborts the server
   * action mid-flight and the save silently does not happen.
   */
  await expect(save).toBeEnabled();
  await expect(page.getByText(/saved|បានរក្សាទុក/i).first()).toBeVisible();
}

test.describe('backlinks, the reference graph and the editor', () => {
  test('two referenced pages both list the referring page, with nobody maintaining an index', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('refs', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);

    const deploy = await writePage(page, spaceUrl, 'Deployment');
    const rollback = await writePage(page, spaceUrl, 'Rollback');
    const onboarding = await writePage(page, spaceUrl, 'Onboarding');

    const deployToken = await pageToken(page, deploy);
    const rollbackToken = await pageToken(page, rollback);

    /*
     * A body on the target, so the hover preview has a first line to show. §21.4
     * asks for "the title and the first line of the body" — a page with no body
     * correctly gets no preview, which is why this is written rather than
     * assumed.
     *
     * It opens with a **heading**, deliberately: the preview is read through the
     * parser (`documentText`), so `# Shipping` previews as *Shipping* rather
     * than as `# Shipping`. That is the property that would silently regress if
     * somebody replaced the parse with a substring.
     */
    await setBody(page, deploy, '# Shipping\n\nMerge to main and wait for CI.');

    /* --- one page references two ----------------------------------------- */
    await setBody(
      page,
      onboarding,
      `Read ${deployToken} first, then ${rollbackToken} if it goes wrong.`,
    );

    /* --- and both of them list it, without anybody maintaining an index --- */
    /*
     * §21.4's whole argument: "you write a page about deployment, and the page
     * about onboarding — written by somebody else, six months earlier — starts
     * listing it without anybody maintaining an index."
     */
    for (const target of [deploy, rollback]) {
      await page.goto(target);
      const backlinks = page.getByRole('region', { name: /links here|យោងមកទីនេះ/i });
      await expect(backlinks.getByRole('link', { name: 'Onboarding' })).toBeVisible();
    }

    /* --- the hover preview reads the first line -------------------------- */
    /*
     * §21.4: "a hover preview on a page token — the title and the first line of
     * the body, resolved from a row the page has already loaded." It is a
     * `title` attribute rather than a floating card, so the assertion is on the
     * attribute — which is also what a keyboard user and a screen reader get.
     */
    await page.goto(onboarding);

    /*
     * **Scoped to the article, not `.first()` on the whole page.** The space
     * sidebar lists every page in the space, so a bare `getByRole('link', {name:
     * 'Deployment'})` resolves to the *navigation* entry — which would have been
     * satisfied whether or not the token in the body rendered at all.
     *
     * That is the same scar slice 15 recorded for the accent picker and slice 19
     * for the owner picker: an assertion a control beside the thing can satisfy
     * is not testing the thing it names.
     */
    const reference = page.getByRole('article').getByRole('link', { name: 'Deployment' });
    // The title *and* the first line, with the heading marker gone — which is
    // what proves the excerpt went through the parser rather than a substring.
    await expect(reference).toHaveAttribute('title', 'Deployment — Shipping');
  });

  /**
   * §21.13's definition of done for this slice, and the distinction §20.0 found
   * the hard way: a **derived** edge disappears with its sentence, an
   * **authored** one survives the same edit.
   */
  test('removing a sentence removes its reference, and leaves an authored item link alone', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('rebuild', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`, true);

    /* --- an item, and its real identifier read off the screen ------------- */
    /*
     * Slice 18's scar, restated: `ENG-1` is the plan's running example and not
     * this project's key — `project-key.ts` derives one from the name. An
     * assertion that assumed it passed on *body text* while the link row was
     * never created. A test that reads the identifier cannot be wrong about it.
     */
    await page.goto(`/${locale}/${slug}/projects/field-ops?view=board`);
    const composer = page.locator('main').getByRole('textbox').first();
    await composer.fill('Restore the database');
    await composer.press('Enter');
    await expect(page.getByText('Restore the database')).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/field-ops/1`);
    const identifier = (
      await page.locator('main').getByText(/^[A-Z][A-Z0-9]*-1$/).first().innerText()
    ).trim();

    const spaceUrl = await openCompanySpace(page, locale, slug);
    const target = await writePage(page, spaceUrl, 'Runbook');
    const source = await writePage(page, spaceUrl, 'Incident notes');
    const token = await pageToken(page, target);

    /*
     * **One body carrying both kinds of edge**, which is what lets one edit
     * separate them. §21.4: "What *does* create a link is an `ENG-142` in a
     * body: writing one links the page to the item it names… Removing the
     * sentence does **not** unlink."
     */
    await setBody(page, source, `See ${token} for the steps, and ${identifier} to restore.`);

    // The derived edge exists.
    await page.goto(target);
    await expect(
      page
        .getByRole('region', { name: /links here|យោងមកទីនេះ/i })
        .getByRole('link', { name: 'Incident notes' }),
    ).toBeVisible();

    // And so does the authored one, on the item's own panel.
    await page.goto(`/${locale}/${slug}/projects/field-ops/1`);
    await expect(page.getByRole('link', { name: 'Incident notes' })).toBeVisible();

    /* --- both sentences go ------------------------------------------------ */
    await setBody(page, source, 'The steps moved somewhere else.');

    /*
     * The **derived** edge is gone, because it is a projection of the body and
     * the body no longer says it. Rebuilt, never appended to — an appended table
     * would still list it here, which is the failure this test exists for.
     */
    await page.goto(target);
    await expect(
      page.getByRole('region', { name: /links here|យោងមកទីនេះ/i }),
    ).toHaveCount(0);

    /*
     * The **authored** edge survives the same edit, and that is the half §20.0
     * found the hard way: "a link somebody made deliberately from the item's own
     * panel should not be undone by an edit to a paragraph, so detaching stays
     * an explicit act."
     */
    await page.goto(`/${locale}/${slug}/projects/field-ops/1`);
    await expect(page.getByRole('link', { name: 'Incident notes' })).toBeVisible();
  });

  test('the / menu inserts a table, and the live preview renders it', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('slash', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);
    const pageUrl = await writePage(page, spaceUrl, 'Runbook');

    await page.goto(`${pageUrl}/edit`);
    const field = page.getByLabel(/^body|^ខ្លឹមសារ/i);

    /* --- the menu opens on a slash at the start of a line ---------------- */
    await field.click();
    await field.pressSequentially('/table');

    const menu = page.getByRole('listbox', { name: /insert a block|បញ្ចូលប្លុក/i });
    await expect(menu).toBeVisible();

    /*
     * The combobox pattern is announced on the **textarea**, never on the list
     * — focus never leaves the field, which is what makes typing possible at
     * all. Asserted because it is the property that would silently regress.
     */
    await expect(field).toHaveAttribute('aria-expanded', 'true');

    /* --- Enter inserts it, with the keyboard alone ----------------------- */
    await field.press('Enter');
    await expect(menu).toHaveCount(0);

    // What it wrote is Markdown a person could have typed (§21.15's rule).
    await expect(field).toHaveValue(/\| --- \| --- \|/);

    /*
     * And the live preview renders it as a table — the same `documents.ts` the
     * server renders with (§20.7), which is what makes it a preview rather than
     * a promise.
     *
     * **At 390px there is no *beside***, so the preview is behind the toggle
     * (§15-6) and this reveals it; on a wide screen the toggle is not rendered
     * at all and the preview is already on screen. The `mobile-km` project is
     * what caught this — the assertion passed on two projects and failed on the
     * one where the layout is the whole point.
     */
    const previewTab = page.getByRole('button', { name: /^preview$|^មើលជាមុន$/i });
    if (await previewTab.count()) await previewTab.click();

    await expect(page.getByRole('table')).toBeVisible();
  });

  test('a generated table of contents jumps to a heading', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('toc', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);
    const pageUrl = await writePage(page, spaceUrl, 'Release process');

    await setBody(
      page,
      pageUrl,
      ['# Preparing', 'Check the branch.', '# Rolling back', 'Revert and redeploy.'].join('\n'),
    );

    await page.goto(pageUrl);

    const contents = page.getByRole('navigation', { name: /on this page|ក្នុងទំព័រនេះ/i });
    await expect(contents).toBeVisible();

    /*
     * The anchor is slugified heading text (§21.5), and the failure is named
     * rather than designed around: renaming a heading breaks a link to it. What
     * is asserted is that the link resolves to a heading that is actually on the
     * page — the property a stale or duplicated anchor would break.
     */
    const jump = contents.getByRole('link', { name: 'Rolling back' });
    await expect(jump).toHaveAttribute('href', '#rolling-back');

    await jump.click();
    await expect(page).toHaveURL(/#rolling-back$/);
    await expect(page.locator('#rolling-back')).toBeVisible();
  });

  test('a callout and a to-do render as more than their punctuation', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('callout', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);
    const pageUrl = await writePage(page, spaceUrl, 'Checklist');

    await setBody(
      page,
      pageUrl,
      ['> [!warning] Read this first', '> The API changed.', '', '- [x] Ship it', '- [ ] Tell people'].join('\n'),
    );

    await page.goto(pageUrl);

    // The callout is an aside with its title, not a quote containing `[!warning]`.
    await expect(page.getByText('Read this first')).toBeVisible();
    await expect(page.getByText('[!warning]')).toHaveCount(0);

    /*
     * A to-do renders as a real checkbox carrying its state — disabled, because
     * this is a document rather than a form: the state lives in the body's own
     * text, and a box that could be clicked would either lie or silently edit
     * somebody else's page from the reader.
     */
    const boxes = page.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await expect(boxes.first()).toBeChecked();
    await expect(boxes.first()).toBeDisabled();
  });
});
