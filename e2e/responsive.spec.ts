import { expect, test, type Page } from '@playwright/test';

/**
 * §15-6: "Responsive — every v1 screen · **usable at 390px wide**."
 *
 * §17-3 made responsive a v1 must-have rather than a Phase 2 flow, on §2.5-3's
 * "phone-heavy usage even among desk staff", and §4 carries it as a must-have
 * row. Until slice 16 the suite's mobile project was the Pixel 7 preset at
 * 412px — the twenty-two pixels in which a header stops wrapping and a table
 * stops overflowing. The viewport is pinned to 390 in `playwright.config.ts`
 * now, and this file is the check the number was for.
 *
 * **The assertion is that the document does not scroll sideways.** That is the
 * one failure that makes a screen unusable rather than merely tight: a page
 * wider than the viewport hides content behind an edge with no affordance, and
 * every tap lands a few pixels off. Views that scroll horizontally *on purpose*
 * — the board's columns, the table, the workload — do it inside their own
 * `overflow-x` container, so they pass this check while still scrolling, which
 * is exactly the distinction being asserted.
 *
 * It runs on the mobile project only. The desktop projects would pass it
 * trivially and the run is already three projects wide.
 */

const PASSWORD = 'a-long-enough-password';

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-km',
    '§15-6 is a check at one width; the desktop projects would assert nothing.',
  );
});

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/**
 * How far the *document* scrolls sideways, and what is pushing it.
 *
 * Naming the culprit is most of the value: "42px" sends somebody hunting
 * through a screen, and `table.w-\[900px\]` is a one-line fix. Finding it takes
 * one non-obvious step — an element whose right edge is past the viewport is
 * only to blame if **no ancestor scrolls**. The board's columns, the table and
 * the workload all reach far past the edge on purpose, inside their own
 * `overflow-x` container, and reporting those would make the message noise.
 */
async function horizontalOverflow(page: Page): Promise<{ over: number; culprit: string }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const over = doc.scrollWidth - doc.clientWidth;
    if (over <= 1) return { over, culprit: '(none)' };

    const scrolls = (el: Element) => {
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden';
    };

    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== doc; p = p.parentElement) {
        if (scrolls(p)) return true;
      }
      return false;
    };

    let culprit = '(no unclipped element — check a margin or a transform)';
    let widest = doc.clientWidth + 1;
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect();
      // A `fixed` element spanning `inset-x-0` stretches to the *document's*
      // width once the document is already too wide, so it reports the overflow
      // rather than causing it. The toast region is the one in this product,
      // and it named itself as the culprit on every screen until this line.
      const position = getComputedStyle(el).position;
      if (position === 'fixed' || position === 'sticky') continue;
      if (box.right <= widest || clipped(el)) continue;
      widest = box.right;
      const cls = (el.getAttribute('class') ?? '').slice(0, 90);
      culprit = `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''} → right ${Math.round(box.right)}`;
    }
    return { over, culprit };
  });
}

async function expectNoSidewaysScroll(page: Page, screen: string) {
  const { over, culprit } = await horizontalOverflow(page);
  expect(over, `${screen} scrolls sideways by ${over}px — widest: ${culprit}`).toBeLessThanOrEqual(
    1,
  );
}

test.describe('§15-6 — every screen at 390px', () => {
  test('the pre-tenancy screens', async ({ page }, testInfo) => {
    const locale = 'km';

    for (const path of ['', '/sign-in', '/sign-up']) {
      await page.goto(`/${locale}${path}`);
      await expectNoSidewaysScroll(page, path || '/');
    }

    // Signing up walks the rest of the pre-tenancy path, so it is measured
    // from the state a stranger is actually in rather than from a bare URL.
    const company = unique('Narrow', testInfo);
    await page.getByLabel(/name|ឈ្មោះ/i).fill('Narrow Runner');
    await page.getByLabel(/email|អ៊ីមែល/i).fill(`${unique('narrow', testInfo)}@example.com`);
    await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
    await expectNoSidewaysScroll(page, 'new-workspace');

    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

    const slug = company.toLowerCase();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
    await expectNoSidewaysScroll(page, 'invite step');
  });

  test('every workspace screen, with real content in it', async ({ page }, testInfo) => {
    const locale = 'km';
    const company = unique('Narrow2', testInfo);
    const slug = company.toLowerCase();

    await page.goto(`/${locale}/sign-up`);
    await page.getByLabel(/name|ឈ្មោះ/i).fill('Narrow Runner');
    await page.getByLabel(/email|អ៊ីមែល/i).fill(`${unique('narrow2', testInfo)}@example.com`);
    await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();
    await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
    await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Narrow Ops');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/narrow-ops[?]view=board&new=1$`),
    );

    // An empty screen is not the screen that overflows. §11's edge row names
    // long titles for exactly this reason, so the fixture carries one that no
    // phone can fit on a line.
    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill(
      'ត្រួតពិនិត្យម៉ាស៊ីនភ្លើងបម្រុងនៅឃ្លាំងខេត្តកណ្តាល និងរាយការណ៍ជូនប្រធានផ្នែក',
    );
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: /ត្រួតពិនិត្យ/ })).toBeVisible();

    const screens: [string, string][] = [
      ['My Work', `/${locale}/${slug}`],
      ['team', `/${locale}/${slug}/team`],
      ['projects', `/${locale}/${slug}/projects`],
      ['new project', `/${locale}/${slug}/projects/new`],
      ['board', `/${locale}/${slug}/projects/narrow-ops?view=board`],
      ['list', `/${locale}/${slug}/projects/narrow-ops`],
      ['table', `/${locale}/${slug}/projects/narrow-ops?view=table`],
      ['calendar', `/${locale}/${slug}/projects/narrow-ops?view=calendar`],
      ['item', `/${locale}/${slug}/projects/narrow-ops/1`],
      ['project settings', `/${locale}/${slug}/projects/narrow-ops/settings`],
      ['cycles', `/${locale}/${slug}/projects/narrow-ops/cycles`],
      ['search', `/${locale}/${slug}/search?q=ត្រួត`],
      ['inbox', `/${locale}/${slug}/inbox`],
      // `/settings` itself is a redirect to this page, so it is the same screen
      // measured twice — and navigating to the redirect's own destination
      // immediately after it aborts the in-flight navigation.
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
      await expectNoSidewaysScroll(page, name);
    }
  });
});
