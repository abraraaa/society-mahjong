import { expect, test } from '@playwright/test';
import { finalStandings } from '../lib/live/final';
import { endLine } from '../lib/live/lifecycle-copy';
import type { GameSnapshot } from '../lib/live/snapshot';
import { fixtures } from './fixtures';
import { ok, openTable } from './live';

/**
 * A game's life at the table: the last hand ends the game with no tap, and
 * the result sheet becomes the final table.
 */

/** The line under the final scores, in the page's own words. */
function endLineOf(s: GameSnapshot): string {
  return endLine(
    s.ended ?? null,
    finalStandings(
      s.seats.map((x) => x && { name: x.name, bot: x.kind === 'bot' }),
      s.scores,
    ),
    s.me,
  );
}

test.describe('the end of a game', () => {
  test('(a) the last hand scored shows the final table: the scores ranked, how it ended, and the way back to the room', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.lastHandOver) });
    const sheet = page.locator('.sheet');
    await expect(sheet.getByRole('heading', { name: 'Final scores' })).toBeVisible();
    // Ranked: Bilal top, then Amna (you), then the two bots, each marked.
    await expect(sheet.locator('.standings .row .who')).toHaveText(['1Bilal', '2You', '3Bot · bot', '4Bot · bot']);
    await expect(sheet.locator('.standings .row .total')).toHaveText(['+14,504', '+2,000', '−8,000', '−8,504']);
    await expect(sheet.locator('.standings .row.is-me .who')).toHaveText('2You');
    const line = endLineOf(fx.lastHandOver);
    expect(line).toBe("That's the game. ⁨Bilal⁩ finishes top on +14,504.");
    await expect(sheet.getByText(line)).toBeVisible();
    // No column headings for a single hand, and nothing about a next one.
    await expect(sheet.getByText('This hand')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Next hand' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'End the game here' })).toHaveCount(0);
    // The host plays again from the room; nobody leaves a game that's over.
    await expect(sheet.getByRole('button', { name: 'Play again' })).toBeVisible();
    await expect(t.stage().getByRole('button', { name: 'Leave' })).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(a) everyone else goes back to the room from it', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.lastHandOverGuest) });
    const sheet = page.locator('.sheet');
    await expect(sheet.getByRole('heading', { name: 'Final scores' })).toBeVisible();
    await expect(sheet.getByText(endLineOf(fx.lastHandOverGuest))).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Back to the room' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Play again' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'End the game here' })).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(g) a phone on its side still reaches the final table’s button, with no page errors', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.lastHandOver) });
    await page.setViewportSize({ width: 852, height: 393 });
    const button = page.locator('.sheet').getByRole('button', { name: 'Play again' });
    await expect(button).toBeVisible();
    await expect(button).toBeInViewport({ ratio: 1 });
    expect(t.pageErrors).toEqual([]);
  });
});
