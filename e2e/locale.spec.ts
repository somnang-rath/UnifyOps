import { expect, test } from '@playwright/test';

const locales = ['en', 'km'] as const;

test.describe('locale routing', () => {
  test('the bare root redirects to a prefixed URL', async ({ page }) => {
    await page.goto('/');
    // §13: localePrefix 'always' — there is no unprefixed default locale.
    await expect(page).toHaveURL(/\/(en|km)$/);
  });

  for (const locale of locales) {
    test(`${locale} renders and marks its language`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test(`${locale} shows no untranslated keys`, async ({ page }) => {
      await page.goto(`/${locale}`);
      const body = (await page.locator('body').innerText()).trim();
      // A missing message renders as its dotted key path.
      expect(body).not.toMatch(/\b[a-z]+\.[a-zA-Z]+\b(?![a-zA-Z]*\.(com|org|io))/);
    });
  }

  test('km uses Latin digits, not Khmer numerals', async ({ page }) => {
    await page.goto('/km');
    // §13: numberingSystem 'latn' is pinned; ០១២៣ must never reach the UI.
    await expect(page.locator('body')).not.toContainText(/[០-៩]/);
  });

  test('the switcher moves between locales and keeps the path', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('combobox').selectOption('km');
    await expect(page).toHaveURL(/\/km$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'km');
  });
});
