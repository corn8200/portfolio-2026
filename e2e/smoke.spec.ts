import { test, expect } from '@playwright/test';

test.describe('smoke', () => {
  test('home renders positioning, agent, proof, and nav', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/John Cornelius/);
    await expect(page.locator('h1', { hasText: 'John Cornelius' })).toBeVisible();
    await expect(page.locator('[data-agent]')).toBeVisible();
    await expect(page.locator('[data-agent-input]')).toBeVisible();
    for (const proof of ['9 plants', '20 yr', '2 promotions']) {
      await expect(page.locator('body')).toContainText(proof);
    }
    for (const label of ['Home', 'Talk', 'CV', 'Work', 'Contact']) {
      await expect(page.locator(`nav >> text=${label}`)).toBeVisible();
    }
  });

  test('skip link reaches main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    await skip.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('home does not mount the old decorative canvas', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#bg-canvas')).toHaveCount(0);
  });

  test('work index lists career records and omits education row', async ({ page }) => {
    await page.goto('/work');
    const rows = page.locator('.proj-row');
    await expect(rows).toHaveCount(4, { timeout: 4000 });
    await expect(page.locator('.proj-row', { hasText: 'Education' })).toHaveCount(0);
    await expect(page.locator('.proj-row', { hasText: 'Overseer Personal Ops Control Plane' })).toHaveCount(1);
  });

  test('a project dossier loads', async ({ page }) => {
    await page.goto('/work');
    const first = page.locator('.proj-row__a').first();
    await first.click();
    await expect(page.locator('main h1').first()).toBeVisible();
  });

  test('agent text mode accepts input', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('[data-agent-input]');
    await input.fill('What is Overseer?');
    await expect(input).toHaveValue('What is Overseer?');
  });

  test('reduced motion: hero canvas does not infinite-loop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForTimeout(600);
    // The interview-grade home keeps the agent and proof strip front-and-center.
    const present = await page.evaluate(() => !!document.getElementById('bg-canvas'));
    expect(present).toBe(false);
  });
});
