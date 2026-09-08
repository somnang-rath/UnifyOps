import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * §21.13's definition of done for slice 22, in a browser:
 *
 *   "Create an incident report from a template, export the whole company space
 *    to a folder of Markdown a person can read, and import it back into an empty
 *    workspace."
 *
 *   "Slice 22: a round trip — export a space, import it into an empty
 *    workspace, and the two trees match."
 *
 * **The round trip is the whole reason this file exists, and it cannot be a unit
 * test.** `plan.test.ts` proves the paths `pagePath` writes are the paths
 * `planImport` reads; `zip.test.ts` proves the archive is an archive.
 * Neither can prove the thing §18-7's pilot customer will actually try: press
 * Export, get a file, hand that same file back, and find your pages. Every layer
 * in between — the base64 in the action's result, the Blob the browser saves,
 * the multipart upload, `serverActions.bodySizeLimit` — is only exercised here.
 *
 * §21.14's check 4 is the other half: "export a Khmer space and open the files in
 * a plain text editor → titles, bodies and image links are intact and readable,
 * and tokens have resolved to names". That is asserted by reading the downloaded
 * bytes off disk, which is as close to "open it in a plain text editor" as a
 * test gets.
 */

const PASSWORD = 'a-long-enough-password';

/** A real Khmer title, so §21.14's check 4 is about Khmer rather than about Latin. */
const KHMER_TITLE = 'គោលការណ៍ឈប់សម្រាក';

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
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Transfer Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
  return slug;
}

/**
 * The company space's URL, resolved from the space list rather than guessed —
 * `wiki.spec.ts`'s helper, and for its reason: the slug is derived at signup and
 * the company may rename it, so hard-coding `/wiki/company` would assert an
 * implementation detail of `deriveSlug` from a screen that has the answer on it.
 */
async function openCompanySpace(page: Page, locale: string, slug: string): Promise<string> {
  await page.goto(`/${locale}/${slug}/wiki`);
  const first = page.locator('main').getByRole('link').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/wiki/[^/]+$`));
  return page.url();
}

/** Write a page in the space currently open, and land on its reader. */
async function writePage(page: Page, spaceUrl: string, title: string, body: string) {
  await page.goto(`${spaceUrl}/new`);
  await page.getByLabel(/^Title|^ចំណងជើង/).fill(title);
  await page.getByLabel(/^Body|^ខ្លឹមសារ/).fill(body);
  await page.getByRole('button', { name: /create page|បង្កើតទំព័រ/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(title) })).toBeVisible();
}

/*
  This walks signup, four page writes, an export, a project, an import and a
  refusal. The 30s default is for a flow, and this is a round trip — the ceiling
  is raised for the same reason `responsive.spec.ts` and `a11y.spec.ts` raised
  theirs in slice 18: a per-step assertion still fails fast and names its own
  step, and what is raised is the ceiling on the walk.
*/
test.describe('wiki templates, export and import', () => {
  test.slow();

  test('makes a template, writes from it, and round-trips the space through a zip', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('xfer', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);

    /* --- §21.7: a page, made into a template ------------------------------ */

    await writePage(
      page,
      spaceUrl,
      'Incident report',
      '## What happened\n\n## Impact\n\n## Follow-up\n',
    );

    /*
      The consequence is stated before the click, which is what the panel's line
      is for — a template leaves the sidebar, and somebody who was not told that
      has lost a page.
    */
    await expect(
      page.getByText(/offered when somebody creates a page|ស្នើឡើង នៅពេលនរណាម្នាក់បង្កើតទំព័រ/i),
    ).toBeVisible();

    await page.getByRole('button', { name: /use as a template|ប្រើជាគំរូ/i }).click();

    /*
      **Wait on something only the server can produce.** Slice 20 recorded this
      the hard way: a control closing or re-enabling is a client event, and only
      the page re-rendering with the server's new answer is proof the mutation
      committed. The badge is rendered by the reader from the row.
    */
    const article = page.locator('article');
    await expect(article.getByText(/^template$|^គំរូ$/i)).toBeVisible();

    /* --- hidden from the tree, listed on the space home ------------------- */

    await page.goto(spaceUrl);

    /*
      Scoped to the sidebar *by its own label*, because the screen has three
      `<nav>` elements (the breadcrumb, the sidebar, the app header) and because
      the Templates section on the same screen also names this page. An assertion
      a control beside the thing can satisfy is not testing the thing it names —
      slices 15, 19, 20 and 21 each recorded that, and this is the fifth.
    */
    const tree = page.getByRole('navigation', { name: /pages in this space|ទំព័រក្នុងលំហនេះ/i });
    await expect(tree.getByRole('link', { name: 'Incident report' })).toHaveCount(0);

    await expect(
      page.locator('main').getByRole('link', { name: 'Incident report' }),
    ).toBeVisible();

    /* --- §21.7: create a page from it ------------------------------------- */

    await page.getByRole('link', { name: /^use$|^ប្រើ$/i }).click();
    await expect(page).toHaveURL(/[?]template=/);

    // The body arrived, and it is editable text rather than a reference: this is
    // a copy, which is the difference between a template and the synced block
    // §21.9 refuses.
    const body = page.getByLabel(/^Body|^ខ្លឹមសារ/);
    await expect(body).toHaveValue(/## Impact/);

    await page.getByLabel(/^Title|^ចំណងជើង/).fill('Outage on the 3rd');
    await page.getByRole('button', { name: /create page|បង្កើតទំព័រ/i }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: /Outage on the 3rd/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Follow-up/ })).toBeVisible();

    /* --- a Khmer page, so §21.14's check 4 is about Khmer ----------------- */

    await writePage(page, spaceUrl, KHMER_TITLE, 'សូមអានមុនពេលចាប់ផ្ដើម។');

    /* --- §21.8: export ---------------------------------------------------- */

    await page.goto(spaceUrl);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /export as markdown|នាំចេញជា Markdown/i }).click();
    const file = await download;

    const directory = await mkdtemp(join(tmpdir(), 'unifyops-export-'));
    const archive = join(directory, 'space.zip');
    await file.saveAs(archive);

    /*
      §21.14's check 4, as close as a test gets to "open the files in a plain
      text editor": the bytes are read back off disk and unpacked by the reader
      this slice wrote — which `zip.test.ts` has already checked against an
      archive built by hand from `node:zlib`, and which Windows' own
      `Expand-Archive` reads.
    */
    const { readZip } = await import('../src/server/transfer/zip');
    const entries = readZip(new Uint8Array(await readFile(archive)));
    const decoder = new TextDecoder();

    // Every page is a file, the template included — §21.7 makes it an ordinary
    // page, and an export that dropped it could not be imported back as itself.
    expect(entries.length).toBe(3);

    const khmer = entries.find((entry) => decoder.decode(entry.bytes).includes(KHMER_TITLE));
    expect(khmer, 'the Khmer page is in the archive').toBeTruthy();
    expect(decoder.decode(khmer?.bytes as Uint8Array)).toContain('សូមអានមុនពេលចាប់ផ្ដើម។');

    const template = entries.find((entry) =>
      decoder.decode(entry.bytes).includes('title: "Incident report"'),
    );
    expect(decoder.decode(template?.bytes as Uint8Array)).toContain('template: true');
    expect(decoder.decode(template?.bytes as Uint8Array)).toContain('## Follow-up');

    /* --- §21.8: import it back into an empty space ------------------------ */

    /*
      A project space, created fresh, which is the "empty workspace" §21.13's
      round trip asks for reduced to what a browser test can build in a second:
      an empty space with its own tree, in the same schema, through the same
      importer.
    */
    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Archive');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
    await expect(page).toHaveURL(/projects\/archive/);

    await page.goto(`/${locale}/${slug}/wiki`);
    /*
      **The page count, asserted by href rather than by name.**

      Two things made the obvious version wrong, and both are worth keeping. The
      space link's accessible name carries the count — "Archive No pages" — and
      Playwright matches a name against the whole string, so an unanchored
      `Archive` does not match; that is `wiki.spec.ts`'s label scar applied to an
      accessible name. And the name is *translated*, so matching the English
      sentence passes on `en` and fails on the two Khmer projects. The href is
      the same in both locales, and the digit is too — §13 pins Latin digits for
      Khmer.

      Finding that found a real defect underneath it: the count said "No pages"
      for a space holding three, in every space in the product, since slice 18
      shipped. See `fetchSpaces`. This assertion is what would catch it again.
    */
    await expect(
      page.locator('main').locator(`a[href="${new URL(spaceUrl).pathname}"]`),
    ).toContainText('3');
    await page.getByRole('link', { name: /^Archive/ }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/wiki/[^/]+$`));

    await page.getByLabel(/markdown or a zip|Markdown ឬ zip/i).setInputFiles(archive);
    await page.getByRole('button', { name: /^import$|^នាំចូល$/i }).click();

    // The count is the server's answer, so this is the wait as well as the
    // assertion — three pages in, three pages out.
    await expect(page.getByText(/3 pages imported|នាំចូល 3 ទំព័រ/i)).toBeVisible();

    /* --- the two trees match ---------------------------------------------- */

    const sidebar = page.getByRole('navigation', {
      name: /pages in this space|ទំព័រក្នុងលំហនេះ/i,
    });
    await expect(sidebar.getByRole('link', { name: 'Outage on the 3rd' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: KHMER_TITLE })).toBeVisible();

    // The template came back as a template: absent from the tree, present in the
    // Templates section. That is the round trip's sharpest claim, because it is
    // the one property that travels only in the front matter.
    await expect(sidebar.getByRole('link', { name: 'Incident report' })).toHaveCount(0);
    await expect(
      page.locator('main').getByRole('link', { name: 'Incident report' }),
    ).toBeVisible();

    /* --- §21.8: importing something that is not Markdown ------------------ */

    const junk = join(directory, 'notes.rtf');
    await writeFile(junk, 'this is not markdown and not a zip');

    await page.getByLabel(/markdown or a zip|Markdown ឬ zip/i).setInputFiles(junk);
    await page.getByRole('button', { name: /^import$|^នាំចូល$/i }).click();

    await expect(page.getByText(/choose a \.zip or a \.md|សូមជ្រើសរើសឯកសារ/i)).toBeVisible();
  });
});
