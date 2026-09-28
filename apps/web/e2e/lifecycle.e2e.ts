import { expect, test } from '@playwright/test';
import { finalStandings } from '../lib/live/final';
import { HOST_LEAVE, endLine, endSheet } from '../lib/live/lifecycle-copy';
import type { GameSnapshot } from '../lib/live/snapshot';
import { fixtures } from './fixtures';
import { flush, ok, openTable } from './live';

/**
 * A game's life at the table: the last hand ends the game with no tap, and
 * the result sheet becomes the final table. The host can end it sooner, from
 * the result sheet between hands or from their Leave sheet mid-hand.
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

  test('(d) the host ends the game from the result sheet: asked first, then one request, and the final table', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.handDone), end: () => ok(fx.endedByHost) });
    await expect(page.locator('.sheet').getByRole('button', { name: 'Next hand' })).toBeVisible();
    const endHere = page.locator('.sheet').getByRole('button', { name: 'End the game here' });
    const dialog = page.getByRole('dialog');
    const copy = endSheet(false, 2);
    expect(copy.body).toBe("Everyone will see the final scores from the two hands you've played.");

    // Keep playing: nothing is sent.
    await endHere.click();
    await expect(dialog.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(dialog.getByText(copy.body)).toBeVisible();
    await dialog.getByRole('button', { name: copy.cancelLabel }).click();
    await expect(dialog).toHaveCount(0);
    await flush(page);
    expect(t.count('end')).toBe(0);

    // End the game: one request, and its answer is the host's final table.
    await endHere.click();
    await dialog.getByRole('button', { name: copy.confirmLabel }).click();
    const sheet = page.locator('.sheet');
    await expect(sheet.getByRole('heading', { name: 'Final scores' })).toBeVisible();
    const line = endLineOf(fx.endedByHost);
    expect(line.startsWith('You ended the game after two hands. ')).toBe(true);
    await expect(sheet.getByText(line)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Play again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'End the game here' })).toHaveCount(0);
    await flush(page);
    expect(t.count('end')).toBe(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('(d) nobody else is offered the end on the result sheet', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok({ ...fx.handDone, isHost: false }) });
    await expect(page.locator('.sheet').getByRole('button', { name: 'Next hand' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'End the game here' })).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(e) mid-hand, the host’s Leave sheet offers to end the game for everyone, and asks first', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn), end: () => ok(fx.endedByHost) });
    await t.stage().getByRole('button', { name: 'Leave' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: HOST_LEAVE.title })).toBeVisible();
    await expect(dialog.getByText(HOST_LEAVE.body)).toBeVisible();
    await expect(dialog.getByRole('button')).toHaveText([HOST_LEAVE.leave, HOST_LEAVE.end, HOST_LEAVE.stay]);

    await dialog.getByRole('button', { name: HOST_LEAVE.end }).click();
    // One hand has finished, and this one won't count.
    const copy = endSheet(true, 1);
    expect(copy.title).toBe('End the game now?');
    await expect(dialog.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(dialog.getByText(copy.body)).toBeVisible();
    await expect(dialog.getByRole('button')).toHaveText([copy.confirmLabel, copy.cancelLabel]);
    await dialog.getByRole('button', { name: copy.cancelLabel }).click();
    await expect(dialog).toHaveCount(0);
    await flush(page);
    expect(t.count('end')).toBe(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(e) everyone else’s Leave sheet has no end in it', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok({ ...fx.turn, isHost: false }) });
    await t.stage().getByRole('button', { name: 'Leave' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Leave the table?' })).toBeVisible();
    await expect(dialog.getByRole('button')).toHaveText(['Leave', 'Stay']);
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
