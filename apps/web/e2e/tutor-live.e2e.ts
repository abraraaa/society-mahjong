import { expect, test } from '@playwright/test';
import { cardCaption } from '../lib/coach/hand-card';
import { ok, openTable } from './live';
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
});
