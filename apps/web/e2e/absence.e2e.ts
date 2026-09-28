import { expect, test, type Locator } from '@playwright/test';
import { signed } from '../lib/ledger';
import { IM_BACK, WELCOME_BACK, awaySummary, awayTitle, clockMoveNotice, letBotPlayLabel, letBotPlaySheet, tableNews } from '../lib/live/presence';
import type { GameSnapshot } from '../lib/live/snapshot';
import { POLL_MS } from '../lib/table-sync';
import { fixtures } from './fixtures';
import { flush, ok, openTable, pauseClock } from './live';

/**
 * Who's playing each seat: a bot's seat says so on its pill and in the
 * result sheet, and when someone gets up from the table the others are told,
 * by name, and see a bot in their seat. When a clock runs out on someone,
 * their own table says what the bot did for them, in plain words. Twice in a
 * row, and a bot plays their tiles until they tap "I'm back"; the host can
 * hand someone's seat to a bot by tapping their name.
 */

/** Amna's turn, its clock already run out when the page gets it: the page asks the table to resolve it straight away. */
const expiredTurn = (s: GameSnapshot): GameSnapshot => ({ ...s, deadlines: { claim: null, turn: s.now - 1_000 } });

/** How long Amna's turn clock has left when the page gets `dueSoon`: well inside the slow poll, so nothing but the tick moves the table. */
const TURN_LEFT_MS = 8_000;
const dueSoon = (s: GameSnapshot): GameSnapshot => ({ ...s, deadlines: { claim: null, turn: s.now + TURN_LEFT_MS } });

/** Late in a game: a four-digit total on every pill. */
const SCORES = [2_000, 14_504, -8_000, -8_504];

/** The line for the move the clock's stand-in made for Amna, as her own absence carries it. */
function ownClockLine(s: GameSnapshot): string {
  expect(s.mine?.clockMoves).toBe(1);
  return clockMoveNotice(s.mine!.lastClockMove!);
}

/**
 * What each pill draws, measured: text content alone would pass with a name
 * cut down to nothing. `whole` is the name shown without an ellipsis, and
 * `apart` says the clock and tile count end before the score begins.
 */
function drawn(pills: Locator) {
  return pills.evaluateAll((els) =>
    els.map((el) => {
      const pill = el.getBoundingClientRect();
      const name = el.querySelector<HTMLElement>('.name .truncate')!;
      const mark = el.querySelector('.name small')!.getBoundingClientRect();
      const score = el.querySelector('.score')!.getBoundingClientRect();
      const held = el.querySelector('.held')!;
      const bottom = held.getBoundingClientRect().bottom;
      const range = document.createRange();
      range.selectNodeContents(held);
      const shown = [...range.getClientRects()].filter((r) => r.width > 0 && r.top < bottom);
      return {
        name: name.textContent,
        whole: name.scrollWidth <= name.clientWidth,
        markInside: mark.left >= pill.left && mark.right <= pill.right,
        scoreInside: score.left >= pill.left && score.right <= pill.right,
        apart: shown.every((r) => r.right <= score.left),
      };
    }),
  );
}

/**
 * The tick route, answering as a real table does: the tick that ran the clock
 * out saves the bot's move in Amna's absence. A later tick (a look that lands
 * while the first is on its way sends one) finds nothing left to resolve, and
 * gets the same table, the same move in it, which is no news the second time.
 */
function tickAnswers(first: GameSnapshot): () => GameSnapshot {
  expect(first.mine?.clockMoves).toBe(1);
  return () => first;
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

    // Left of Amna, across and right: Omar and Sana are bots, Bilal is a person, whose name the host (Amna) can tap.
    const names = t.stage().locator('.seat .name');
    await expect(names).toHaveText(['Omar · bot', 'Sana · bot', `Bilal${letBotPlayLabel('Bilal')}`]);
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

  for (const { width, height, roomy } of [
    { width: 393, height: 852, roomy: true },
    { width: 375, height: 667, roomy: true },
    { width: 320, height: 640, roomy: false },
  ]) {
    const says = roomy ? 'each bot’s whole name still shows beside its marker' : 'the marker, the score and the clock still fit without running into each other';
    test(`(b) with four-digit scores on a ${width}px phone, ${says}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const fx = fixtures();
      let table: GameSnapshot = { ...fx.bilalLeft, scores: SCORES };
      const t = await openTable(page, { view: () => ok(table) });
      const pills = t.stage().locator('.seat');
      // A 320px phone has room for only part of some names beside the marker, so there only the rest is checked.
      const expected = ['Omar', 'Sana', 'Bilal'].map((name) => ({ name, markInside: true, scoreInside: true, apart: true, ...(roomy && { whole: true }) }));
      const measured = async () => (await drawn(pills)).map(({ whole, ...d }) => (roomy ? { ...d, whole } : d));
      await expect(pills.locator('.name')).toHaveText(['Omar · bot', 'Sana · bot', 'Bilal · bot']);
      await expect(pills.locator('.score')).toHaveText([3, 2, 1].map((seat) => signed(SCORES[seat]!)));
      expect(await measured()).toEqual(expected);

      // Bilal's turn, with a minute and a half on his clock: the clock joins his tile count, and his name keeps its room.
      table = { ...fx.turnAfter, seats: fx.bilalLeft.seats, scores: SCORES, deadlines: { claim: null, turn: fx.turnAfter.now + 89_500 } };
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(pills.last().locator('.clock')).toHaveText(/^1:\d\d$/);
      await expect(pills.last().locator('.clock')).toBeInViewport({ ratio: 1 });
      expect(await measured()).toEqual(expected);
      expect(t.pageErrors).toEqual([]);
    });
  }

  test('a phone that finds its own clock already run out asks the table at once, and says in plain words what the bot did', async ({ page }) => {
    const fx = fixtures();
    const tick = tickAnswers(fx.timedOut);
    const t = await openTable(page, { view: (n) => ok(n === 0 ? tick() : expiredTurn(fx.turn)) });
    const line = ownClockLine(fx.timedOut);
    expect(line).toMatch(/^(You ran out of time|Time ran out), so a bot /);
    await expect(t.toast()).toHaveText(line);
    // At least one tick, not exactly one: the look on SUBSCRIBED also finds the clock run out, and if it
    // lands while the first tick is on its way the page sends a second, which the table answers with nothing new.
    expect(t.count('tick')).toBeGreaterThanOrEqual(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('when the clock runs out with the page open, it asks once; the ran-out line comes first, and anything else the tick brought follows it', async ({ page }) => {
    const fx = fixtures();
    // Bilal got up while Amna's clock was running down: the tick's answer carries both.
    const both: GameSnapshot = { ...fx.timedOut, seats: fx.bilalLeft.seats };
    const tick = tickAnswers(both);
    const t = await openTable(page, { view: (n) => ok(n === 0 ? tick() : dueSoon(fx.turn)) }, { clock: true });
    // The first look, and the one on SUBSCRIBED; from here the page's timers fire only when the test says.
    await expect.poll(() => t.count('view')).toBe(2);
    await pauseClock(page);
    await flush(page);
    expect(t.count('tick')).toBe(0);

    await page.clock.runFor(TURN_LEFT_MS + 1_000);
    const news = tableNews(dueSoon(fx.turn), both);
    expect(news).toBe(`${ownClockLine(fx.timedOut)} ${tableNews(fx.turn, fx.bilalLeft)}`);
    await expect(t.toast()).toHaveText(news!);
    await expect(t.stage().locator('.seat .name').last()).toHaveText('Bilal · bot');
    await flush(page);
    expect(t.count('tick')).toBe(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('(b) when the slow poll brings Bilal away, the table says so and marks his pill', async ({ page }) => {
    const fx = fixtures();
    let away = false;
    const t = await openTable(page, { view: () => ok(away ? fx.bilalAway : fx.turn) }, { clock: true });
    await expect.poll(() => t.count('view')).toBe(2);
    await pauseClock(page);
    await flush(page);
    const names = t.stage().locator('.seat .name');
    await expect(names.last()).toHaveText(/^Bilal/);
    away = true;
    const line = tableNews(fx.turn, fx.bilalAway);
    expect(line).toBe("⁨Bilal⁩'s away, so a bot's playing their tiles for now.");
    await page.clock.runFor(POLL_MS);
    await expect(t.toast()).toHaveText(line!);
    // His name is still the host's to tap? No: a bot is playing for him already, so it's plain text again.
    await expect(t.stage().locator('.seat .name').last()).toContainText('Bilal · away');
    await expect(t.stage().getByRole('button', { name: /Let a bot play for/ })).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(a) away, the table says why and what the bot has done; "I’m back" hands the seat back, with a welcome', async ({ page }) => {
    const fx = fixtures();
    let back = false;
    const t = await openTable(page, { view: () => ok(back ? fx.awayBack : fx.awayTurn), back: () => ok(fx.awayBack) });
    const mine = fx.awayTurn.mine!;
    expect(mine.away).toBe('clock');
    const note = page.getByRole('region', { name: awayTitle('clock') });
    await expect(note).toBeVisible();
    await expect(note).toContainText(awaySummary(mine.played));
    await note.getByRole('button', { name: IM_BACK }).click();
    await expect(note).toHaveCount(0);
    back = true;
    await expect(t.toast()).toHaveText(WELCOME_BACK);
    expect(t.count('back')).toBe(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('(h) away during a pass of tiles, the note shows alone: no pass sheet under it', async ({ page }) => {
    const fx = fixtures();
    expect(fx.awayWest.view.phase).toBe('preplay');
    expect(fx.awayWest.mine?.away).toBe('host');
    const t = await openTable(page, { view: () => ok(fx.awayWest) });
    await expect(page.getByRole('region', { name: awayTitle('host') })).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(1);
    expect(t.pageErrors).toEqual([]);
  });

  test('(c) the host taps a name to let a bot play for them: asked first, then one request with the seat and the table they saw', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.turn), away: () => ok(fx.bilalAway) });
    const bilal = t.stage().getByRole('button', { name: /Let a bot play for .*Bilal/ });
    const sheet = letBotPlaySheet('Bilal');

    // Keep waiting sends nothing.
    await bilal.click();
    await expect(page.getByRole('dialog', { name: sheet.title })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(sheet.body);
    await page.getByRole('button', { name: sheet.cancelLabel }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await flush(page);
    expect(t.count('away')).toBe(0);

    await bilal.click();
    await page.getByRole('button', { name: sheet.confirmLabel, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(t.stage().locator('.seat .name').last()).toContainText('Bilal · away');
    expect(t.count('away')).toBe(1);
    const sent = t.of('away')[0]!.sent as { seat: unknown; sawAt: unknown; sawVersion: unknown };
    expect(sent.seat).toBe(1);
    expect(typeof sent.sawAt).toBe('number');
    // The version of the table the host was looking at: the server judges a tap the host never saw by it (R8).
    expect(sent.sawVersion).toBe(fx.turn.version);
    expect(t.pageErrors).toEqual([]);
  });

  test('(d) nobody but the host has names to tap', async ({ page }) => {
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.notHost) });
    await expect(t.stage().locator('.seat .name')).toHaveText(['Omar · bot', 'Sana · bot', 'Bilal']);
    await expect(page.getByRole('button', { name: /Let a bot play for/ })).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(e) on a phone lying down, the away note’s button is on screen', async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    const fx = fixtures();
    const t = await openTable(page, { view: () => ok(fx.awayTurn) });
    const button = page.getByRole('region', { name: awayTitle('clock') }).getByRole('button', { name: IM_BACK });
    await expect(button).toBeInViewport({ ratio: 1 });
    expect(t.pageErrors).toEqual([]);
  });
});
