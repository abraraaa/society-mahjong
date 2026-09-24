import { expect, test, type Route } from '@playwright/test';
import { stayLocal } from './live';

test.beforeEach(async ({ page }) => {
  await stayLocal(page);
});

test('(f) the name gate keeps a name typed before the page has loaded its scripts', async ({ page }) => {
  // Hold every script chunk, so the server's HTML is on screen with nothing listening to it.
  const held: Route[] = [];
  let holding = true;
  await page.route('**/_next/static/chunks/**', (route) => {
    if (holding && route.request().resourceType() === 'script') held.push(route);
    else void route.continue();
  });

  await page.goto('/room', { waitUntil: 'commit' });
  const input = page.getByPlaceholder('Your name');
  const sitDown = page.getByRole('button', { name: 'Sit down' });
  await input.pressSequentially('Amna');
  await expect(input).toHaveValue('Amna');
  // Typed into the server's HTML: no script had run.
  expect(held.length).toBeGreaterThan(0);
  await expect(sitDown).toBeDisabled();

  holding = false;
  for (const route of held.splice(0)) await route.continue();
  await page.waitForLoadState('networkidle');

  // Live now, and it heard the name that was already in the box.
  await expect(sitDown).toBeEnabled();
  await expect(input).toHaveValue('Amna');
});
