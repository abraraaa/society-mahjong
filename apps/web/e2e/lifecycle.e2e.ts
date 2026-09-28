import { expect, test } from '@playwright/test';
import { finalStandings } from '../lib/live/final';
import { HOST_LEAVE, endLine, endSheet } from '../lib/live/lifecycle-copy';
import { plainError } from '../lib/live/plain';
import type { GameSnapshot } from '../lib/live/snapshot';
import { fixtures, serve } from './fixtures';
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
    await expect(sheet.locator('.standings .row .who')).toHaveText(['1Bilal', '2You', '3Sana · bot', '4Omar · bot']);
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

  test('(d) the question sits over the result sheet: the sheet is dimmed and out of reach until it’s answered', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.handDone) });
    const result = page.locator('.sheet:not([role="dialog"])');
    await result.getByRole('button', { name: 'End the game here' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: endSheet(false, 2).title })).toBeVisible();

    // Where the result sheet's title shows past the question, the question's scrim is on top of it.
    const box = (await result.locator('h2').boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.className ?? null, [x, y])).toBe('scrim scrim-top');
    // So a tap there is the scrim's "no": the question goes, and nothing is sent.
    await page.mouse.click(x, y);
    await expect(dialog).toHaveCount(0);
    await flush(page);
    expect(t.count('end')).toBe(0);
    expect(t.count('act')).toBe(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(d) an End that fails keeps the question up for another tap, says so, and looks at the table again', async ({ page }) => {
    const fx = fixtures();
    const failed = { status: 500, message: 'something went wrong' };
    const t = await openTable(page, { view: () => ok(fx.handDone), end: (n) => (n === 1 ? { status: failed.status, body: { error: failed.message } } : ok(fx.endedByHost)) });
    // The first look, and the one on SUBSCRIBED.
    await expect.poll(() => t.count('view')).toBe(2);
    await flush(page);
    const looks = t.count('view');
    const copy = endSheet(false, 2);
    const dialog = page.getByRole('dialog');
    await page.locator('.sheet').getByRole('button', { name: 'End the game here' }).click();
    await dialog.getByRole('button', { name: copy.confirmLabel }).click();

    await expect(t.toast()).toHaveText(plainError(failed));
    await expect(dialog.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(dialog.getByRole('button', { name: copy.confirmLabel })).toBeEnabled();
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);

    // Another tap, and this time it lands.
    await dialog.getByRole('button', { name: copy.confirmLabel }).click();
    await expect(page.locator('.sheet').getByRole('heading', { name: 'Final scores' })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(t.count('end')).toBe(2);
    expect(t.pageErrors).toEqual([]);
  });

  test('(d) an End turned back with the table attached shows that table at once, and keeps the question up', async ({ page }) => {
    const fx = fixtures();
    // Someone else's move landed first, three times over: the server sends the table as it now stands.
    const moved: GameSnapshot = { ...fx.handDone, version: 12, scores: [1500, -500, -500, -500] };
    const lost = 'the table changed under you; try again';
    const t = await openTable(page, {
      view: () => ok(fx.handDone),
      end: (n) => (n === 1 ? { status: 409, body: { error: lost, snapshot: serve(moved) } } : ok({ ...fx.endedByHost, version: 13 })),
    });
    const copy = endSheet(false, 2);
    const dialog = page.getByRole('dialog');
    await page.locator('.sheet').getByRole('button', { name: 'End the game here' }).click();
    await dialog.getByRole('button', { name: copy.confirmLabel }).click();

    await expect(t.toast()).toHaveText(plainError({ status: 409, message: lost }));
    // The totals behind the question are the ones that came back with the refusal, which no look would give.
    await expect(page.locator('.sheet:not([role="dialog"]) .standings .row.is-me .total')).toHaveText('+1,500');
    await expect(dialog.getByRole('button', { name: copy.confirmLabel })).toBeEnabled();

    await dialog.getByRole('button', { name: copy.confirmLabel }).click();
    await expect(page.locator('.sheet').getByRole('heading', { name: 'Final scores' })).toBeVisible();
    expect(t.count('end')).toBe(2);
    expect(t.pageErrors).toEqual([]);
  });

  test('(d) an End refused because the host’s powers have passed on closes the question, says why, and looks again', async ({ page }) => {
    const fx = fixtures();
    const refused = { status: 403, message: 'only the host can end the game' };
    const t = await openTable(page, { view: () => ok(fx.handDone), end: () => ({ status: refused.status, body: { error: refused.message } }) });
    await expect.poll(() => t.count('view')).toBe(2);
    await flush(page);
    const looks = t.count('view');
    const dialog = page.getByRole('dialog');
    await page.locator('.sheet').getByRole('button', { name: 'End the game here' }).click();
    await dialog.getByRole('button', { name: endSheet(false, 2).confirmLabel }).click();

    await expect(t.toast()).toHaveText(plainError(refused));
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    await expect(page.locator('.sheet').getByRole('button', { name: 'Next hand' })).toBeVisible();
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

  test('(g) a phone on its side sees a won hand’s final table from its title, scrolls to the scores, and keeps its button in reach', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.endedByHost) });
    const sheet = page.locator('.sheet');
    const button = sheet.getByRole('button', { name: 'Play again' });
    const line = sheet.getByText(endLineOf(fx.endedByHost));
    await expect(sheet.getByRole('heading', { name: 'Final scores' })).toBeVisible();
    // Upright, it all fits, as it always did: nothing to scroll.
    expect(await sheet.evaluate((s) => s.scrollHeight <= s.clientHeight)).toBe(true);

    for (const [width, height] of [
      [852, 393],
      [320, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await sheet.evaluate((s) => s.scrollTo(0, 0));
      // The top of the sheet, the winner's name with it, is on the screen, and so is the button.
      expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      await expect(sheet.locator('h2')).toBeInViewport({ ratio: 1 });
      await expect(button).toBeInViewport({ ratio: 1 });
      // The rest is a scroll away, clear of the button, which stays where it was.
      await sheet.evaluate((s) => s.scrollTo(0, s.scrollHeight));
      await expect(line).toBeInViewport({ ratio: 1 });
      await expect(button).toBeInViewport({ ratio: 1 });
      const [text, tap] = [(await line.boundingBox())!, (await button.boundingBox())!];
      expect(text.y + text.height).toBeLessThanOrEqual(tap.y);
    }
    expect(t.pageErrors).toEqual([]);
  });

  test('(g) a phone on its side sees the host’s Leave and End questions whole, every button in reach and on top', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn) });
    const dialog = page.getByRole('dialog');
    /** The question fits with nothing to scroll, its title and every button on the screen, and nothing drawn over a button. */
    const whole = async (buttons: readonly string[]) => {
      await expect(dialog.locator('h2')).toBeInViewport({ ratio: 1 });
      expect(await dialog.evaluate((s) => s.scrollHeight <= s.clientHeight)).toBe(true);
      for (const name of buttons) {
        const button = dialog.getByRole('button', { name, exact: true });
        await expect(button).toBeInViewport({ ratio: 1 });
        const box = (await button.boundingBox())!;
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.textContent ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
        expect(hit).toBe(name);
      }
    };
    for (const [width, height] of [
      [852, 393],
      [740, 360],
    ] as const) {
      await page.setViewportSize({ width, height });
      await t.stage().getByRole('button', { name: 'Leave' }).click();
      await expect(dialog.getByRole('heading', { name: HOST_LEAVE.title })).toBeVisible();
      await whole([HOST_LEAVE.leave, HOST_LEAVE.end, HOST_LEAVE.stay]);
      await dialog.getByRole('button', { name: HOST_LEAVE.stay }).click();
      await expect(dialog).toHaveCount(0);

      await t.stage().getByRole('button', { name: 'Leave' }).click();
      await dialog.getByRole('button', { name: HOST_LEAVE.end }).click();
      const copy = endSheet(true, 1);
      await expect(dialog.getByRole('heading', { name: copy.title })).toBeVisible();
      await whole([copy.confirmLabel, copy.cancelLabel]);
      await dialog.getByRole('button', { name: copy.cancelLabel }).click();
      await expect(dialog).toHaveCount(0);
    }
    await flush(page);
    expect(t.count('end')).toBe(0);
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
