import { expect, test } from '@playwright/test';
import { clockMoveNotice, tableNews } from '../lib/live/presence';
import type { GameSnapshot } from '../lib/live/snapshot';
import { POLL_MS } from '../lib/table-sync';
import { fixtures } from './fixtures';
import { flush, ok, openTable, pauseClock } from './live';

/**
 * Who's playing each seat: a bot's seat says so on its pill and in the
 * result sheet, and when someone gets up from the table the others are told,
 * by name, and see a bot in their seat. When a clock runs out on someone,
 * their own table says what the bot did for them, in plain words.
 */

/** Amna's turn, its clock already run out when the page gets it: the page asks the table to resolve it straight away. */
const expiredTurn = (s: GameSnapshot): GameSnapshot => ({ ...s, deadlines: { claim: null, turn: s.now - 1_000 } });

/** The line for the move the tick's stand-in made for Amna. */
function ownClockLine(s: GameSnapshot): string {
  expect(s.standIns).toHaveLength(1);
  const own = s.standIns![0]!;
  return clockMoveNotice({ by: 'clock', seat: own.seat, a: own.action });
}

test.describe('bots and people at the table', () => {
  test('(b) the bots are marked on their pills; when Bilal leaves, the table says so and marks his seat too', async ({ page }) => {
    const fx = fixtures();
    let left = false;
    const t = await openTable(page, { view: () => ok(left ? fx.bilalLeft : fx.turn) }, { clock: true });
    // The first look, and the one on SUBSCRIBED; from here the page's timers fire only when the test says.
    await expect.poll(() => t.count('view')).toBe(2);
    await pauseClock(page);
    await flush(page);

    // Left of Amna, across and right: Omar and Sana are bots, Bilal is a person.
    const names = t.stage().locator('.seat .name');
    await expect(names).toHaveText(['Omar · bot', 'Sana · bot', 'Bilal']);
    await expect(t.toast()).toHaveCount(0);

    // Bilal gets up. It doesn't move the table, so nobody is poked: the slow poll is what brings it.
    left = true;
    const line = tableNews(fx.turn, fx.bilalLeft);
    expect(line).toBe("⁨Bilal⁩'s left the table, so a bot's playing their seat for now.");
    await page.clock.runFor(POLL_MS);
    await expect(t.toast()).toHaveText(line!);
    await expect(names).toHaveText(['Omar · bot', 'Sana · bot', 'Bilal · bot']);

    // Said once: the next look finds the same table, and has nothing new to say.
    await page.clock.runFor(5_000);
    await expect(t.toast()).toHaveCount(0);
    await page.clock.runFor(POLL_MS);
    await flush(page);
    expect(t.count('view')).toBe(4);
    await expect(t.toast()).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(b) the result sheet marks the bots’ rows as well', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.handDone) });
    const rows = page.locator('.sheet .standings .row .who');
    await expect(rows.filter({ hasText: 'Sana' })).toHaveText('Sana · bot');
    await expect(rows.filter({ hasText: 'Omar' })).toHaveText('Omar · bot');
    await expect(rows.filter({ hasText: 'Bilal' })).toHaveText('Bilal');
    await expect(rows.filter({ hasText: 'You' })).toHaveText('You');
    expect(t.pageErrors).toEqual([]);
  });

  test('a clock that ran out, found by this phone’s own tick, is told in plain words', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: (n) => ok(n === 0 ? fx.timedOut : expiredTurn(fx.turn)) });
    const line = ownClockLine(fx.timedOut);
    expect(line).toMatch(/^(You ran out of time|Time ran out), so a bot /);
    await expect(t.toast()).toHaveText(line);
    expect(t.count('tick')).toBe(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('the ran-out line comes first, and anything else the tick brought follows it', async ({ page }) => {
    const fx = fixtures();
    // Bilal got up while Amna's clock was running out: the tick's answer carries both.
    const both: GameSnapshot = { ...fx.timedOut, seats: fx.bilalLeft.seats };
    const t = await openTable(page, { view: (n) => ok(n === 0 ? both : expiredTurn(fx.turn)) });
    const news = tableNews(expiredTurn(fx.turn), both);
    expect(news).toBe(tableNews(fx.turn, fx.bilalLeft));
    await expect(t.toast()).toHaveText(`${ownClockLine(fx.timedOut)} ${news}`);
    await expect(t.stage().locator('.seat .name').last()).toHaveText('Bilal · bot');
    expect(t.pageErrors).toEqual([]);
  });
});
