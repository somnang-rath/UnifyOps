import { expect, test, type Page } from '@playwright/test';
import { readMailbox, resetTokenFrom, waitForMail } from './support/mailbox';

/**
 * §4's Identity row, the "password reset" half.
 *
 * Slice 3 built the token machinery and none of the screens, so this suite is
 * the first thing that proves the two ends are joined. It runs in both locales
 * for the reason §15 gives every primary flow: a reset is the one path a person
 * walks while already locked out and frustrated, and it is the last place Khmer
 * may be the degraded one.
 *
 * The second test is the one that matters most. Everything else here would
 * still pass if the GET consumed the link — and that defect is invisible in
 * development, because no mail scanner sits between a local Next server and a
 * Playwright browser. In production it makes the feature fail for whole
 * companies at once: the ones whose mail gateway vets links.
 */

const PASSWORD = 'a-long-enough-password';
const NEW_PASSWORD = 'an-even-longer-new-password';

type Info = { project: { name: string } };

function unique(prefix: string, testInfo: Info): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

const localeOf = (testInfo: Info) => (testInfo.project.name.includes('km') ? 'km' : 'en');

/** The subject the account's own language produces — `email.passwordReset.subject`. */
const RESET_SUBJECT: Record<string, string> = {
  en: 'Reset your password',
  km: 'កំណត់ពាក្យសម្ងាត់របស់អ្នកឡើងវិញ',
};

async function signUp(page: Page, locale: string, email: string): Promise<void> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Reset Tester');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  // A brand-new account owns no workspace, so §7.1 sends it to name a company.
  // Asserting it here means a later failure is about the reset rather than
  // about a signup that silently did not finish.
  await expect(page).toHaveURL(new RegExp(`/${locale}/new-workspace$`));
}

/** Asks for the link and returns the token out of the message. */
async function requestReset(page: Page, locale: string, email: string): Promise<string> {
  await page.goto(`/${locale}/forgot-password`);
  await page.getByLabel(/^Email|^អ៊ីមែល/).fill(email);
  await page.getByRole('button', { name: /send the link|ផ្ញើតំណ/i }).click();

  // The confirmation replaces the form. Waiting for it rather than for the mail
  // is what makes this a test of the screen; the mailbox poll below is then
  // only about delivery.
  await expect(page.getByText(/a reset link is on its way|កំពុងផ្ញើទៅ/)).toBeVisible();

  const mail = await waitForMail(email, { subjectContains: RESET_SUBJECT[locale] });
  return resetTokenFrom(mail);
}

/**
 * Labels are matched at their *start*, never end-anchored: §12's field shell
 * appends a required marker, so the label element reads "New password*" while
 * the control's accessible name is "New password". A `$` here matches nothing,
 * which is how this spec failed the first time it ran.
 *
 * The leading `^` is still doing work — it is what keeps "New password" from
 * also selecting "Confirm new password".
 */
async function submitNewPassword(page: Page, password: string): Promise<void> {
  await page.getByLabel(/^New password|^ពាក្យសម្ងាត់ថ្មី/).fill(password);
  await page.getByLabel(/^Confirm new password|^បញ្ជាក់ពាក្យសម្ងាត់ថ្មី/).fill(password);
  await page.getByRole('button', { name: /save and sign in|រក្សាទុក រួចចូលគណនី/i }).click();
}

async function signIn(page: Page, locale: string, email: string, password: string): Promise<void> {
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(/^Email|^អ៊ីមែល/).fill(email);
  await page.getByLabel(/^Password|^ពាក្យសម្ងាត់/).fill(password);
  await page.getByRole('button', { name: /^sign in$|^ចូល$/i }).click();
}

test.describe('password reset', () => {
  test('a locked-out person asks for a link, follows it, and signs in with the new password', async ({
    page,
    context,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = `${unique('reset', testInfo)}@example.com`;

    await signUp(page, locale, email);

    // Locked out: the session from signup is gone, exactly as it would be on
    // the phone they are actually holding.
    await context.clearCookies();

    // The entry point. Without this link on the sign-in page the whole feature
    // is unreachable, which is the state slice 3 left it in.
    await page.goto(`/${locale}/sign-in`);
    await page.getByRole('link', { name: /forgot your password|ភ្លេចពាក្យសម្ងាត់/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/forgot-password$`));

    const token = await requestReset(page, locale, email);

    await page.goto(`/${locale}/reset/${token}`);
    await submitNewPassword(page, NEW_PASSWORD);

    // Signed in and delivered somewhere real, rather than dropped back on the
    // sign-in form to type the password they have just chosen.
    await expect(page).toHaveURL(new RegExp(`/${locale}/new-workspace$`));

    // The point of the whole exercise: the old password is dead.
    await context.clearCookies();
    await signIn(page, locale, email, PASSWORD);
    await expect(page.getByText(/do not match|មិនត្រូវគ្នា/)).toBeVisible();

    await signIn(page, locale, email, NEW_PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/${locale}/new-workspace$`));
  });

  test('the link is spent by the form, not by opening it', async ({ page, context }, testInfo) => {
    const locale = localeOf(testInfo);
    const email = `${unique('scan', testInfo)}@example.com`;

    await signUp(page, locale, email);
    await context.clearCookies();

    const token = await requestReset(page, locale, email);

    // Three GETs, standing in for the mail gateway, the preview pane and the
    // person. Every one of them must still find a usable form: a link vetted by
    // a corporate scanner before it reaches the inbox is the common case in
    // exactly the market §2.5 describes, not an edge one.
    for (let visit = 0; visit < 3; visit += 1) {
      await page.goto(`/${locale}/reset/${token}`);
      await expect(page.getByLabel(/^New password|^ពាក្យសម្ងាត់ថ្មី/)).toBeVisible();
    }

    await submitNewPassword(page, NEW_PASSWORD);
    await expect(page).toHaveURL(new RegExp(`/${locale}/new-workspace$`));

    // And now — only now — it is spent. A one-time link that survives its own
    // use is a standing key to the account, sitting in an inbox.
    await context.clearCookies();
    await page.goto(`/${locale}/reset/${token}`);
    await expect(page.getByText(/already been used|ត្រូវបានប្រើរួចហើយ/)).toBeVisible();
    await expect(page.getByLabel(/^New password|^ពាក្យសម្ងាត់ថ្មី/)).toHaveCount(0);
  });

  test('an address with no account gets the same answer and no email', async ({
    page,
  }, testInfo) => {
    const locale = localeOf(testInfo);
    const stranger = `${unique('nobody', testInfo)}@example.com`;

    await page.goto(`/${locale}/forgot-password`);
    await page.getByLabel(/^Email|^អ៊ីមែល/).fill(stranger);
    await page.getByRole('button', { name: /send the link|ផ្ញើតំណ/i }).click();

    // Word for word the confirmation a real account gets. Anything else here —
    // a different tone, an extra sentence, a "we could not find that address" —
    // turns this form into an account enumerator, which is the one thing
    // `signIn` already spends 150ms of dummy hashing to prevent.
    await expect(page.getByText(/a reset link is on its way|កំពុងផ្ញើទៅ/)).toBeVisible();

    // The mailbox is append-only for the run, so this is a real assertion
    // rather than a snapshot: nothing was ever sent to that address.
    const mailbox = await readMailbox();
    expect(mailbox.filter((m) => m.to.toLowerCase() === stranger.toLowerCase())).toEqual([]);
  });

  test('a mangled link explains itself instead of showing a form', async ({ page }, testInfo) => {
    const locale = localeOf(testInfo);

    // Shaped like a token — 43 base64url characters — so this exercises the
    // lookup rather than the route matcher.
    await page.goto(`/${locale}/reset/${'x'.repeat(43)}`);

    await expect(page.getByText(/is not valid|មិនត្រឹមត្រូវទេ/)).toBeVisible();
    await expect(page.getByLabel(/^New password|^ពាក្យសម្ងាត់ថ្មី/)).toHaveCount(0);

    // Not a dead end (§11): the one thing left to do is on screen.
    await page.getByRole('link', { name: /request a new link|សុំតំណថ្មី/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/forgot-password$`));
  });
});
