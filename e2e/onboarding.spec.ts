import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 16:
 *
 *   "Onboarding, empty/error states, a11y, responsive + **install** pass —
 *    First-run under 3 minutes with a real stranger; the app installs to a
 *    phone home screen."
 *
 * A stranger and a stopwatch are §15-1's manual check and stay manual. What is
 * automatable is the thing that made the manual check fail before this slice:
 * §7.1's path did not join up. Signing up reached the invite step and stopped
 * there — Skip and a successful send both went to My Work, with no project, no
 * board, and nothing focused. The first tests below are that chain, end to end,
 * in both languages.
 *
 * The rest are the three passes §14 names beside onboarding: the five states
 * (a translated 404, and an empty group that is a live input), the
 * accessibility baseline, and §15-8's install manifest. The 390px responsive
 * check lives in `responsive.spec.ts`, because it is one assertion asked of
 * every screen rather than a flow.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

/** Signs up and creates a company, stopping where §7.1's step 2 begins. */
async function signUpAndCreateCompany(
  page: Page,
  locale: string,
  testInfo: { project: { name: string } },
): Promise<string> {
  const company = unique('Onboard', testInfo);

  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('First Runner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(`${unique('runner', testInfo)}@example.com`);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));
  return slug;
}

test.describe('§7.1 — sign up to first task', () => {
  test('skipping the invite step still reaches the board with the composer focused', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';

    const slug = await signUpAndCreateCompany(page, locale, testInfo);

    // §7.1 marks the path as finite. A stranger three screens in with no idea
    // how many remain is §15-1's actual failure mode.
    await expect(page.getByText(/step 2 of 3|ជំហានទី 2/i)).toBeVisible();

    // §7.1: "Skip is visually equal to Send" — same row, same height, a real
    // control rather than a quiet link under the button.
    const skip = page.getByRole('link', { name: /skip for now|រំលងសិន/i });
    const send = page.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i });
    const skipBox = await skip.boundingBox();
    const sendBox = await send.boundingBox();
    expect(Math.abs(skipBox!.height - sendBox!.height)).toBeLessThanOrEqual(1);

    // **The step that did not exist before this slice.** Skip used to land on
    // My Work, which for a workspace with no project is an empty screen with
    // nothing to do on it — the opposite of a three-minute first run.
    await skip.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/new[?]onboarding=1$`));
    await expect(page.getByText(/step 3 of 3|ជំហានទី 3/i)).toBeVisible();

    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Depot Rollout');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();

    // §7.1's landing: the **board**, six default states drawn, first task input
    // already focused. All three, because all three are the sentence.
    await expect(page).toHaveURL(
      new RegExp(`/${locale}/${slug}/projects/depot-rollout[?]view=board&new=1$`),
    );
    await expect(page.getByRole('region')).toHaveCount(6);

    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await expect(addTask).toBeFocused();

    // §7.2's five-second target, from the state §7.1 leaves the person in:
    // type, Enter, and the item is in the first column with the input still
    // focused and empty for the next one.
    await addTask.fill('Survey the Kandal site');
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: 'Survey the Kandal site' })).toBeVisible();
    await expect(addTask).toHaveValue('');
    await expect(addTask).toBeFocused();
  });

  test('sending invitations offers the way onward rather than ending on its own summary', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const slug = await signUpAndCreateCompany(page, locale, testInfo);

    await page
      .getByLabel(/email addresses|អាសយដ្ឋានអ៊ីមែល/i)
      .fill(`${unique('mate', testInfo)}@example.com`);
    await page.getByRole('button', { name: /send invitations|ផ្ញើលិខិតអញ្ជើញ/i }).click();

    // §7.10 refuses to roll a batch back, so the per-address summary is the
    // result — and until slice 16 it was also a dead end.
    const onward = page.getByRole('link', { name: /first project|គម្រោងដំបូង/i });
    await expect(onward).toBeVisible();
    await onward.click();

    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/new[?]onboarding=1$`));
  });

  test('the step marker is absent when the same form is not part of a first run', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const slug = await signUpAndCreateCompany(page, locale, testInfo);

    // Somebody creating their fourth project in March is not on step 3 of
    // anything, and the same route serves both.
    await page.goto(`/${locale}/${slug}/projects/new`);
    await expect(page.getByText(/step 3 of 3|ជំហានទី 3/i)).toHaveCount(0);
  });
});

test.describe('§11 — the five states', () => {
  test('a 404 is a translated page, not the framework default', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    await signUpAndCreateCompany(page, locale, testInfo);

    // §15-2's check, from the other side: a workspace this session is not a
    // member of must 404 rather than show an empty page — and the 404 must be
    // in the reader's language (§13).
    const response = await page.goto(`/${locale}/not-a-real-company`);
    expect(response?.status()).toBe(404);

    await expect(
      page.getByRole('heading', { name: /nothing here|គ្មានអ្វីនៅទីនេះ/i }),
    ).toBeVisible();

    // It offers the way back rather than leaving somebody on a dead page.
    await page.getByRole('link', { name: /workspace|កន្លែងធ្វើការ/i }).click();
    await expect(page).not.toHaveURL(/not-a-real-company/);
  });

  test('the empty state of a group is the focused input itself', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const slug = await signUpAndCreateCompany(page, locale, testInfo);

    await page.goto(`/${locale}/${slug}/projects/new`);
    await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Empty States');
    await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();

    // §7.1: "`[E]` the focused input *is* the empty state." So a column with
    // no cards still carries a live composer — never a shrug.
    await expect(page.getByLabel(/add a task|បន្ថែមការងារ/i)).toHaveCount(6);
  });
});

test.describe('§11 — the accessibility baseline', () => {
  test('the first tab stop skips the shell and lands in the page', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const slug = await signUpAndCreateCompany(page, locale, testInfo);
    await page.goto(`/${locale}/${slug}`);

    // The workspace header is eleven tab stops deep. Without a skip link,
    // every navigation in the product costs all of them again.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to content|រំលងទៅមាតិកា/i });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await skip.press('Enter');
    // Focus is *moved*, not merely scrolled — which is what `tabIndex={-1}` on
    // the landmark buys, and what a bare `href="#main"` does not do in every
    // browser.
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('every icon-only control in the shell has an accessible name', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    const slug = await signUpAndCreateCompany(page, locale, testInfo);
    await page.goto(`/${locale}/${slug}`);

    // §11: "every icon-only control has an accessible name." Asserted over
    // whatever the shell happens to contain rather than over a list, so a
    // control added in a later slice is inside the check by default.
    const unnamed = await page.evaluate(() => {
      const named = (el: Element) =>
        (el.getAttribute('aria-label') ?? '').trim() !== '' ||
        (el.getAttribute('title') ?? '').trim() !== '' ||
        el.getAttribute('aria-labelledby') !== null ||
        (el.textContent ?? '').trim() !== '';
      return [...document.querySelectorAll('header button, header a')]
        .filter((el) => !named(el))
        .map((el) => el.outerHTML.slice(0, 140));
    });
    expect(unnamed).toEqual([]);
  });
});

test.describe('§15-8 — install', () => {
  test('the manifest is per-locale, standalone, and scoped to the language it was installed from', async ({
    page,
    request,
  }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';

    // The document declares its own locale's manifest, which is the half that
    // makes "in both locales" (§15-8) true rather than accidental.
    await page.goto(`/${locale}`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      `/${locale}/manifest.webmanifest`,
    );

    const response = await request.get(`/${locale}/manifest.webmanifest`);
    expect(response.status()).toBe(200);
    const manifest = await response.json();

    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe(locale);
    expect(manifest.scope).toBe(`/${locale}`);
    expect(manifest.start_url).toBe(`/${locale}/workspaces`);
    expect(manifest.id).toBe(`/${locale}`);
    expect(manifest.name).toBe('UnifyOps');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);

    // The one part of §15-8 that is not built: the icon set needs the parent
    // Unify mark, which is not in the repo, and CLAUDE.md's rule is to ask
    // rather than substitute. `icons` is therefore empty *and valid* — the
    // assertion is here so that the day it stops being empty, somebody has to
    // come and change this line on purpose.
    expect(manifest.icons).toEqual([]);
  });

  test('the theme colour follows the palette in both schemes', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.startsWith('km') ? 'km' : 'en';
    await page.goto(`/${locale}`);

    // Two metas, media-queried. One value would leave a pale bar above a dark
    // app — the one seam an installed app cannot hide.
    const metas = page.locator('meta[name="theme-color"]');
    await expect(metas).toHaveCount(2);
    await expect(metas.first()).toHaveAttribute('media', /prefers-color-scheme/);
  });
});
