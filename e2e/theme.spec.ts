import { expect, test } from '@playwright/test';

/**
 * §12: "Dark mode is a second token set, not a rewrite." These tests assert
 * the token layer actually flips — a component that hard-codes a light-mode
 * colour still renders, so only comparing computed styles catches it.
 */
test.describe('theme', () => {
  test('defaults to system and exposes all three choices', async ({ page }) => {
    await page.goto('/en');
    const group = page.getByRole('radiogroup');
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(3);
    // Every icon-only control has an accessible name (§11).
    for (const name of ['Light', 'Dark', 'System']) {
      await expect(group.getByRole('radio', { name })).toBeVisible();
    }
  });

  test('dark puts .dark on <html> and repaints the background', async ({ page }) => {
    await page.goto('/en');
    const bodyBg = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const light = await bodyBg();

    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const dark = await bodyBg();

    expect(dark).not.toBe(light);
  });

  test('every semantic surface moves, not just the background', async ({ page }) => {
    await page.goto('/en');
    const sample = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.body);
        const chip = document.querySelector('section span');
        const c = chip ? getComputedStyle(chip) : null;
        return {
          bg: s.backgroundColor,
          text: s.color,
          chipBg: c?.backgroundColor ?? '',
          chipBorder: c?.borderTopColor ?? '',
        };
      });

    await page.getByRole('radio', { name: 'Light' }).click();
    const light = await sample();
    await page.getByRole('radio', { name: 'Dark' }).click();
    const dark = await sample();

    for (const key of ['bg', 'text', 'chipBg', 'chipBorder'] as const) {
      expect(dark[key], `${key} should differ between themes`).not.toBe(light[key]);
    }
  });

  test('the choice survives a reload', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    // No flash: the class is set by next-themes' inline script before paint.
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('the toggle is labelled in Khmer too', async ({ page }) => {
    await page.goto('/km');
    await expect(page.getByRole('radiogroup')).toHaveAttribute('aria-label', 'រូបរាង');
    await expect(page.getByRole('radio', { name: 'ងងឹត' })).toBeVisible();
  });
});
