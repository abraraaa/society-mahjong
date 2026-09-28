import { expect, test } from '@playwright/test';
import { cardCaption } from '../lib/coach/hand-card';
import { ok, openTable, pauseClock } from './live';
import { liveCoach, tutorFixtures } from './tutor-fixtures';

/**
 * The tutor at a live table, on scenes made by the engine alone
 * (tutor-fixtures.ts): hand names that open the hand's card, wherever the
 * tutor says them.
 */
test.describe('the tutor at a live table', () => {
  test("(l-winner) the result line names the winner's hand, and a tap shows the tiles they won with", async ({ page }) => {
    const fx = tutorFixtures();
    const ref = liveCoach(fx.otherWin).outcome!.hand!.ref;
    const t = await openTable(page, { view: () => ok(fx.otherWin) });

    const name = page.locator('.sheet .term.hand', { hasText: ref.title });
    await expect(name).toBeVisible();
    const card = page.locator('[data-sheet="card"]');
    await expect(async () => {
      if (!(await card.isVisible())) await name.click();
      await expect(card).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });

    await expect(card).toHaveAttribute('data-whose', 'winner');
    await expect(card).toHaveAttribute('aria-label', ref.title);
    const caption = cardCaption(ref)!;
    await expect(card).toContainText(`${caption.name ?? ''}${caption.text}`);
    // Every tile is the winner's: nothing faded, nothing face down.
    await expect(card.locator('.tile')).not.toHaveCount(0);
    await expect(card.locator('.tile[data-dim="true"]')).toHaveCount(0);

    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-window) a card opened from a claim line goes when the next claim window comes, though the claim sheet stays up for it', async ({ page }) => {
    const { first, next } = tutorFixtures().claimAgain;
    // The table's reply to the pass is the next window, and so is any look after it.
    let passed = false;
    const t = await openTable(
      page,
      {
        view: () => ok(passed ? next : first),
        act: () => {
          passed = true;
          return ok(next);
        },
      },
      { clock: true },
    );
    const sheet = page.locator('[data-sheet="claim"]');
    const card = page.locator('[data-sheet="card"]');
    const name = sheet.locator('.term.hand').first();
    await expect(async () => {
      if (!(await card.isVisible())) await name.click();
      await expect(card).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await pauseClock(page);
    expect(t.count('act'), 'the first window still open when its card was').toBe(0);

    // The sheet passes for Amna 8.5 s into the first window, with the card still open over it. Both windows can
    // have the same discarder's name and the same tile, so only which discard of the hand it is tells them apart.
    await page.clock.runFor(9_000);
    await expect.poll(() => t.of('act').map((c) => c.body?.action.type)).toEqual(['pass']);
    await expect(card).toBeHidden();
    await expect(sheet).toBeVisible();

    // The new window's line opens its own card.
    const title = liveCoach(next).say.find((x) => x.hand)!.text;
    await sheet.locator('.term.hand', { hasText: title }).first().click();
    await expect(card).toHaveAttribute('aria-label', title);
    expect(t.pageErrors).toEqual([]);
  });
});
