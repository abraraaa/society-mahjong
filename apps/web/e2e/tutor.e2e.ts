import { expect, test, type Locator, type Page } from '@playwright/test';
import { ALL_TILE_KINDS, isBonusTile, karachi, tileName, type GameProgress } from '@society/engine';
import { cardClockLine } from '../lib/coach/clock';
import { howWon, shortOfLine, washoutLine, winnerLine } from '../lib/coach/coach';
import { titleOf } from '../lib/coach/shape';
import { LONG_NAME } from '../lib/coach/test-games';
import type { CoachHandRef, CoachSegment } from '../lib/coach/types';
import { SAY_BUDGET, textOf, visibleLength } from '../lib/coach/words';
import { SETTLE_MS } from '../lib/table-flow';
import { pauseClock, stayLocal, tapUntilLifted } from './live';

/**
 * The plan strip on the solo table: the player's nearest winning hand, laid
 * out above their tiles. It holds one height so the table never jumps, the
 * table never scrolls, and it fades exactly as many tiles as its caption says
 * are still to go.
 */
async function strip(page: Page) {
  return page.evaluate(() => {
    const s = document.querySelector('.table-stage .plan-strip') as HTMLElement | null;
    const stage = document.querySelector('.table-stage') as HTMLElement;
    const caption = s?.querySelector('.plan-count')?.textContent ?? '';
    return {
      height: s ? s.getBoundingClientRect().height : null,
      scrolls: stage.scrollHeight - stage.clientHeight,
      toGo: /(\d+) tiles? to go/.exec(caption)?.[1] ?? (caption.includes('complete') ? '0' : null),
      faded: s ? s.querySelectorAll('.tile[data-dim="true"]').length : 0,
    };
  });
}

for (const [width, height] of [
  [390, 844],
  [393, 660],
] as const) {
  test(`(t) the plan strip keeps its height and its count at ${width}x${height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height });
    await stayLocal(page);
    await page.goto('/play/solo');
    await expect(page.locator('.table-stage .plan-strip')).toBeVisible();

    const heights = new Set<number>();
    for (let turn = 0; turn < 8; turn++) {
      await page.waitForTimeout(700);
      const s = await strip(page);
      expect(s.scrolls).toBeLessThanOrEqual(0);
      if (s.height !== null) heights.add(Math.round(s.height));
      if (s.toGo !== null) expect(s.faded).toBe(Number(s.toGo));
      const discard = page.locator('.table-stage .action-row .btn-primary:not([disabled])').first();
      const pass = page.getByRole('button', { name: 'Pass', exact: true });
      if (await pass.isVisible()) await pass.click();
      else if (await discard.isVisible()) await discard.click();
    }
    expect([...heights]).toEqual([49]);
    // The strip is a button, so its tiles mustn't be: nested buttons break hydration.
    expect(errors).toEqual([]);
  });
}

/** Taps `target` until `opened` shows: before hydration nothing is listening, so the sheet appearing is the page's own word that the tap counted. */
async function openBy(target: Locator, opened: Locator): Promise<void> {
  await expect(async () => {
    if (!(await opened.isVisible())) await target.click();
    await expect(opened).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

test('(t-card) tapping the plan strip opens the hand, in words and tiles, and it stays open', async ({ page }) => {
  await stayLocal(page);
  await page.goto('/play/solo');
  const strip = page.locator('.table-stage .plan-strip');
  await expect(strip).toBeVisible();
  const title = (await strip.locator('.plan-title').textContent()) ?? '';
  const count = (await strip.locator('.plan-count').textContent()) ?? '';
  const card = page.locator('[data-sheet="card"][data-whose="yours"]');
  await openBy(strip, card);

  await expect(card).toHaveAttribute('aria-label', title);
  await expect(card).toContainText(/The bright tiles are yours|Every tile's yours/);
  if (!/about/i.test((await card.textContent()) ?? '')) {
    const toGo = /(\d+) tiles? to go/.exec(count)?.[1] ?? (count.includes('complete') ? '0' : null);
    expect(toGo, `the strip's count: ${count}`).not.toBeNull();
    await expect(card.locator('.tile[data-dim="true"]')).toHaveCount(Number(toGo));
  }
  // Opening a card mustn't close it again on the next render.
  await page.waitForTimeout(500);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toBeHidden();
});

test('(t-list) the ? sheet lists the hands this round, and each opens its card', async ({ page }) => {
  await stayLocal(page);
  await page.goto('/play/solo');
  const list = page.locator('[data-sheet="list"]');
  await openBy(page.locator('.table-stage').getByRole('button', { name: 'Glossary' }), list);
  await expect(list.getByRole('heading', { name: 'Hands this round' })).toBeVisible();

  const chip = list.locator('.hands-list .chip', { hasText: 'Goulash' });
  await expect(chip).toBeVisible();
  await chip.click();
  const card = page.locator('[data-sheet="card"][aria-label="Goulash"]');
  await expect(card).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card).toBeVisible();

  // Got it goes back to the list it came from, and Got it there closes it.
  await card.getByRole('button', { name: 'Got it' }).click();
  await expect(card).toBeHidden();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: 'Got it' }).click();
  await expect(list).toBeHidden();
});

/**
 * A line as the bubble renders it (`Segments` and `Words` in components/coach.tsx): `<b>` for the action, a span with
 * the button role for a hand's name, and the words between.
 */
type Part = string | { readonly b: string } | { readonly name: string };
const partsOf = (say: readonly CoachSegment[]): Part[] => say.map((x) => (x.hand ? { name: x.text } : x.action ? { b: x.text } : x.text));

/** Puts `parts` in the bubble in place of what it says, measures it, and puts the bubble back as React left it. */
async function measure(page: Page, parts: readonly Part[]): Promise<{ height: number; lineHeight: number; text: string }> {
  return page.evaluate((parts) => {
    const say = document.querySelector('.table-stage .coach .say') as HTMLElement;
    const before = [...say.childNodes];
    say.replaceChildren(
      ...parts.map((p) => {
        if (typeof p === 'string') return document.createTextNode(p);
        if ('b' in p) {
          const b = document.createElement('b');
          b.textContent = p.b;
          return b;
        }
        const name = document.createElement('span');
        name.className = 'term hand';
        name.setAttribute('role', 'button');
        name.tabIndex = 0;
        name.textContent = p.name;
        return name;
      }),
    );
    const out = { height: say.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(say).lineHeight), text: say.textContent ?? '' };
    say.replaceChildren(...before);
    return out;
  }, parts);
}

const named = (title: string): CoachSegment => ({ text: title, hand: { patternId: '', title, shape: '', whose: 'example', layout: [] } satisfies CoachHandRef });
const shortOf = (away: number, title: string): CoachSegment[] => shortOfLine(away, named(title)).map((p) => (typeof p === 'string' ? { text: p } : p));
const rounds: GameProgress[] = ['E', 'S', 'W', 'N'].flatMap((w, i) => [0, 1].map((h) => ({ roundWind: w as 'E', roundIndex: i, handInRound: h, handIndex: 0 })));

/** The longest "{Name} wins with {title}, …" plus " You were {n} short of {title}." that the budget keeps, with a 24-character name. */
function longestResultLine(): CoachSegment[] {
  const tiles = ALL_TILE_KINDS.filter((k) => !isBonusTile(k)).map(tileName);
  const hows = [howWon(null), ...tiles.flatMap((t) => [howWon(t), howWon(t, LONG_NAME)])];
  let best: CoachSegment[] = [];
  let bestLength = 0;
  for (const progress of rounds) {
    const titles = [...new Set(karachi.handSpec(progress).patterns.map(titleOf))];
    for (const won of titles)
      for (const mine of titles)
        for (const how of hows)
          for (let away = 1; away <= 13; away++) {
            const say = [...winnerLine(LONG_NAME, named(won), how), ...shortOf(away, mine)];
            const length = visibleLength(textOf(say));
            if (length <= SAY_BUDGET && length > bestLength) [best, bestLength] = [say, length];
          }
  }
  return best;
}

/** The longest washout line, whole or brief, plus " You were {n} short of {title}." that the budget keeps. */
function longestWashoutLine(): CoachSegment[] {
  let best: CoachSegment[] = [];
  let bestLength = 0;
  for (const progress of rounds)
    for (const mine of new Set(karachi.handSpec(progress).patterns.map(titleOf)))
      for (let away = 1; away <= 13; away++)
        for (const brief of [false, true]) {
          const say = [...washoutLine(brief), ...shortOf(away, mine)];
          const length = visibleLength(textOf(say));
          if (length <= SAY_BUDGET && length > bestLength) [best, bestLength] = [say, length];
        }
  return best;
}

for (const [width, height] of [
  [375, 812],
  [390, 844],
] as const) {
  test(`(t-bubble) the longest lines keep to three lines at ${width}x${height}, with hand names that wrap like words`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await stayLocal(page);
    await page.goto('/play/solo');
    // The dealer's first turn: the bots wait for the player, so nothing redraws the bubble while it's measured.
    await expect(page.locator('.table-stage .coach .say')).toBeVisible();
    const cases: Part[][] = [
      // A switch of plan (S1), the longest measured.
      [{ b: 'Discard Green Dragon' }, '. Switching to ', { name: 'Monty Wriggly Snake v2' }, ": it's a tile closer than ", { name: 'Lilly of the Valley' }, '.'],
      // The round's general hand catching up (S1t).
      [{ b: 'Discard 9 Characters' }, '. Switching to ', { name: 'Any Damn Hand' }, ": it's as close as ", { name: "Dirty Gertie's Garter" }, ', and easier.'],
      // A kong that rules out every run hand (C2x).
      [{ b: 'Kong' }, " it: you'll be three tiles from ", { name: 'Monty Wriggly Snake v2' }, ', but it rules out every run hand.'],
      // The first line that took a fourth line when names were buttons.
      [{ b: 'Discard 5 Dots' }, '. Switching to ', { name: 'Any Damn Hand' }, ': ', { name: 'Monty Wriggly Snake v2' }, " can't be made now."],
      partsOf(longestResultLine()),
      // A washout, and how close the player got.
      partsOf(longestWashoutLine()),
    ];
    for (const parts of cases) {
      const m = await measure(page, parts);
      expect(m.height, `"${m.text}" (${visibleLength(m.text)}) at ${width}px`).toBeLessThanOrEqual(3 * m.lineHeight + 1);
    }

    // And the page's own tappable words are those spans: a button can't wrap, and drawn as buttons the fourth case above takes four lines.
    let checked = false;
    for (let turn = 0; turn < 24 && !checked; turn++) {
      const words = page.locator('.table-stage .coach .say .term');
      if ((await words.count()) > 0) {
        const tags = await words.evaluateAll((els) => els.map((e) => `${e.tagName}:${e.getAttribute('role')}`));
        expect(
          tags.every((t) => t === 'SPAN:button'),
          tags.join(),
        ).toBe(true);
        checked = true;
        break;
      }
      const pass = page.locator('.sheet').getByRole('button', { name: 'Pass', exact: true });
      const discard = page.locator('.table-stage .action-row').getByRole('button', { name: /^Discard / });
      if (await pass.isVisible()) await pass.click();
      else if ((await discard.isVisible()) && (await discard.isEnabled())) await discard.click();
      await page.waitForTimeout(700);
      if (await page.getByRole('button', { name: 'Next hand' }).isVisible()) break;
    }
    expect(checked, 'a tappable word in the bubble within a hand').toBe(true);
  });
}

/** What the loop needs from the page, in one round trip. */
function scene(page: Page) {
  return page.evaluate(() => {
    const enabled = (b: Element) => !(b as HTMLButtonElement).disabled;
    const inSheets = [...document.querySelectorAll('.sheet button')];
    const row = [...document.querySelectorAll('.table-stage .action-row button')];
    return {
      over: inSheets.some((b) => b.textContent === 'Next hand' || b.textContent === 'Play again'),
      claimWin: inSheets.some((b) => b.textContent === 'Mahjong!' && enabled(b)),
      // The claim the tutor advises is the claim sheet's primary button.
      advised: [...document.querySelectorAll('[data-sheet="claim"] .btn-primary')].some(enabled),
      pass: inSheets.some((b) => b.textContent === 'Pass' && enabled(b)),
      win: row.some((b) => b.textContent === 'Mahjong!' && enabled(b)),
      discard: row.some((b) => b.textContent?.startsWith('Discard ') && enabled(b)),
    };
  });
}

test("(t-result) the result line's hand name opens its card: the winning hand, every tile lit, or after a washout the player's own", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await stayLocal(page);
  await page.clock.install();
  const stage = page.locator('.table-stage');
  const result = page.locator('.sheet', { has: page.getByRole('button', { name: 'Next hand' }) });

  // The deal is random per visit, and most first hands wash out: every visit checks the card its line names, and
  // the test deals again, up to three visits, until it has seen a winner's card too.
  let won = false;
  let checked = 0;
  for (let visit = 0; visit < 3 && !won; visit++) {
    await page.clock.resume();
    await page.goto('/play/solo');
    const first = stage.locator('.hand-tray button.tile').first();
    await tapUntilLifted(first);
    await first.click();
    await pauseClock(page);
    await page.clock.runFor(SETTLE_MS + 100);

    // Play the hand out on the tutor's advice, taking any win offered and any claim it advises.
    for (let i = 0; ; i++) {
      expect(i, 'the hand ends').toBeLessThan(800);
      const s = await scene(page);
      if (s.over) break;
      if (s.claimWin) await page.locator('.sheet').getByRole('button', { name: 'Mahjong!' }).click();
      else if (s.advised) await page.locator('[data-sheet="claim"] .btn-primary').click();
      else if (s.pass) await page.locator('.sheet').getByRole('button', { name: 'Pass', exact: true }).click();
      else if (s.win) await stage.locator('.action-row').getByRole('button', { name: 'Mahjong!' }).click();
      else if (s.discard)
        await stage
          .locator('.action-row')
          .getByRole('button', { name: /^Discard / })
          .click();
      await page.clock.runFor(500);
    }

    const washout = (await result.locator('h2').textContent()) === 'Washed out';
    const name = result.locator('.term.hand');
    if ((await name.count()) === 0) {
      // Only a washout that left the player no hand they could still make has no hand to name.
      expect(washout, 'a win always names the hand').toBe(true);
      continue;
    }
    const card = page.locator('[data-sheet="card"]');
    await name.first().click();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-label', (await name.first().textContent()) ?? '');
    if (washout) {
      // How close the player got: their own nearest lay-out, or the hand's example when it has none.
      expect(['yours', 'example']).toContain(await card.getAttribute('data-whose'));
    } else {
      // The winner's own tiles, or the example when their lay-out couldn't be worked out in time: nothing faded either way.
      expect(['winner', 'example']).toContain(await card.getAttribute('data-whose'));
      await expect(card.locator('.tile')).not.toHaveCount(0);
      await expect(card.locator('.tile[data-dim="true"]')).toHaveCount(0);
      won = true;
    }
    checked++;
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();
  }
  expect(checked, 'a result line named a hand, and its card was checked').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

/** The claim sheet, if one's up: whether it has a countdown, and which tappable words its line has. */
function claimScene(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-sheet="claim"]');
    return { timed: !!sheet?.querySelector('.timer'), hand: !!sheet?.querySelector('.term.hand'), word: !!sheet?.querySelector('.term:not(.hand)') };
  });
}

test('(t-claim) on the bots, a card or a word opened over a claim holds its countdown, which runs on from there once it closes', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await stayLocal(page);
  await page.clock.install();
  const stage = page.locator('.table-stage');
  const claim = page.locator('[data-sheet="claim"]');
  const pass = claim.getByRole('button', { name: 'Pass', exact: true });
  const next = page.locator('.sheet').getByRole('button', { name: 'Next hand' });
  // First a hand's name, then a word, each opened over a claim of its own.
  const todo = [
    { has: 'hand' as const, tap: claim.locator('.term.hand'), opened: page.locator('[data-sheet="card"]') },
    { has: 'word' as const, tap: claim.locator('.term:not(.hand)'), opened: page.locator('[data-sheet="term"]') },
  ];

  // The deal is random per visit: up to three hands a visit, and three visits, to find a timed claim whose line has each.
  for (let visit = 0; visit < 3 && todo.length > 0; visit++) {
    await page.clock.resume();
    await page.goto('/play/solo');
    const first = stage.locator('.hand-tray button.tile').first();
    await tapUntilLifted(first);
    await first.click();
    await pauseClock(page);
    await page.clock.runFor(SETTLE_MS + 100);

    for (let hand = 0; hand < 3 && todo.length > 0; hand++) {
      for (let i = 0; todo.length > 0; i++) {
        expect(i, 'the hand ends').toBeLessThan(800);
        const c = await claimScene(page);
        const want = todo[0]!;
        if (c.timed && c[want.has]) {
          // This window's sheet: a claim that passes goes, and a later window's is another sheet.
          const sheet = await claim.elementHandle();
          const up = () => sheet!.evaluate((e) => e.isConnected);
          // Part of the countdown spent: 8 s at most were left when the sheet was seen.
          await page.clock.runFor(2_500);
          await want.tap.first().click();
          await expect(want.opened).toBeVisible();
          await expect(claim.locator('.timer')).toHaveAttribute('data-paused', 'true');
          await expect(want.opened.locator('.clock')).toHaveText(cardClockLine({ kind: 'paused' })!);
          // Reading costs nothing: the bots wait, and the claim with them.
          await page.clock.runFor(20_000);
          expect(await up(), 'the claim still up after twenty seconds of reading').toBe(true);
          await expect(pass).toBeVisible();

          // Closed, the countdown runs on from where it stopped: about 5 to 5.5 s. One started again (8 s) would
          // still be up after 6 s.
          await want.opened.getByRole('button', { name: 'Got it' }).click();
          await expect(want.opened).toBeHidden();
          await expect(claim.locator('.timer')).not.toHaveAttribute('data-paused', 'true');
          await page.clock.runFor(4_000);
          expect(await up(), 'the claim still up 4 s after closing').toBe(true);
          await page.clock.runFor(2_000);
          await expect.poll(up, { message: 'the claim passed 6 s after closing' }).toBe(false);
          todo.shift();
          continue;
        }
        const s = await scene(page);
        if (s.over) break;
        // A claim with a win offered has no countdown, and one without the word wanted is let go.
        if (s.pass) await page.locator('.sheet').getByRole('button', { name: 'Pass', exact: true }).click();
        else if (s.win) await stage.locator('.action-row').getByRole('button', { name: 'Mahjong!' }).click();
        else if (s.discard)
          await stage
            .locator('.action-row')
            .getByRole('button', { name: /^Discard / })
            .click();
        await page.clock.runFor(500);
      }
      if (todo.length === 0 || !(await next.isVisible())) break;
      // The table lets a tap go for a moment after a hand ends, and again after the next is dealt.
      await page.clock.runFor(SETTLE_MS + 100);
      await next.click();
      await page.clock.runFor(SETTLE_MS + 100);
    }
  }
  expect(
    todo.map((t) => t.has),
    'a timed claim whose line had a hand name, and then one with a word',
  ).toEqual([]);
  expect(errors).toEqual([]);
});
