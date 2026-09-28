import { expect, test } from '@playwright/test';
import { fixtures } from './fixtures';
import { ok, openTable } from './live';

/**
 * The live tutor speaks to the player's level as the server has tallied it,
 * not a count this phone kept, and the tutor toggle is remembered per phone.
 */
test.describe('levels at a live table', () => {
  test('(a) a first-timer and a regular at the same turn hear different things', async ({ page, browser }) => {
    const fx = fixtures();
    await openTable(page, { view: () => ok(fx.newTurn) });
    const other = await browser.newContext();
    const regular = await other.newPage();
    await openTable(regular, { view: () => ok(fx.solidTurn) });

    const coach = page.locator('.coach:visible').first();
    const theirs = regular.locator('.coach:visible').first();
    await expect(coach).toBeVisible();
    await expect(theirs).toBeVisible();
    expect(await coach.innerText()).not.toBe(await theirs.innerText());
    await other.close();
  });

  test('(b) turning the tutor off survives a reload', async ({ page }) => {
    const fx = fixtures();
    await openTable(page, { view: () => ok(fx.turn) });
    const chip = page.getByRole('button', { name: /^Tutor (on|off)$/ }).first();
    await expect(chip).toHaveText('Tutor on');
    await chip.click();
    await expect(chip).toHaveText('Tutor off');
    await page.reload();
    await expect(page.getByRole('button', { name: /^Tutor (on|off)$/ }).first()).toHaveText('Tutor off');
  });

  test('(c) the toggle still works for the visit when storage refuses it', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (e) => errors.push(e));
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem;
      const set = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key: string) {
        if (key === 'sm:tutor') throw new Error('SecurityError');
        return get.call(this, key);
      };
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'sm:tutor') throw new Error('QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    const fx = fixtures();
    await openTable(page, { view: () => ok(fx.turn) });
    const chip = page.getByRole('button', { name: /^Tutor (on|off)$/ }).first();
    await expect(chip).toHaveText('Tutor on');
    await chip.click();
    await expect(chip).toHaveText('Tutor off');
    expect(errors).toEqual([]);
  });
});
