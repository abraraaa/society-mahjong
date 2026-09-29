import { expect, test, type Locator, type Page } from '@playwright/test';
import { karachi, tileName, type PrivatePlayerView } from '@society/engine';
import { FIRST_LOOK_NOTE } from '../lib/coach';
import { cardClockLine } from '../lib/coach/clock';
import { exchangeGlow, exchangeHeading, exchangeProgress, exchangeStep, goesToLine, passedLine, tileKeys } from '../lib/coach/exchange';
import { cardCaption } from '../lib/coach/hand-card';
import { TAUGHT_KEY, handNote, noteText } from '../lib/coach/teach';
import { isolate, textOf } from '../lib/coach/words';
import { CLAIM_PASS_MARGIN_MS } from '../lib/live/timing';
import type { GameSnapshot } from '../lib/live/snapshot';
import { riverOrder } from '../lib/river';
import { POLL_MS } from '../lib/table-sync';
import { flush, ok, openTable, pauseClock, tapUntilLifted, type LiveTable } from './live';
import { liveCoach, spareCopy, tutorFixtures } from './tutor-fixtures';

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
 * round's aim for someone who takes a bot's seat over part-way through, a
 * kong that costs nothing lit as the tip, and a West exchange sheet that says
 * which way each pass goes and stays up from one pass to the next.
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
    // The bar's drain, as the browser runs it: how long it lasts, how far in it started, and how far through it is. A
    // fresh table draws the bar again as a new element, so the one the locator found can be gone by the time it's read:
    // that reads as no drain yet, and the polls look again.
    const drain = () =>
      sheet.locator('.timer > i').evaluate((e) => {
        const timing = e.getAnimations()[0]?.effect?.getComputedTiming();
        if (!timing) return null;
        return { duration: Number(timing.duration), delay: Number(timing.delay), through: (Number(timing.localTime) - Number(timing.delay)) / Number(timing.duration) };
      });
    await expect.poll(drain).toMatchObject({ duration: 90_000, delay: 0 });

    // The slow poll brings a fresh table twelve seconds in. The bar is drawn again from where it stands, twelve seconds
    // through the ninety, with seventy-eight to run: it empties as the table's clock runs out, not early.
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBe(3);
    await expect.poll(async () => (await drain())?.delay).toBe(-POLL_MS);
    const now = (await drain())!;
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

  test('(l-exchange) the exchange sheet says which way and which pass, lights only the suggested copies, and stays up between passes', async ({ page }) => {
    const { westSent, westWaiting, westLanded } = tutorFixtures();
    let table = westSent;
    const t = await openTable(
      page,
      {
        view: () => ok(table),
        act: () => {
          table = westWaiting;
          return ok(westWaiting);
        },
      },
      { clock: true },
    );
    const sheet = page.locator('.sheet[data-sheet="exchange"]');
    const tiles = sheet.locator('button.tile');
    const coached = sheet.locator('button.tile[data-coached="true"]');
    const pass = sheet.getByRole('button', { name: 'Pass tiles' });
    await expect(sheet).toBeVisible();
    await pauseClock(page);
    // Past the moment after the table arrives when a tap is let go, so her taps count.
    await page.clock.runFor(500);

    // Which way, and which pass: the first, to the right, so to Bilal.
    const view = westSent.view as PrivatePlayerView;
    const first = exchangeStep(karachi.handSpec(view.progress), 0)!;
    await expect(sheet.locator('h2')).toHaveText(`${exchangeHeading(first, 3)} · ${exchangeProgress(first)}`);
    expect(await sheet.locator('h2').textContent()).toBe(`${exchangeHeading(first, 3)} · ${exchangeProgress(first)}`);
    await expect(sheet).toContainText(goesToLine(isolate('Bilal')));

    // The tutor's three are lit, and stay lit as she picks them.
    const tip = liveCoach(westSent).action;
    if (tip.kind !== 'exchange') throw new Error('the fixture is an exchange');
    const lit = exchangeGlow(view.concealed, tip.tiles).flatMap((on, i) => (on ? [i] : []));
    expect(lit).toHaveLength(3);
    await expect(coached).toHaveCount(3);
    for (const i of lit) await expect(tiles.nth(i)).toHaveAttribute('data-coached', 'true');
    await tapUntilLifted(tiles.nth(lit[0]!));
    await expect(coached).toHaveCount(3);
    await expect(tiles.nth(lit[1]!)).toHaveAttribute('data-coached', 'true');
    await expect(tiles.nth(lit[2]!)).toHaveAttribute('data-coached', 'true');
    await tiles.nth(lit[1]!).click();
    await tiles.nth(lit[2]!).click();
    // Where the heading and the Pass button sit on her pass: neither moves from here to the next pass.
    const at = await placesOf(sheet);

    // She passes, and Bilal hasn't: the same sheet, which for a moment changes nothing but the tiles.
    const handle = await sheet.elementHandle();
    await pass.click();
    await expect.poll(() => t.of('act').map((c) => c.body?.action)).toEqual([{ type: 'exchange', seat: 0, tiles: lit.map((i) => view.concealed[i]) }]);
    await expect(coached).toHaveCount(0);
    await expect(pass).toBeDisabled();
    expect(await handle!.evaluate((e) => e.isConnected)).toBe(true);
    await expect(sheet).not.toHaveAttribute('data-waiting');
    await expect(sheet).toContainText(goesToLine(isolate('Bilal')));
    // The tiles she passed are still in her hand until everyone has passed, lifted as she left them.
    for (const i of lit) await expect(tiles.nth(i)).toHaveAttribute('data-selected', 'true');

    // A wait that lasts says who it's for, and lets the table above it be used.
    await page.clock.runFor(700);
    await expect(sheet).toHaveAttribute('data-waiting', 'true');
    await expect(sheet).toContainText(passedLine(isolate('Bilal')));
    // The shorter line leaves the sheet as tall as it was.
    expect(await placesOf(sheet)).toEqual(at);
    await t.stage().getByRole('button', { name: 'Glossary' }).click();
    const list = page.locator('[data-sheet="list"]');
    await expect(list).toBeVisible();
    await list.getByRole('button', { name: 'Got it' }).click();
    await expect(list).toBeHidden();
    // The Leave confirmation draws over the waiting sheet: a plain click on Stay fails if anything covers it.
    await t.stage().getByRole('button', { name: 'Leave' }).click();
    const confirm = page.getByRole('dialog', { name: 'Leave the table?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Stay' }).click();
    await expect(confirm).toBeHidden();
    expect(await handle!.evaluate((e) => e.isConnected)).toBe(true);

    // Bilal passes and the bots pass again: the next pass, across, on the same sheet, with nothing picked.
    table = westLanded;
    const looks = t.count('view');
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    const next = exchangeStep(karachi.handSpec(view.progress), 1)!;
    await expect(sheet.locator('h2')).toHaveText(`${exchangeHeading(next, 3)} · ${exchangeProgress(next)}`);
    await expect(sheet.locator('h2')).toContainText('across');
    await expect(sheet.locator('h2')).toContainText('2 of 3');
    expect(await handle!.evaluate((e) => e.isConnected)).toBe(true);
    await expect(sheet).not.toHaveAttribute('data-waiting');
    await expect(sheet.locator('button.tile[data-selected="true"]')).toHaveCount(0);
    await expect(coached).toHaveCount(3);
    expect(await placesOf(sheet)).toEqual(at);
    // She holds more of one kind than the tutor suggests passing: exactly the suggested copies are lit, not every copy.
    const hand = (westLanded.view as PrivatePlayerView).concealed;
    const nextTip = liveCoach(westLanded).action;
    if (nextTip.kind !== 'exchange') throw new Error('the fixture is an exchange');
    const kind = spareCopy(hand, nextTip.tiles)!;
    const name = tileName(kind);
    const held = hand.filter((k) => k === kind).length;
    const suggested = nextTip.tiles.filter((k) => k === kind).length;
    expect(held).toBeGreaterThan(suggested);
    await expect(sheet.locator(`button.tile[aria-label="${name}"]`)).toHaveCount(held);
    await expect(sheet.locator(`button.tile[aria-label="${name}"][data-coached="true"]`)).toHaveCount(suggested);
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-exchange-turned) the phone turned while she waits: the heading and Pass button stay where they are when the next pass comes', async ({ page }) => {
    const { westSent, westWaiting, westLanded } = tutorFixtures();
    let table = westSent;
    await page.setViewportSize({ width: 393, height: 852 });
    const t = await openTable(
      page,
      {
        view: () => ok(table),
        act: () => {
          table = westWaiting;
          return ok(westWaiting);
        },
      },
      { clock: true },
    );
    const sheet = page.locator('.sheet[data-sheet="exchange"]');
    const tiles = sheet.locator('button.tile');
    await expect(sheet).toBeVisible();
    await pauseClock(page);
    await page.clock.runFor(500);

    // The first pass, upright: the tutor's three, passed.
    const view = westSent.view as PrivatePlayerView;
    const tip = liveCoach(westSent).action;
    if (tip.kind !== 'exchange') throw new Error('the fixture is an exchange');
    const lit = exchangeGlow(view.concealed, tip.tiles).flatMap((on, i) => (on ? [i] : []));
    await tapUntilLifted(tiles.nth(lit[0]!));
    await tiles.nth(lit[1]!).click();
    await tiles.nth(lit[2]!).click();
    await sheet.getByRole('button', { name: 'Pass tiles' }).click();
    await expect.poll(() => t.count('act')).toBe(1);
    await page.clock.runFor(700);
    await expect(sheet).toHaveAttribute('data-waiting', 'true');

    // She turns the phone on its side while the short wait line shows.
    await page.setViewportSize({ width: 852, height: 393 });
    const at = await placesOf(sheet);

    // The next pass, whose line is longer than the wait's, finds the sheet already tall enough for it.
    table = westLanded;
    const looks = t.count('view');
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    await expect(sheet.locator('h2')).toContainText('2 of 3');
    await expect(sheet).not.toHaveAttribute('data-waiting');
    expect(await placesOf(sheet)).toEqual(at);
    expect(t.pageErrors).toEqual([]);
  });

  test('(l-exchange-swept) a pass the table made for her lifts the tiles it passed, and the next pass starts with nothing picked', async ({ page }) => {
    const { westSent, westWaiting, westLanded } = tutorFixtures();
    let table = westSent;
    const t = await openTable(page, { view: () => ok(table), act: () => 'hold' }, { clock: true });
    const sheet = page.locator('.sheet[data-sheet="exchange"]');
    const tiles = sheet.locator('button.tile');
    const selected = sheet.locator('button.tile[data-selected="true"]');
    await expect(sheet).toBeVisible();
    await pauseClock(page);
    await page.clock.runFor(500);

    // She picks three tiles the tutor didn't light, and ones she'll still hold on the next pass, by kind and copy.
    const view = westSent.view as PrivatePlayerView;
    const tip = liveCoach(westSent).action;
    if (tip.kind !== 'exchange') throw new Error('the fixture is an exchange');
    const lit = exchangeGlow(view.concealed, tip.tiles);
    const keys = tileKeys(view.concealed);
    const later = tileKeys((westLanded.view as PrivatePlayerView).concealed);
    const mine = keys.flatMap((k, i) => (!lit[i] && later.includes(k) ? [i] : [])).slice(0, 3);
    expect(mine).toHaveLength(3);
    await tapUntilLifted(tiles.nth(mine[0]!));
    await tiles.nth(mine[1]!).click();
    await tiles.nth(mine[2]!).click();
    await expect(selected).toHaveCount(3);

    // Before she taps Pass, the table's clock passes the tutor's three for her: what's lifted is what went, not her picks.
    table = westWaiting;
    let looks = t.count('view');
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    await expect(sheet.getByRole('button', { name: 'Pass tiles' })).toBeDisabled();
    const passed = (westWaiting.view as PrivatePlayerView).myExchange;
    expect([...(passed ?? [])].sort()).toEqual([...tip.tiles].sort());
    await expect(selected).toHaveCount(3);
    for (const [i, on] of lit.entries()) {
      if (on) await expect(tiles.nth(i)).toHaveAttribute('data-selected', 'true');
      else await expect(tiles.nth(i)).not.toHaveAttribute('data-selected');
    }
    await page.clock.runFor(700);
    await expect(sheet).toHaveAttribute('data-waiting', 'true');
    await expect(selected).toHaveCount(3);
    for (const i of mine) await expect(tiles.nth(i)).not.toHaveAttribute('data-selected');
    expect(t.of('act')).toEqual([]);

    // The next pass: her old picks are still in her hand, and none of them is picked.
    table = westLanded;
    looks = t.count('view');
    await page.clock.runFor(POLL_MS);
    await expect.poll(() => t.count('view')).toBeGreaterThan(looks);
    await expect(sheet.locator('h2')).toContainText('2 of 3');
    await expect(sheet.getByRole('button', { name: 'Pass tiles' })).toBeDisabled();
    await expect(selected).toHaveCount(0);
    expect(t.pageErrors).toEqual([]);
  });
});

/** Where the exchange sheet's heading and Pass button are on the screen, once the sheet has finished sliding in. */
async function placesOf(sheet: Locator): Promise<{ heading: number; pass: number }> {
  const place = async () => {
    const heading = await sheet.locator('h2').boundingBox();
    const pass = await sheet.getByRole('button', { name: 'Pass tiles' }).boundingBox();
    return { heading: Math.round(heading!.y), pass: Math.round(pass!.y) };
  };
  let last = await place();
  for (;;) {
    await sheet.page().waitForTimeout(150);
    const now = await place();
    if (now.heading === last.heading && now.pass === last.pass) return now;
    last = now;
  }
}
