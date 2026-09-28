import { expect, test, type Page } from '@playwright/test';
import { cardClockLine } from '../lib/coach/clock';
import { cardCaption } from '../lib/coach/hand-card';
import { TAUGHT_KEY, handNote, noteText } from '../lib/coach/teach';
import { textOf } from '../lib/coach/words';
import { CLAIM_PASS_MARGIN_MS } from '../lib/live/timing';
import type { GameSnapshot } from '../lib/live/snapshot';
import { riverOrder } from '../lib/river';
import { standInNotice } from '../lib/table-flow';
import { POLL_MS } from '../lib/table-sync';
import { flush, ok, openTable, pauseClock, type LiveTable } from './live';
import { liveCoach, tutorFixtures } from './tutor-fixtures';

/**
 * Opens the table on `before`, then stops the page's clock and lets the game channel's join through: the page looks
 * again, and takes `window` at a moment the test knows, so every second of its clock from there is the test's. The
 * tick route (the page asking the table to settle a clock run out) answers with `settled`. A later look (the slow poll,
 * whose twelve seconds started before the clock stopped) gets no answer, so nothing but the test moves the scene on.
 */
async function openThenLook(page: Page, s: { readonly before: GameSnapshot; readonly window: GameSnapshot; readonly settled?: GameSnapshot }): Promise<LiveTable> {
  const view = (n: number) => (n === 0 ? ok(s.settled ?? s.window) : n === 1 ? ok(s.before) : n === 2 ? ok(s.window) : 'hold');
  const t = await openTable(page, { view, act: () => 'hold' }, { holdGameJoins: true, clock: true });
  await expect.poll(() => t.realtime.gameJoins().length).toBe(1);
  await expect.poll(() => t.count('view')).toBe(1);
  await pauseClock(page);
  t.realtime.gameJoins()[0]!.reply();
  await expect.poll(() => t.count('view')).toBe(2);
  return t;
}

/**
 * The tutor at a live table, on scenes made by the engine alone
 * (tutor-fixtures.ts): hand names that open the hand's card, wherever the
 * tutor says them, a card over a claim that shows the table's clock, a win the
 * claim sheet leaves to the table's clock rather than passing on, and the
 * footnotes a first-timer gets the first time a hand, a flower or a run tile
 * going past comes up, which stay for as long as the line they came with.
 */
test.describe('the tutor at a live table', () => {
  test("(l-winner) the result line names the winner's hand, explains it the first time, and a tap shows the tiles they won with", async ({ page }) => {
    const fx = tutorFixtures();
    const coach = liveCoach(fx.otherWin);
    const ref = coach.outcome!.hand!.ref;
    // Every test has a fresh context, so this is the visit's first sight of the hand: its footnote goes under the line.
    const t = await openTable(page, { view: () => ok(fx.otherWin) });

    const name = page.locator('.sheet .term.hand', { hasText: ref.title }).first();
    await expect(name).toBeVisible();
    const note = page.locator(`.sheet [data-note="hand:${ref.title}"]`);
    await expect(note).toHaveText(noteText(handNote(ref, coach.goal)));
    // The footnote's label is the hand's name too, and opens the same card.
    await expect(note.locator('.term.hand')).toHaveText(ref.title);
    const card = page.locator('[data-sheet="card"]');
    await expect(async () => {
      if (!(await card.isVisible())) await note.locator('.term.hand').click();
      await expect(card).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await expect(card).toHaveAttribute('data-whose', 'winner');
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();

    // And the name in the line itself.
    await name.click();
    await expect(card).toBeVisible();
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

  test('(l-flower) a flower drawn since her last move is explained under the bubble, the first time', async ({ page }) => {
    const fx = tutorFixtures();
    const flowers = liveCoach(fx.flowerTurn).teach.find((x) => x.key === 'rule:flowers')!;
    const t = await openTable(page, { view: () => ok(fx.flowerTurn) });
    const note = t.stage().locator('.coach [data-note="rule:flowers"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(noteText(flowers));
    // Taught for the visit, and the glossary's footnote for "flowers" with it: the same words.
    const taught = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[], TAUGHT_KEY);
    expect(taught).toEqual(expect.arrayContaining(['rule:flowers', 'term:bonus']));
    expect(t.pageErrors).toEqual([]);
  });

  test("(l-run) a tile she'd have wanted for a run went past: her next turn says why she couldn't take it", async ({ page }) => {
    const fx = tutorFixtures();
    const runs = liveCoach(fx.missedRun).teach.find((x) => x.key === 'rule:runs')!;
    const t = await openTable(page, { view: () => ok(fx.missedRun) });
    const note = t.stage().locator('[data-note="rule:runs"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveText(runs.text);
    expect(await note.textContent()).toMatch(/only come from the wall\.$/);
    // Taught for the visit: the next run tile that goes past isn't explained again.
    const taught = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[], TAUGHT_KEY);
    expect(taught).toContain('rule:runs');
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-line) a bubble keeps its footnote, and its height, while its words stay the same and the others move', async ({ page }) => {
    const { first, next } = tutorFixtures().handStartTwice;
    // Bilal throws and the bots move on while Amna waits: the page's next look brings the table on.
    let moved = false;
    const t = await openTable(page, { view: () => ok(moved ? next : first) }, { clock: true });
    const coach = t.stage().locator('.coach');
    const flowers = liveCoach(first).teach.find((x) => x.key === 'rule:flowers')!;
    await expect(coach.locator('[data-note="rule:flowers"]')).toHaveText(noteText(flowers));
    await pauseClock(page);
    const look = async () => ({
      say: await coach.locator('.say').textContent(),
      notes: await coach.locator('[data-note]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-note')}: ${e.textContent}`)),
      height: await coach.evaluate((e) => e.getBoundingClientRect().height),
    });
    const before = await look();
    expect(before.say).toBe(textOf(liveCoach(first).say));

    moved = true;
    const looks = t.count('view');
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    await expect(t.stage().getByText(`${riverOrder(next.view).length} discarded`, { exact: true })).toBeVisible();
    // A new view, and the same line: the note it came with stays, and the bubble doesn't shrink under the reader.
    expect(await look()).toEqual(before);
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-window) a card opened from a claim line goes when the next claim window comes, though the claim sheet stays up for it', async ({ page }) => {
    const { first, next } = tutorFixtures().claimAgain;
    // Amna answers on her other phone while a card is open here: the page's next look brings the next window.
    let answered = false;
    const t = await openTable(page, { view: () => ok(answered ? next : first) }, { clock: true });
    const sheet = page.locator('[data-sheet="claim"]');
    const card = page.locator('[data-sheet="card"]');
    const name = sheet.locator('.term.hand').first();
    await expect(async () => {
      if (!(await card.isVisible())) await name.click();
      await expect(card).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await pauseClock(page);

    // A card can be open when the next window comes: when the table moves on without this phone, as here, or when she
    // opened it in the last few seconds and the sheet passed under it. Both windows can have the same discarder's name
    // and the same tile, so only which discard of the hand it is tells them apart.
    answered = true;
    const looks = t.count('view');
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    await expect(card).toBeHidden();
    await expect(sheet).toBeVisible();
    expect(t.count('act'), 'nothing sent from this phone').toBe(0);

    // The new window's line opens its own card.
    const title = liveCoach(next).say.find((x) => x.hand)!.text;
    await sheet.locator('.term.hand', { hasText: title }).first().click();
    await expect(card).toHaveAttribute('aria-label', title);
    expect(t.pageErrors).toEqual([]);
  });

  test("(l-clock) a card over a live claim counts to the sheet's pass, and gets out of the way once, with a few seconds left", async ({ page }) => {
    const { before, window } = tutorFixtures().claim;
    const t = await openThenLook(page, { before, window });
    const sheet = page.locator('[data-sheet="claim"]');
    const name = sheet.locator('.term.hand').first();
    const card = page.locator('[data-sheet="card"]');
    await name.click();
    await expect(card).toBeVisible();
    // Nobody can hold the table's clock, so the card says it's still running, and how long is left: the table's
    // ten seconds less the margin the sheet keeps to pass in time, since that's all the time she really has.
    const length = window.deadlines.claim! - window.now;
    await expect(card.locator('.clock')).toHaveText(cardClockLine({ kind: 'running', what: 'claim', ms: length - CLAIM_PASS_MARGIN_MS })!);
    await expect(sheet.locator('.timer')).not.toHaveAttribute('data-paused', 'true');

    // The sheet passes for Amna 8.5 s in. The card steps aside with 4 s of that left, on the page's once-a-second tick
    // after 4.5 s.
    await page.clock.runFor(4_000);
    await expect(card).toBeVisible();
    await page.clock.runFor(1_500);
    await expect(card).toBeHidden();
    await expect(sheet).toBeVisible();

    // Once. A tap after that is hers: the card opens and stays, and says how little is left.
    await name.click();
    await expect(card).toBeVisible();
    await expect(card.locator('.clock')).toHaveText(/ 0:0[1-4]\.$/);
    await page.clock.runFor(1_000);
    await expect(card).toBeVisible();
    await flush(page);
    expect(t.count('act'), 'the sheet still waiting for her').toBe(0);

    // And the card never held the clock: the sheet passes on time, 8.5 s in, under the card she opened.
    await page.clock.runFor(1_900);
    await flush(page);
    expect(t.count('act'), 'nothing sent before 8.5 s').toBe(0);
    await page.clock.runFor(100);
    await expect.poll(() => t.of('act').map((c) => c.body?.action.type)).toEqual(['pass']);

    // At nought the clock has stopped: the pass is on its way, and the table settles the rest. There's nothing left to
    // make way for, so a tap still opens the card.
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();
    await page.clock.runFor(1_000);
    await name.click();
    await expect(card).toBeVisible();
    await expect(card.locator('.clock')).toHaveText(cardClockLine({ kind: 'running', what: 'claim', ms: 0 })!);
    await page.clock.runFor(500);
    await expect(card).toBeVisible();
    expect(t.pageErrors).toEqual([]);
  });

  test("(l-win) a live claim that offers her Mahjong shows the table's clock but never passes on it: when it runs out, the table calls Mahjong for her", async ({ page }) => {
    const { before, window, won } = tutorFixtures().winClaim;
    const t = await openThenLook(page, { before, window, settled: won });
    const sheet = page.locator('[data-sheet="claim"]');
    await expect(sheet.getByRole('button', { name: 'Mahjong!' })).toBeVisible();
    // A win runs on the turn clock, here ten seconds. The bar and a card both count to the table's own deadline: the
    // margin the sheet keeps to pass in time doesn't come into it, because it never passes on a win.
    const length = window.deadlines.claim! - window.now;
    await expect(sheet.locator('.timer')).toHaveAttribute('style', new RegExp(`--claim-seconds:\\s*${length / 1000}s`));
    const card = page.locator('[data-sheet="card"]');
    await sheet.locator('.term.hand').first().click();
    await expect(card).toBeVisible();
    await expect(card.locator('.clock')).toHaveText(cardClockLine({ kind: 'running', what: 'claim', ms: length })!);
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();

    // Past the 8.5 s at which the sheet passes on any other discard, and on to the table's deadline: nothing sent.
    await page.clock.runFor(length);
    await flush(page);
    expect(t.count('act'), 'no pass on a win').toBe(0);
    await expect(sheet.getByRole('button', { name: 'Mahjong!' })).toBeEnabled();

    // The clock runs out. The page asks the table to settle it, and the table's stand-in calls Mahjong for her.
    await page.clock.runFor(1_000);
    await expect.poll(() => t.count('tick')).toBe(1);
    await expect(t.toast()).toHaveText(standInNotice(won.standIns![0]!.action));
    await expect(page.locator('.sheet h2', { hasText: 'Mahjong!' })).toBeVisible();
    expect(t.count('act')).toBe(0);
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-list) the ? sheet stays where it is when a clock of hers starts under it', async ({ page }) => {
    const { before, window } = tutorFixtures().claim;
    // Someone else's move: no clock of Amna's is running, and the ? sheet has no clock line.
    const t = await openTable(page, { view: (n) => ok(n <= 1 ? before : window) }, { holdGameJoins: true, clock: true });
    await expect.poll(() => t.count('view')).toBe(1);
    await pauseClock(page);
    const list = page.locator('[data-sheet="list"]');
    await expect(async () => {
      if (!(await list.isVisible())) await t.stage().getByRole('button', { name: 'Glossary' }).click();
      await expect(list).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await expect(list.locator('.clock')).toHaveCount(0);
    // Measured once it has finished sliding in. It's as tall as a sheet may be, and scrolls, so it can't grow to make room.
    await expect.poll(() => list.evaluate((e) => e.getAnimations().length)).toBe(0);
    const place = () => list.evaluate((e) => ({ top: e.querySelector('h2')!.getBoundingClientRect().top, scroll: e.scrollTop, height: e.getBoundingClientRect().height }));
    const was = await place();
    expect(was.scroll).toBe(0);

    // Her claim window comes with the page's next look: the line goes where the grabber was, and nothing under it moves.
    t.realtime.gameJoins()[0]!.reply();
    await expect(page.locator('[data-sheet="claim"]')).toBeVisible();
    await expect(list.locator('.clock')).toHaveText(cardClockLine({ kind: 'running', what: 'claim', ms: window.deadlines.claim! - window.now - CLAIM_PASS_MARGIN_MS })!);
    expect(await place()).toEqual(was);
    expect(t.pageErrors).toEqual([]);
  });
});
