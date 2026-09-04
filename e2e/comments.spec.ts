import { expect, test, type Page } from '@playwright/test';

/**
 * §14's definition of done for slice 8:
 *
 *   "Comments, mentions, attachments — Full collaboration loop on one item."
 *
 * What is under test here is the conversation half of that loop: write a
 * comment, mention somebody from the `@` picker, read it back under their
 * *current* name, and retract it. Files have their own spec
 * (`attachments.spec.ts`), including the one that rides along with a comment.
 *
 * The mention is the part worth driving through a real browser. It is three
 * mechanisms that have to agree — a caret-anchored picker in the composer, a
 * token stored in place of a name, and a renderer that resolves the token back
 * — and each one passes its own unit test while disagreeing with the other two.
 * A raw `@[0192…]` on screen is what that failure looks like, and only this
 * catches it.
 *
 * Run in `en` and `km` (§15). Not a formality: every label here is a catalogue
 * key resolved at render, so a missing Khmer string surfaces as `comments.post`
 * on screen and nowhere else.
 */

const PASSWORD = 'a-long-enough-password';
const OWNER = 'Comment Owner';

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

  return { slug, projectSlug: 'field-ops' };
}

test.describe('comments and mentions', () => {
  test('posts a comment with a mention, renders the name, and retracts it', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Talk', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill('Ship the invoice export');
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: 'Ship the invoice export' })).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}/1`);

    const thread = page.getByRole('region', { name: /^(comments|មតិយោបល់)$/i });

    // §11 `[E]`: an item nobody has commented on says so, and shows the box
    // that fixes it rather than an empty panel.
    await expect(thread).toContainText(/no comments yet|មិនទាន់មានមតិយោបល់ទេ/i);

    const box = page.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);
    await box.click();
    await box.pressSequentially('Please take a look ');

    // The `@` opens the picker at the caret. Everything after this is keyboard
    // only — §11's mouse-free loop is a requirement, not an enhancement.
    await box.pressSequentially('@');
    const picker = page.getByRole('listbox');
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(OWNER);

    // Enter takes the highlighted person while the picker is open. With it
    // closed the same key is a newline, which is asserted below by the fact
    // that the rest of the sentence types normally.
    await box.press('Enter');
    await expect(picker).toBeHidden();

    // What is *stored* is a token, never a name (§13). The composer holds it
    // verbatim, so this is the one place the token is legitimately on screen.
    await expect(box).toHaveValue(/@\[[0-9a-f-]{36}\] $/);

    await box.pressSequentially('when you get a chance');
    await page.getByRole('button', { name: /^(post|ផ្សាយ)$/i }).click();

    // The comment comes back rendered: the token resolved to the person's
    // current name, and the box cleared because the post succeeded.
    await expect(thread).toContainText('Please take a look');
    await expect(thread).toContainText('when you get a chance');
    await expect(thread).toContainText(`@${OWNER}`);
    await expect(box).toHaveValue('');

    // The failure this test exists for: a token that reached the screen.
    await expect(thread).not.toContainText('@[');

    // Nothing here is a message key that escaped a catalogue (§15-4).
    await expect(thread).not.toContainText('comments.');

    // §10: the author may retract their own. Soft, so the thread keeps the
    // place rather than closing over it.
    //
    // Scoped to the thread: the item editor above has its own Delete, and an
    // unscoped match would remove the work item instead of the comment.
    await thread.getByRole('button', { name: /delete|លុប/i }).first().click();
    await expect(thread).toContainText(/this comment was deleted|មតិយោបល់នេះត្រូវបានលុប/i);
    await expect(thread).not.toContainText('when you get a chance');
  });

  test('keeps typed text when a post is refused', async ({ page }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const { slug, projectSlug } = await newProject(
      page,
      locale,
      unique('Keep', testInfo),
      `${unique('owner', testInfo)}@example.com`,
    );

    const addTask = page.getByLabel(/add a task|បន្ថែមការងារ/i).first();
    await addTask.fill('Ship the invoice export');
    await addTask.press('Enter');
    await expect(page.getByRole('link', { name: 'Ship the invoice export' })).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/${projectSlug}/1`);

    const box = page.getByLabel(/add a comment|បន្ថែមមតិយោបល់/i);

    /**
     * §7.7's emphatic rule: "post fails → draft retained in the box, retry
     * button. **Never lose typed text.**"
     *
     * The refusal is provoked with a hand-typed mention token naming a member
     * id that exists nowhere — which is exactly the backstop case the picker is
     * meant to make unreachable, and the cheapest way to make the server say no
     * without breaking the session.
     */
    const typed = 'Ping @[00000000-0000-7000-8000-000000000000] about this';
    await box.fill(typed);
    await page.getByRole('button', { name: /^(post|ផ្សាយ)$/i }).click();

    // Scoped to the thread: Next's route announcer is also `role="alert"`.
    const thread = page.getByRole('region', { name: /^(comments|មតិយោបល់)$/i });
    const alert = thread.getByRole('alert');
    await expect(alert).toBeVisible();

    // The text is still there, and the retry button §7.7 asks for is beside it.
    await expect(box).toHaveValue(typed);
    await expect(alert.getByRole('button', { name: /retry|ព្យាយាមម្ដងទៀត/i })).toBeVisible();
    await expect(alert).not.toContainText('comments.');
  });
});
