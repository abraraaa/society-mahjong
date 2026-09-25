import { expect, test } from '@playwright/test';
import { stayLocal } from './live';

test.beforeEach(async ({ page }) => {
  await stayLocal(page);
});

test('(h) a made-up invite link says there is no table, and never repeats what was in the address', async ({ page }) => {
  await page.goto('/r/FREE-MONEY');
  await expect(page.getByRole('heading', { name: "There's no table with that code." })).toBeVisible();
  await expect(page.getByText('Join a table', { exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('FREE-MONEY', { ignoreCase: true });
  // Said before any name is asked for.
  await expect(page.getByRole('heading', { name: 'What should the table call you?' })).toHaveCount(0);
});

test('(h) an address with nothing at it is a 404 with a way back', async ({ page }) => {
  const res = await page.goto('/this-page-does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: "There's nothing at this address." })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Host a table' })).toHaveAttribute('href', '/room');
  await expect(page.getByRole('link', { name: 'Society Mahjong home' })).toHaveAttribute('href', '/');
  await expect(page).toHaveTitle(/Page not found/);
});
