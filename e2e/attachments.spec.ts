import { expect, test, type Page } from '@playwright/test';

/**
 * The last third of §14's slice 8: "Comments, mentions, attachments — full
 * collaboration loop on one item."
 *
 * What only a browser can answer here is that the **two-step upload** actually
 * works end to end. Every part of it passes its own test in isolation — the
 * rules in `src/lib/attachments.test.ts`, the signature against AWS's published
 * vector in `sigv4.test.ts`, the tenancy in `__tenancy__/attachments.test.ts` —
 * and none of those would notice if the ticket returned a URL the browser could
 * not PUT to, or if the confirm step never fired and the file stayed `pending`
 * and invisible. That failure looks like an upload that appears to succeed and
 * leaves nothing on screen, which is exactly what this catches.
 *
 * It runs against the **local storage driver** (no `S3_*` configured), which is
 * the point of that driver existing: the ticket endpoint, the PUT, the confirm
 * action and the download redirect are all the production path, and only the
 * thing receiving the bytes differs.
 *
 * Run in `en` and `km` (§15). Every label is a catalogue key resolved at render,
 * so a missing Khmer string surfaces here as `attachments.add` on screen.
 */

const PASSWORD = 'a-long-enough-password';
const OWNER = 'File Owner';

/** A real PNG — eight bytes of signature and a minimal IHDR-bearing body. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function newItem(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<string> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill(OWNER);
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

  const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
  await addTask.fill('Ship the invoice export');
  await addTask.press('Enter');
  await expect(page.getByRole('link', { name: 'Ship the invoice export' })).toBeVisible();

  return `/${locale}/${slug}/projects/field-ops/1`;
}

test.describe('attachments', () => {
  test('uploads a file to the item, serves it back, and removes it', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const item = await newItem(
      page,
      locale,
      unique('Files', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await page.goto(item);

    const panel = page.getByRole('region', { name: /^(files|ឯកសារភ្ជាប់)$/i });

    // §11 `[E]`: the empty panel says what it is for and leaves the control
    // that fixes it live beneath — never a shrug.
    await expect(panel).toContainText(/no files yet|មិនទាន់មានឯកសារទេ/i);

    // The picker rather than a synthesised drop: it is the path that works from
    // a keyboard and on a phone, which makes it the one §11's mouse-free loop
    // and §15-6's 390px pass both depend on.
    await panel.locator('input[type=file]').setInputFiles({
      name: 'whiteboard.png',
      mimeType: 'image/png',
      buffer: PNG,
    });

    // The file appears only after the *confirm* step: the ticket and the PUT
    // leave it `pending`, which renders nowhere. Seeing the name here is the
    // assertion that all three steps ran.
    await expect(panel.getByRole('link', { name: 'whiteboard.png' })).toBeVisible();
    await expect(panel).toContainText(/\d+\s*(B|បៃ)/);

    // Nothing here is a message key that escaped a catalogue (§15-4).
    await expect(panel).not.toContainText('attachments.');

    /**
     * The bytes come back through `/api/internal/upload/<id>`, which asks §10
     * per request and redirects to a URL good for minutes — never a store URL
     * baked into the page. Following it is what proves the round trip: a ticket
     * that signed one key and a download that reads another would look
     * identical on screen until this ran.
     */
    const href = await panel.getByRole('link', { name: 'whiteboard.png' }).getAttribute('href');

    // Fetched *from the page* rather than through Playwright's API context, and
    // that is not incidental: the session cookie is `Secure` under a production
    // build, and only the browser will send it over the loopback origin the
    // test server listens on. It is also the more faithful assertion — this is
    // the request a viewer's browser makes.
    const download = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return { status: response.status, length: (await response.arrayBuffer()).byteLength };
    }, href as string);

    expect(download.status).toBe(200);
    expect(download.length).toBe(PNG.byteLength);

    // §10: the uploader may retract their own file. Soft, so the row goes and
    // the bytes wait for slice 9's sweeper.
    await panel.getByRole('button', { name: /remove whiteboard\.png|លុប whiteboard\.png/i }).click();
    await expect(panel.getByRole('link', { name: 'whiteboard.png' })).toBeHidden();
    await expect(panel).toContainText(/no files yet|មិនទាន់មានឯកសារទេ/i);
  });

  test('sends a file with a comment, and renders it inside that comment', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const item = await newItem(
      page,
      locale,
      unique('Paste', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await page.goto(item);

    const thread = page.getByRole('region', { name: /^(comments|មតិយោបល់)$/i });
    const box = page.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);

    await box.fill('Here is what the client sent');

    // The composer's own picker — the keyboard path to what §2.4's paste does.
    await thread.locator('input[type=file]').setInputFiles({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 minimal'),
    });

    // While the bytes are going up the file sits in the queue, and Post is
    // disabled — posting now would drop it.
    const post = page.getByRole('button', { name: /^(post|ផ្សាយ)$/i });
    await expect(post).toBeEnabled();

    await post.click();

    // The file rides along with the comment, in one transaction, and renders
    // inside it — not in the item's panel, which is what keeps the two lists
    // meaning different things.
    await expect(thread).toContainText('Here is what the client sent');
    await expect(thread.getByRole('link', { name: 'invoice.pdf' })).toBeVisible();

    const panel = page.getByRole('region', { name: /^(files|ឯកសារភ្ជាប់)$/i });
    await expect(panel).toContainText(/no files yet|មិនទាន់មានឯកសារទេ/i);

    // The composer cleared, files included — but only because the post
    // succeeded (§7.7).
    await expect(box).toHaveValue('');
  });

  test('refuses a file the product does not accept, before sending a byte', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const item = await newItem(
      page,
      locale,
      unique('Refuse', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await page.goto(item);

    const panel = page.getByRole('region', { name: /^(files|ឯកសារភ្ជាប់)$/i });

    /**
     * An SVG is an image and is still refused: it is a document that can carry
     * script, and the one place anybody opens an attachment is a browser. The
     * refusal is client-side here — the same `checkAttachment` the service runs
     * — which is what stops a phone spending its data plan to be told no
     * (§2.5-5).
     */
    await panel.locator('input[type=file]').setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });

    await expect(panel).toContainText(
      /that file type is not accepted|មិនទទួលយកប្រភេទឯកសារនេះទេ/i,
    );

    // §11 `[X]`: the row stays with its reason rather than vanishing, and the
    // panel still holds nothing.
    await expect(panel.getByRole('link', { name: 'logo.svg' })).toBeHidden();
    await expect(panel).toContainText(/no files yet|មិនទាន់មានឯកសារទេ/i);
  });
});
