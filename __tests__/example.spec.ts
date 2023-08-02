import fs from 'fs';

import { test, expect } from '@playwright/test';

test.describe('metrics tests', () => {
  try {
    fs.unlinkSync('metrics.txt');
  } catch (error) {
    // Ignore error
  }

  test('has title', async ({ page }) => {
    await page.goto('https://playwright.dev/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Playwright/);
  });

  test('get started link', async ({ page }) => {
    await page.goto('https://playwright.dev/');

    // Click the get started link.
    await page.getByRole('link', { name: 'Get started' }).click();

    // Expects the URL to contain intro.
    await expect(page).toHaveURL(/.*intro/);
  });
});
