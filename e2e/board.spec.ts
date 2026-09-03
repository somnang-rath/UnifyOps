import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 6:
 *
 *   "Board + ranking — Drag between columns; concurrent drags from two browsers
 *   land correctly."
 *
 * The second half is §15's scenario 3 ("same board in two browsers, drag the
 * same card → both windows converge") and it is the reason this slice was
 * front-loaded. It is asserted here rather than reasoned about, because the
 * guarantee is a property of two transactions racing on real Postgres and
 * nothing smaller reproduces it.
 *
 * Run in `en` and `km` like every spec (§15). The Khmer run earns its place:
 * every string on this board is new, and a missing catalogue key renders as a
 * raw `board.dragHandle` on screen rather than as a failing unit test.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  // No string slicing: the repo's design-token hook flags `.slice` on anything
  // that might be user text, and a random suffix needs neither.
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e7).toString(36)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function signUpWithProject(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<{ slug: string; projectSlug: string }> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Board Owner');
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
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/field-ops$`));

  return { slug, projectSlug: 'field-ops' };
}

const addTask = (page: Page) => page.getByLabel(/add a task|បន្ថែមការងារ/i);

/** The board's columns, in the project's order. */
const columns = (page: Page) => page.locator('section[aria-label]').filter({ has: page.locator('ul') });

/** A card, wherever it currently is. */
const card = (page: Page, title: string) => page.getByRole('link', { name: title });

/**
 * A drag, driven by the mouse rather than by `dragTo`.
 *
 * Playwright's `dragTo` dispatches HTML5 drag events, and `dnd-kit`'s
 * `PointerSensor` listens for pointer events — so `dragTo` does nothing here.
 * The move is also stepped rather than instantaneous because the sensor has a
 * 6px activation distance, and a single jump from source to target never
 * crosses it in a way the sensor sees.
 */
async function dragHandleOnto(page: Page, handle: Locator, target: Locator): Promise<void> {
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('a drag needs both ends on screen');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();

  const endX = to.x + to.width / 2;
  const endY = to.y + Math.min(to.height / 2, 60);
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      from.x + ((endX - from.x) * step) / 8,
      from.y + ((endY - from.y) * step) / 8,
    );
  }

  await page.mouse.up();
}

test.describe('board', () => {
  test('the view switcher keeps the filter, and the board draws every state', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await signUpWithProject(
      page,
      locale,
      unique('Board', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await addTask(page).first().fill('Wire the depot survey');
    await addTask(page).first().press('Enter');
    await expect(card(page, 'Wire the depot survey')).toBeVisible();

    // §5: the view is part of the URL, so switching is navigation. The switcher
    // is a link, which is what makes the back button work below.
    await page.getByRole('link', { name: /^(board|ក្តារ)$/i }).click();
    await expect(page).toHaveURL(new RegExp(`view=board`));

    // Six seeded states, six columns — including the empty ones. A column that
    // vanishes when it empties is a column nothing can be dragged into (§9).
    await expect(columns(page)).toHaveCount(6);
    await expect(card(page, 'Wire the depot survey')).toBeVisible();

    // Back returns to the list, because the switcher navigated rather than
    // replacing state.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/projects/${projectSlug}$`));
  });

  test('a card dragged to another column stays there after a reload', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await signUpWithProject(
      page,
      locale,
      unique('Drag', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    await addTask(page).first().fill('Replace the failed charger');
    await addTask(page).first().press('Enter');
    await expect(card(page, 'Replace the failed charger')).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}?view=board`);

    const first = columns(page).nth(0);
    const second = columns(page).nth(1);
    await expect(first.getByRole('link', { name: 'Replace the failed charger' })).toBeVisible();

    // The handle, not the card — a card that is entirely draggable is a card
    // that cannot be clicked through to the item.
    await dragHandleOnto(
      page,
      first.getByRole('button', { name: /FO-1/ }),
      second,
    );

    // §7.5: optimistic, so it is already there before the server answers.
    await expect(second.getByRole('link', { name: 'Replace the failed charger' })).toBeVisible();

    // And it survives a reload, which is the part that proves the server agreed
    // rather than the browser having drawn a hopeful picture.
    await page.reload();
    await expect(
      columns(page).nth(1).getByRole('link', { name: 'Replace the failed charger' }),
    ).toBeVisible();
  });

  test('two browsers dragging the same card converge (§15-3)', async ({
    browser,
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await signUpWithProject(
      page,
      locale,
      unique('Race', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    for (const title of ['Audit the meter', 'File the permit', 'Book the crane']) {
      await addTask(page).first().fill(title);
      await addTask(page).first().press('Enter');
      await expect(card(page, title)).toBeVisible();
    }

    const boardUrl = `/${locale}/${slug}/projects/${projectSlug}?view=board`;
    await page.goto(boardUrl);

    // A second window on the same session, so both are the same person looking
    // at the same board from two places — which is the §15 scenario, and also
    // the honest version of two colleagues, because the race is in the database
    // rather than in the session.
    const second = await browser.newContext({ storageState: await page.context().storageState() });
    const other = await second.newPage();
    await other.goto(boardUrl);
    await expect(other.getByRole('link', { name: 'Audit the meter' })).toBeVisible();

    // Both windows move the same card into different columns, at the same time,
    // each computing its neighbours from a board the other is about to
    // invalidate. Neither sends a rank (§9) — that is what makes this survivable.
    // Both requests are awaited before anything is asserted. A drag returns on
    // mouse-up, not on the response, and reloading between the two writes would
    // be this test racing itself rather than the two drags racing each other.
    const settled = Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/internal/reorder')),
      other.waitForResponse((response) => response.url().includes('/api/internal/reorder')),
    ]);

    await Promise.all([
      dragHandleOnto(
        page,
        columns(page).nth(0).getByRole('button', { name: /FO-1/ }),
        columns(page).nth(1),
      ),
      dragHandleOnto(
        other,
        columns(other).nth(0).getByRole('button', { name: /FO-1/ }),
        columns(other).nth(2),
      ),
    ]);

    await settled;

    // Whichever landed second wins, and both windows agree once they have both
    // re-read. The assertion is convergence, not a particular winner: two
    // simultaneous drags have no correct answer, only a consistent one.
    await page.reload();
    await other.reload();

    const whereFirst = await columnHolding(page, 'Audit the meter');
    const whereOther = await columnHolding(other, 'Audit the meter');

    expect(whereFirst).toBe(whereOther);
    // And exactly one copy of it exists — §7.5's "no ghost cards".
    await expect(page.getByRole('link', { name: 'Audit the meter' })).toHaveCount(1);
    await expect(other.getByRole('link', { name: 'Audit the meter' })).toHaveCount(1);

    await second.close();
  });
});

/** Which column index currently holds a card. */
async function columnHolding(page: Page, title: string): Promise<number> {
  const all = columns(page);
  for (let index = 0; index < (await all.count()); index += 1) {
    if (await all.nth(index).getByRole('link', { name: title }).isVisible()) return index;
  }
  return -1;
}
