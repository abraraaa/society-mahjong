import { expect, test } from '@playwright/test';
import { tileName, type PrivatePlayerView } from '@society/engine';
import { REQUEST_TIMEOUT_MS } from '../lib/live/client';
import { plainError } from '../lib/live/plain';
import type { GameSnapshot } from '../lib/live/snapshot';
import { POLL_MS } from '../lib/table-sync';
import { fixtures } from './fixtures';
import { conflict, flush, ok, openTable, pauseClock, tapUntilLifted, type LiveTable } from './live';

/** What the player reads when a move bounced off a table that had moved on, and when one got no answer: the page's own words. */
const MOVED_ON = plainError({ status: 409, message: 'stale version' });
const TOO_SLOW = plainError({ status: 0, message: 'timed out' });

const hand = (s: GameSnapshot) => (s.view as PrivatePlayerView).concealed.map((k) => tileName(k));

/** The first tile in the hand, tapped until it lifts: past hydration and the grace period after the deal, so a tap on a move counts. */
async function readyToTap(t: LiveTable): Promise<void> {
  await tapUntilLifted(t.stage().locator('.hand-tray button.tile').first());
}

test.describe('live table', () => {
  test('(a) looks at the table again on every SUBSCRIBED: the first join, and the rejoin after a dropped connection', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn) }, { holdGameJoins: true, clock: true });

    // Subscribed, then the first look; the join itself is held.
    await expect.poll(() => t.realtime.gameJoins().length).toBe(1);
    await expect.poll(() => t.count('view')).toBe(1);
    // From here the page's timers fire only when the test says, so the slow poll can't pass for one of these looks.
    await pauseClock(page);

    // Joined. A poke sent before the join was missed for good, so the page looks again.
    t.realtime.gameJoins()[0]!.reply();
    await expect.poll(() => t.count('view')).toBe(2);

    // The connection drops. Realtime reconnects after a second and rejoins by itself; no look until it's back.
    await t.realtime.drop();
    await expect(async () => {
      await page.clock.runFor(500);
      expect(t.realtime.gameJoins().length).toBe(2);
    }).toPass({ timeout: 10_000 });
    await flush(page);
    expect(t.count('view')).toBe(2);

    // Rejoined: SUBSCRIBED again, and another look, since pokes sent while it was down are gone too.
    t.realtime.gameJoins()[1]!.reply();
    await expect.poll(() => t.count('view')).toBe(3);
    await flush(page);
    expect(t.count('view')).toBe(3);
    expect(t.pageErrors).toEqual([]);
  });

  test('(b) a move on its way disables the buttons, and a second tap sends nothing', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn), act: () => 'hold' });
    await readyToTap(t);
    const discard = t.discard();
    await expect(discard).toBeEnabled();

    // Two taps in the same task, before React can draw the first, then a third while the move is on its way.
    await discard.evaluate((b: HTMLElement) => {
      b.click();
      b.click();
    });
    await expect.poll(() => t.count('act')).toBe(1);
    await expect(discard).toBeDisabled();
    await discard.click({ force: true });
    await flush(page);
    expect(t.count('act')).toBe(1);

    // The answer lands: the table moves on, and nothing else was sent.
    await t.release(t.of('act')[0]!, ok(fx.turnAfter));
    await expect(discard).toHaveCount(0);
    await flush(page);
    expect(t.count('act')).toBe(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('(c) a 409 with the table attached is taken, and the move goes once more against it while it is still open', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.westSent), act: (_, n) => (n === 1 ? 'hold' : ok(fx.westLanded)) });
    const sheet = page.locator('.sheet', { hasText: 'Goulash exchange' });
    const tiles = sheet.locator('button.tile');
    await tapUntilLifted(tiles.nth(0));
    await tiles.nth(1).click();
    await tiles.nth(2).click();
    const pass = sheet.getByRole('button', { name: 'Pass tiles' });
    await pass.click();
    await expect.poll(() => t.count('act')).toBe(1);
    // The exchange waits while it's on its way, like every other move.
    await expect(pass).toBeDisabled();

    // Bilal's exchange landed first: a newer table, but nothing has happened at it, and Amna's exchange is still open.
    await t.release(t.of('act')[0]!, conflict(fx.westConflict));
    await expect.poll(() => t.count('act')).toBe(2);
    const [first, retry] = t.of('act').map((c) => c.body!);
    expect(first!.action).toEqual({ type: 'exchange', seat: 0, tiles: [...fx.westTiles] });
    expect(first!.expectedVersion).toBe(fx.westSent.version);
    expect(retry!.action).toEqual(first!.action);
    expect(retry!.expectedVersion).toBe(fx.westConflict.version);

    // It landed: the next pass, dealt from the hand that came back, with nothing to apologise for.
    await expect.poll(() => tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(hand(fx.westLanded));
    await expect(t.toast()).toHaveCount(0);
    await flush(page);
    expect(t.count('act')).toBe(2);
    expect(t.pageErrors).toEqual([]);
  });

  test('(c) a 409 from a table that has moved on is taken, not sent again, and the player is told', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn), act: () => conflict(fx.turnAfter) });
    await readyToTap(t);
    await t.discard().click();

    await expect(t.toast()).toHaveText(MOVED_ON);
    // The newer table is on screen: Bilal's turn, so no Discard.
    await expect(t.discard()).toHaveCount(0);
    await flush(page);
    expect(t.count('act')).toBe(1);
    expect(t.of('act')[0]!.body!.expectedVersion).toBe(fx.turn.version);
    expect(t.pageErrors).toEqual([]);
  });

  test('(d) a move that gets no answer is given up on after about ten seconds, with a notice and another look', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn), act: () => 'hold' }, { clock: true });
    await readyToTap(t);
    await pauseClock(page);
    await t.discard().click();
    await expect.poll(() => t.count('act')).toBe(1);
    const looks = t.count('view');

    // A second short of the limit: still waiting, and saying nothing yet.
    await page.clock.fastForward(REQUEST_TIMEOUT_MS - 1_000);
    await flush(page);
    await expect(t.toast()).toHaveCount(0);
    await expect(t.discard()).toBeDisabled();

    // Past it: given up on, said plainly, and the table looked at again in case the move landed after all.
    await page.clock.fastForward(1_500);
    await expect(t.toast()).toHaveText(TOO_SLOW);
    await expect(t.discard()).toBeEnabled();
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    expect(t.pageErrors).toEqual([]);
  });

  test('(e) the slow poll looks every twelve seconds while the table is on screen, and stops once the game is over', async ({ page }) => {
    const fx = fixtures();
    let over = false;
    const t = await openTable(page, { view: () => ok(over ? fx.finished : fx.turn) }, { clock: true });
    // The first look, and the one on SUBSCRIBED.
    await expect.poll(() => t.count('view')).toBe(2);
    await pauseClock(page);
    await flush(page);
    expect(t.count('view')).toBe(2);

    // Twelve seconds, one look; twelve more, another.
    for (const looks of [3, 4]) {
      await page.clock.runFor(POLL_MS);
      await flush(page);
      expect(t.count('view')).toBe(looks);
    }

    // Not while the page is out of sight.
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
    await page.clock.runFor(POLL_MS);
    await flush(page);
    expect(t.count('view')).toBe(4);
    await page.evaluate(() => delete (document as { visibilityState?: unknown }).visibilityState);

    // The next look finds the game over. After that, no more.
    over = true;
    await page.clock.runFor(POLL_MS);
    await expect(page.locator('.sheet').getByRole('button', { name: 'Play again' })).toBeVisible();
    for (let i = 0; i < 3; i++) await page.clock.runFor(POLL_MS);
    await flush(page);
    expect(t.count('view')).toBe(5);
    expect(t.count('tick')).toBe(0);
    expect(t.pageErrors).toEqual([]);
  });
});
