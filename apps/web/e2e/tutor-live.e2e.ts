import { expect, test } from '@playwright/test';
import { cardClockLine } from '../lib/coach/clock';
import { cardCaption } from '../lib/coach/hand-card';
import { TAUGHT_KEY, handNote, noteText } from '../lib/coach/teach';
import { textOf } from '../lib/coach/words';
import { riverOrder } from '../lib/river';
import { POLL_MS } from '../lib/table-sync';
import { ok, openTable, pauseClock } from './live';
import { liveCoach, tutorFixtures } from './tutor-fixtures';

/**
 * The tutor at a live table, on scenes made by the engine alone
 * (tutor-fixtures.ts): hand names that open the hand's card, wherever the
 * tutor says them, a card over a claim that shows the table's clock, and the
 * footnotes a first-timer gets the first time a hand or a flower comes up,
 * which stay for as long as the line they came with.
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

    // A card over a live claim gets out of the way with a few seconds left, so it can't be open when the sheet passes
    // for Amna. It can be when the table moves on without this phone. Both windows can have the same discarder's name
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

  test("(l-clock) a card over a live claim shows the table's clock, and gets out of the way while there's time to answer", async ({ page }) => {
    const fx = tutorFixtures();
    const t = await openTable(page, { view: () => ok(fx.claim), act: () => 'hold' }, { clock: true });
    const sheet = page.locator('[data-sheet="claim"]');
    await expect(sheet.locator('.term.hand').first()).toBeVisible();
    // The live table draws nothing until it has the table in hand, so it's listening by now, and the sheet's
    // countdown has begun: from here the page's timers fire only when the test says.
    await pauseClock(page);
    const card = page.locator('[data-sheet="card"]');
    await sheet.locator('.term.hand').first().click();
    await expect(card).toBeVisible();
    // Nobody can hold the table's clock, so the card says it's still running, and how long is left.
    const running = cardClockLine({ kind: 'running', what: 'claim', ms: 0 })!.replace(/0:00\.$/, '');
    await expect(card.locator('.clock')).toContainText(running);
    await expect(card.locator('.clock')).toHaveText(/0:\d\d/);
    await expect(sheet.locator('.timer')).not.toHaveAttribute('data-paused', 'true');

    // The sheet passes for Amna 8.5 s in. The card steps aside with 4 s of that left, and no look comes before 12 s.
    await page.clock.runFor(6_000);
    await expect(card).toBeHidden();
    await expect(sheet).toBeVisible();
    expect(t.count('act'), 'the sheet still waiting for her').toBe(0);
    // And the card never held the clock: the sheet passes on time.
    await page.clock.runFor(3_000);
    await expect.poll(() => t.of('act').map((c) => c.body?.action.type)).toEqual(['pass']);
    expect(t.pageErrors).toEqual([]);
  });
});
