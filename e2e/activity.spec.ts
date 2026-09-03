import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 7:
 *
 *   "Events + activity + unit of work — Every change appears in the activity
 *   feed automatically."
 *
 * "Automatically" is the word under test. Nothing in `work-items.ts` writes a
 * feed row; the service emits an event and the registry decides. So this drives
 * three ordinary edits through the ordinary UI and asserts the history appeared
 * on its own — which is also the only way to catch a projector that compiles,
 * passes its unit test, and never reaches the database because the flush was
 * wired to the wrong sink.
 *
 * Run in `en` and `km` (§15). Not a formality: every line of this feed is a
 * sentence assembled from a catalogue key at render time, so a missing Khmer
 * string shows up here as `activity.stateChanged` on screen and nowhere else.
 */

const PASSWORD = 'a-long-enough-password';

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function newProject(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<{ slug: string; projectSlug: string }> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Feed Owner');
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

test.describe('the activity feed', () => {
  test('records a creation, an edit and a state change, without being asked', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Feed', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill('Ship the invoice export');
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: 'Ship the invoice export' })).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}/1`);

    const feed = page.getByRole('region', { name: /^(activity|សកម្មភាព)$/i });

    // The line every item's history opens with, written by the create it was
    // never told about.
    await expect(feed).toContainText(/created this item|បានបង្កើតកិច្ចការនេះ/);
    await expect(feed).toContainText('Feed Owner');

    // An ordinary edit. §8 asks for one line per field that actually moved, so
    // this is the priority line and not "edited this item".
    await page.getByLabel(/^(priority|អាទិភាព)$/i).selectOption('urgent');
    await page.getByRole('button', { name: /^(save|រក្សាទុក)$/i }).first().click();
    await expect(page.getByLabel(/^(priority|អាទិភាព)$/i)).toHaveValue('urgent');

    await expect(feed).toContainText(/changed the priority|បានប្តូរអាទិភាព/);

    // A state change, which is the one edit that names two things the feed has
    // to resolve back into names — and the seeded ones are translated, so the
    // Khmer run is asserting the §13 rule as well as the projector.
    const stateSelect = page.getByRole('combobox', { name: /FO-1/ });
    const options = await stateSelect.locator('option').all();
    const target = await options[1]!.getAttribute('value');
    const targetName = (await options[1]!.textContent())!.trim();
    await stateSelect.selectOption(target!);

    // The select disables itself while the transition is in flight (see
    // `state-select.tsx`), so waiting for it to come back is what makes the
    // navigation below assert a committed write rather than race it. Without
    // this, `goto` can abort the server action mid-flight — which shows up in
    // the server log as "The destination stream closed early" and here as a
    // state change that silently did not happen.
    await expect(stateSelect).toBeEnabled();

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}/1`);
    await expect(feed).toContainText(/moved this from|បានផ្លាស់ទីពី/);
    await expect(feed).toContainText(targetName);

    // Nothing here is a message key that escaped a catalogue (§15-4).
    await expect(feed).not.toContainText('activity.');
  });
});
