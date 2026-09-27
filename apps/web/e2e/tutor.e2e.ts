import { expect, test, type Page } from '@playwright/test';
import { stayLocal } from './live';

/**
 * The plan strip on the solo table: the player's nearest winning hand, laid
 * out above their tiles. It holds one height so the table never jumps, the
 * table never scrolls, and it fades exactly as many tiles as its caption says
 * are still to go.
 */
async function strip(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector('.table-stage .plan-strip') as HTMLElement | null;
    const stage = document.querySelector('.table-stage') as HTMLElement;
    const caption = s?.querySelector('.plan-count')?.textContent ?? '';
    return {
      height: s ? s.getBoundingClientRect().height : null,
      scrolls: stage.scrollHeight - stage.clientHeight,
      toGo: /(\d+) tiles? to go/.exec(caption)?.[1] ?? (caption.includes('complete') ? '0' : null),
      faded: s ? s.querySelectorAll('.tile[data-dim="true"]').length : 0,
    };
  });
}

for (const [width, height] of [
  [390, 844],
  [393, 660],
] as const) {
  test(`(t) the plan strip keeps its height and its count at ${width}x${height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height });
    await stayLocal(page);
    await page.goto('/play/solo');
    await expect(page.locator('.table-stage .plan-strip')).toBeVisible();

    const heights = new Set<number>();
    for (let turn = 0; turn < 8; turn++) {
      await page.waitForTimeout(700);
      const s = await strip(page);
      expect(s.scrolls).toBeLessThanOrEqual(0);
      if (s.height !== null) heights.add(Math.round(s.height));
      if (s.toGo !== null) expect(s.faded).toBe(Number(s.toGo));
      const discard = page.locator('.table-stage .action-row .btn-primary:not([disabled])').first();
      const pass = page.getByRole('button', { name: 'Pass', exact: true });
      if (await pass.isVisible()) await pass.click();
      else if (await discard.isVisible()) await discard.click();
    }
    expect([...heights]).toEqual([49]);
    // The strip is a button, so its tiles mustn't be: nested buttons break hydration.
    expect(errors).toEqual([]);
  });
}

test('(t) tapping the plan strip opens the hand, in words and tiles', async ({ page }) => {
  await stayLocal(page);
  await page.goto('/play/solo');
  await page.locator('.table-stage .plan-strip').click();
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible();
  await expect(card).toContainText(/The bright tiles are yours|Every tile's yours/);
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toBeHidden();
});
