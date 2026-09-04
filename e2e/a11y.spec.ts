import { expect, test, type Page } from '@playwright/test';

/**
 * §11's accessibility baseline, swept across every v1 screen:
 *
 *   "Keyboard-operable throughout including drag-and-drop · visible focus rings
 *    · WCAG AA contrast · correct labels and roles · `prefers-reduced-motion`
 *    respected · **every icon-only control has an accessible name**."
 *
 * Three of those are asserted elsewhere and deliberately not repeated here: the
 * keyboard drag is `board.spec.ts` and `views.spec.ts`, contrast is a token
 * decision checked by `design-tokens` and `theme.spec.ts`, and reduced motion
 * is one global rule in `globals.css`.
 *
 * What is left is the row that fails silently and per screen — a control with
 * no accessible name. It looks perfect, it works with a mouse, and it is
 * unusable with a screen reader, which is why it survives review and why the
 * check has to be a sweep rather than a list somebody maintains.
 *
 * **The name is computed by Playwright, not by this file.** `ariaSnapshot()`
 * runs the real accessible-name algorithm — text content, `aria-label`,
 * `aria-labelledby`, a `<label>`'s `for`, an image's `alt`, a `title` — so a
 * control named in any legitimate way passes, and re-implementing that here
 * would only produce a second, wronger answer.
 *
 * It runs per locale, because a name is a string from a catalogue: an
 * `aria-label` present in `en.json` and missing from `km.json` is exactly the
 * defect §13 exists to prevent, and it is invisible to `messages.test.ts`,
 * which can only check that the two files have the same keys.
 */

const PASSWORD = 'a-long-enough-password';

/** Roles whose entries in an ARIA snapshot must carry a name. */
const MUST_BE_NAMED =
  /^\s*-\s+(button|link|checkbox|radio|textbox|combobox|switch|slider|searchbox|spinbutton|menuitem|tab)\s*:?\s*$/;

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile-km',
    'The names are the same at every width; the mobile project runs §15-6 instead.',
  );
});

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function unnamedControls(page: Page): Promise<string[]> {
  const snapshot = await page.locator('body').ariaSnapshot();
  return snapshot.split('\n').filter((line) => MUST_BE_NAMED.test(line));
}

async function expectEveryControlNamed(page: Page, screen: string) {
  const unnamed = await unnamedControls(page);
  expect(unnamed, `${screen} has controls with no accessible name`).toEqual([]);
}

test.describe('§11 — every control has an accessible name', () => {
  test('the pre-tenancy screens', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';

    for (const path of ['', '/sign-in', '/sign-up']) {
      await page.goto(`/${locale}${path}`);
      await expectEveryControlNamed(page, path || '/');
    }
  });

  test('every workspace screen, with real content in it', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const company = unique('A11y', testInfo);
    const slug = company.toLowerCase();

    await page.goto(`/${locale}/sign-up`);
    await page.getByLabel(/name|ឈ្មោះ/i).fill('Screen Reader');
    await page.getByLabel(/email|អ៊ីមែល/i).fill(`${unique('a11y', testInfo)}@example.com`);
    await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
    await expectEveryControlNamed(page, 'invite step');

    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('A11y Ops');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/a11y-ops[?]view=board&new=1$`),
    );

    // An empty screen has few controls on it, and the controls a row carries
    // — the state select, the priority, the assignee — are the ones most
    // likely to be icon-only.
    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill('Audit the depot lighting');
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: 'Audit the depot lighting' })).toBeVisible();

    const screens: [string, string][] = [
      ['My Work', `/${locale}/${slug}`],
      ['team', `/${locale}/${slug}/team`],
      ['projects', `/${locale}/${slug}/projects`],
      ['board', `/${locale}/${slug}/projects/a11y-ops?view=board`],
      ['list', `/${locale}/${slug}/projects/a11y-ops`],
      ['table', `/${locale}/${slug}/projects/a11y-ops?view=table`],
      ['calendar', `/${locale}/${slug}/projects/a11y-ops?view=calendar`],
      ['item', `/${locale}/${slug}/projects/a11y-ops/1`],
      ['project settings', `/${locale}/${slug}/projects/a11y-ops/settings`],
      ['cycles', `/${locale}/${slug}/projects/a11y-ops/cycles`],
      ['search', `/${locale}/${slug}/search?q=depot`],
      ['inbox', `/${locale}/${slug}/inbox`],
      ['settings general', `/${locale}/${slug}/settings/general`],
      ['settings branding', `/${locale}/${slug}/settings/branding`],
      ['settings members', `/${locale}/${slug}/settings/members`],
      ['settings teams', `/${locale}/${slug}/settings/teams`],
      ['settings labels', `/${locale}/${slug}/settings/labels`],
      ['settings holidays', `/${locale}/${slug}/settings/holidays`],
      ['settings notifications', `/${locale}/${slug}/settings/notifications`],
      ['settings notification defaults', `/${locale}/${slug}/settings/notification-defaults`],
      ['settings availability', `/${locale}/${slug}/settings/availability`],
    ];

    for (const [name, path] of screens) {
      await page.goto(path);
      await expectEveryControlNamed(page, name);
    }
  });

  test('the command palette and the shortcut sheet, which are the two overlays', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const company = unique('A11yModal', testInfo);
    const slug = company.toLowerCase();

    await page.goto(`/${locale}/sign-up`);
    await page.getByLabel(/name|ឈ្មោះ/i).fill('Screen Reader');
    await page.getByLabel(/email|អ៊ីមែល/i).fill(`${unique('a11ymodal', testInfo)}@example.com`);
    await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

    // **Wait for the redirect before navigating.** `page.goto` immediately
    // after a submit aborts the server action mid-flight — slice 8's race, and
    // here it produced a workspace that did not exist yet and a 404 with no
    // palette on it. The invite step is where `createWorkspaceAction` lands, so
    // arriving there is the signal that the company was actually written.
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
    await page.goto(`/${locale}/${slug}`);

    // A dialog is the one place an unnamed control is worst: focus is trapped
    // inside it, so there is nothing else on the page to take a bearing from.
    // Pressed on the page rather than on `page.keyboard`, for the reason
    // `search.spec.ts` records: the binding is a window listener, and after a
    // navigation focus may still sit on a control — where `isTypingTarget`
    // correctly swallows the chord.
    await page.locator('body').press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectEveryControlNamed(page, 'command palette');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.locator('body').press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectEveryControlNamed(page, 'shortcut sheet');
  });
});

test.describe('§11 — landmarks and headings', () => {
  test('every screen has exactly one main landmark and starts at h1', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const company = unique('A11yLand', testInfo);
    const slug = company.toLowerCase();

    await page.goto(`/${locale}/sign-up`);
    await page.getByLabel(/name|ឈ្មោះ/i).fill('Screen Reader');
    await page.getByLabel(/email|អ៊ីមែល/i).fill(`${unique('a11yland', testInfo)}@example.com`);
    await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

    // As above: the redirect is the signal that the workspace exists.
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

    for (const path of [
      `/${locale}/${slug}`,
      `/${locale}/${slug}/projects`,
      `/${locale}/${slug}/settings/general`,
      `/${locale}/${slug}/inbox`,
    ]) {
      await page.goto(path);

      // One `main`, and it is the skip link's target. Two would make "skip to
      // content" ambiguous; none would make it inert.
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main#main')).toHaveCount(1);

      // A screen that starts at `h2` reads to a screen reader as a fragment of
      // a page whose title it never heard.
      await expect(page.locator('h1')).not.toHaveCount(0);
    }
  });
});
