import { expect, test, type Page } from '@playwright/test';
import { tileName, type PrivatePlayerView } from '@society/engine';
import { FIRST_LOOK_NOTE } from '../lib/coach';
import { cardClockLine } from '../lib/coach/clock';
import { cardCaption } from '../lib/coach/hand-card';
import { TAUGHT_KEY, handNote, noteText } from '../lib/coach/teach';
import { textOf } from '../lib/coach/words';
import { CLAIM_PASS_MARGIN_MS } from '../lib/live/timing';
import type { GameSnapshot } from '../lib/live/snapshot';
import { riverOrder } from '../lib/river';
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
 * claim sheet leaves to the table's clock rather than passing on, the
 * footnotes a first-timer gets the first time a hand, a flower or a run tile
 * going past comes up, which stay for as long as the line they came with, the
 * round's aim for someone who takes a bot's seat over part-way through, and a
 * kong that costs nothing lit as the tip.
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
    // The toast's words are the table's to choose (the server lane words a move made on the clock, with any table news
    // beside it), so only what it's about is checked here.
    await expect(t.toast()).toContainText('Mahjong');
    await expect(page.locator('.sheet h2', { hasText: 'Mahjong!' })).toBeVisible();
    expect(t.count('act')).toBe(0);
    expect(t.pageErrors).toEqual([]);
  });

  test("(l-win-bar) a live win's bar still runs to the table's deadline when a fresh table comes in part-way through", async ({ page }) => {
    const { before, window } = tutorFixtures().winClaim;
    // A win runs on the turn clock: ninety seconds for someone new. The page looks again every twelve, and each fresh
    // table says only what's left.
    const long: GameSnapshot = { ...window, deadlines: { ...window.deadlines, claim: window.now + 90_000 } };
    const fresh: GameSnapshot = { ...long, now: long.now + POLL_MS };
    const t = await openTable(page, { view: (n) => (n === 0 ? 'hold' : ok(n === 1 ? before : n === 2 ? long : fresh)), act: () => 'hold' }, { holdGameJoins: true, clock: true });
    await expect.poll(() => t.count('view')).toBe(1);
    await pauseClock(page);
    t.realtime.gameJoins()[0]!.reply();
    await expect.poll(() => t.count('view')).toBe(2);
    const sheet = page.locator('[data-sheet="claim"]');
    await expect(sheet.getByRole('button', { name: 'Mahjong!' })).toBeVisible();
    // The bar's drain, as the browser runs it: how long it lasts, how far in it started, and how far through it is.
    const drain = () =>
      sheet.locator('.timer > i').evaluate((e) => {
        const timing = e.getAnimations()[0]!.effect!.getComputedTiming();
        return { duration: Number(timing.duration), delay: Number(timing.delay), through: (Number(timing.localTime) - Number(timing.delay)) / Number(timing.duration) };
      });
    expect(await drain()).toMatchObject({ duration: 90_000, delay: 0 });

    // The slow poll brings a fresh table twelve seconds in. The bar is drawn again from where it stands, twelve seconds
    // through the ninety, with seventy-eight to run: it empties as the table's clock runs out, not early.
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBe(3);
    await expect.poll(async () => (await drain()).delay).toBe(-POLL_MS);
    const now = await drain();
    expect(now.duration + now.delay).toBe(90_000 - POLL_MS);
    expect(now.through).toBeGreaterThanOrEqual(POLL_MS / 90_000);
    expect(now.through).toBeLessThan((POLL_MS + 5_000) / 90_000);
    expect(t.count('act'), 'no pass on a win').toBe(0);
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

  test("(l-take-over) someone who takes a bot's seat over mid-hand gets the round's aim, with a footnote, until they make a move of their own", async ({ page }) => {
    const { theirs, mine, after, later } = tutorFixtures().takeOver;
    // Bilal's turn when Amna takes the seat over: the next looks bring her turn, then (after her discard) her next one.
    let table = theirs;
    const t = await openTable(page, { view: () => ok(table), act: () => ok(after) }, { clock: true });
    const bubble = t.stage().locator('.coach');
    const say = bubble.locator('.say');
    const note = bubble.locator('[data-note="firstLook"]');
    const first = liveCoach(theirs);
    // The bot had already thrown for the seat, so without the take-over there'd be nothing to say on someone else's turn.
    expect(textOf(first.say)).toContain(first.goal.aim);
    await expect(say).toHaveText(textOf(first.say));
    await expect(note).toHaveText(noteText(FIRST_LOOK_NOTE));
    // "The row above them": the plan, laid out above her tiles.
    const strip = t.stage().locator('.plan-strip');
    await expect(strip).toBeVisible();
    // The strip is drawn from the plan's hand whether or not the plan is kept, so check the plan itself: its line is in
    // the bubble too, shown there on a short landscape screen, where the strip isn't drawn.
    await expect(bubble.locator('.plan')).toHaveText((await strip.locator('.plan').textContent())!);
    await pauseClock(page);
    const lookAgain = async () => {
      const looks = t.count('view');
      await page.clock.runFor(POLL_MS);
      await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    };

    // Her turn, before a move of her own: the aim again, and the tutor's tile on the Discard button. The footnote's taught.
    table = mine;
    await lookAgain();
    const tip = liveCoach(mine).action;
    if (tip.kind !== 'discard') throw new Error('the fixture offers a discard');
    await expect(t.discard()).toHaveText(`Discard ${tileName(tip.tile)}`);
    await expect(say).toHaveText(textOf(first.say));
    await expect(note).toHaveCount(0);

    // Her discard is her own first move: from her next turn the tutor talks to her as to anyone, starting with why.
    await t.discard().click();
    await expect.poll(() => t.of('act').map((c) => c.body?.action)).toEqual([{ type: 'discard', seat: 0, tile: tip.tile }]);
    table = later;
    await lookAgain();
    const next = textOf(liveCoach(later).say);
    expect(next).toMatch(/^Discard /);
    expect(next).not.toContain(first.goal.aim);
    await expect(say).toHaveText(next);
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-kong) a kong that costs her hand nothing is the lit button, and Discard steps back but still offers a tile', async ({ page }) => {
    const snap = tutorFixtures().kongTurn;
    const coach = liveCoach(snap);
    const tip = coach.action;
    if (tip.kind !== 'kong' || !tip.discard) throw new Error('the fixture advises a kong, with a tile to let go instead');
    const hand = (snap.view as PrivatePlayerView).concealed;
    const t = await openTable(page, { view: () => ok(snap) });
    const row = t.stage().locator('.action-row');
    const kong = row.getByRole('button', { name: `Kong ${tileName(tip.tile)}`, exact: true });
    await expect(kong).toHaveClass(/\bbtn-primary\b/);
    const discard = row.locator('.btn-discard');
    await expect(discard).toBeEnabled();
    await expect(discard).toHaveClass(/\bbtn-ghost\b/);
    await expect(discard).toHaveText(`Discard ${tileName(tip.discard)}`);
    // Stepping back doesn't narrow it: the Discard button keeps its width whatever its style.
    expect((await discard.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(13.25 * 16 - 1);
    const lead = t.stage().locator('.coach .say b').first();
    expect((await lead.textContent()) ?? '').toMatch(/^Kong /);
    await expect(t.stage().locator('.coach .say')).toHaveText(textOf(coach.say));
    // A pick of her own makes Discard the lit button again, with her tile.
    const other = hand.findIndex((k) => k !== tip.tile && k !== tip.discard);
    const picked = `Discard ${tileName(hand[other]!)}`;
    // A tap straight after the table arrives is let go (the settling time), so tap until the pick shows.
    await expect(async () => {
      if ((await discard.textContent()) !== picked) await t.stage().locator('.hand-tray .tile').nth(other).click();
      await expect(discard).toHaveText(picked, { timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await expect(discard).toHaveClass(/\bbtn-primary\b/);
    expect(t.pageErrors).toEqual([]);
  });

  test("(l-take-over-turn) taken over on her own turn: the aim and the footnote first, and the tutor's tile still offered", async ({ page }) => {
    const snap = tutorFixtures().takeOverOnTurn;
    const coach = liveCoach(snap);
    if (coach.action.kind !== 'discard') throw new Error('the fixture offers a discard');
    const t = await openTable(page, { view: () => ok(snap) });
    const bubble = t.stage().locator('.coach');
    expect(textOf(coach.say)).toContain(coach.goal.aim);
    await expect(bubble.locator('.say')).toHaveText(textOf(coach.say));
    await expect(bubble.locator('[data-note="firstLook"]')).toHaveText(noteText(FIRST_LOOK_NOTE));
    await expect(t.discard()).toHaveText(`Discard ${tileName(coach.action.tile)}`);
    await expect(t.discard()).toBeEnabled();
    // Lit in her hand, as on any turn.
    await expect(t.stage().locator('.hand-dock .tile[data-coached="true"]').first()).toBeVisible();
    expect(t.pageErrors).toEqual([]);
  });
});
