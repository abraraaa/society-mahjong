import { expect, test, type Page } from '@playwright/test';
import { karachi, startHand, type TileKind } from '@society/engine';
import { ERROR_COPY } from '../lib/report-error';
import { SETTLE_MS } from '../lib/table-flow';
import { pauseClock, stayLocal, tapUntilLifted } from './live';

/** Bot moves allowed for one hand before the test gives up on it ever ending. A hand takes well under this. */
const MAX_STEPS = 800;
/** A little over the solo table's pause before each round of bot moves. */
const BOT_STEP_MS = 500;

/** The hand after the first, for seat 0 of a solo game dealt from `seed`. Seat 0 never wins here, so the deal passes to seat 1. */
function secondHand(seed: string): TileKind[] {
  return startHand(karachi, { seed, progress: { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 }, dealer: 1 }).players[0].concealed.slice();
}

interface TableState {
  readonly over: boolean;
  readonly claim: boolean;
  readonly discard: string | null;
  readonly hand: readonly { readonly kind: string; readonly selected: boolean }[];
  readonly river: string;
  readonly broken: boolean;
}

/** Everything the loop needs from the page, in one round trip. */
function read(page: Page): Promise<TableState> {
  return page.evaluate((errorHeading) => {
    const stage = document.querySelector('.table-stage');
    const sheet = document.querySelector('.sheet');
    const buttons = [...(sheet?.querySelectorAll('button') ?? [])];
    const discard = [...(stage?.querySelectorAll('.action-row button') ?? [])].find((b) => b.textContent?.startsWith('Discard ') && !(b as HTMLButtonElement).disabled);
    return {
      over: buttons.some((b) => b.textContent === 'Next hand'),
      claim: buttons.some((b) => b.textContent === 'Pass'),
      discard: discard?.textContent ?? null,
      hand: [...(stage?.querySelectorAll('.hand-tray button.tile') ?? [])].map((t) => ({
        kind: /\/tiles\/(\w+)\.svg/.exec(t.getAttribute('style') ?? '')?.[1] ?? '?',
        selected: t.getAttribute('data-selected') === 'true',
      })),
      river: stage?.querySelector('.felt .label:last-child')?.textContent ?? '',
      broken: [...document.querySelectorAll('h1')].some((h) => h.textContent === errorHeading),
    };
  }, ERROR_COPY.heading);
}

test('(g) solo: a tile lifted while the bots move is let go at the next hand, and Discard never breaks the page', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await stayLocal(page);
  await page.clock.install();

  const stage = page.locator('.table-stage');
  const tiles = stage.locator('.hand-tray button.tile');
  const tileOf = (kind: string) => stage.locator(`.hand-tray button.tile[style*="/tiles/${kind}.svg"]`).first();

  // The deal is random per visit. Read this visit's seed from the page to know the next hand's tiles, and make
  // sure the first hand holds one of them: that's the tile the test keeps lifting. A first hand that ends on the
  // player's own move (a discard the wall can't answer, or a Pass; either lets go of the pick) ends with nothing
  // lifted and can't show the rule, so the test deals again rather than pass without having looked. About one
  // deal in five does; eight in a row is out of reach.
  let next: TileKind[] = [];
  let lifted: string | null = null;
  for (let visit = 0; ; visit++) {
    expect(visit, 'a deal whose first hand ends with a tile of the second lifted').toBeLessThan(8);
    await page.clock.resume();
    const res = await page.goto('/play/solo');
    const seed = /solo-[0-9a-z]+-[0-9a-z]+/.exec((await res?.text()) ?? '')?.[0];
    expect(seed, 'the solo seed in the page').toBeTruthy();
    next = secondHand(seed!);
    const first = startHand(karachi, { seed: seed!, progress: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }, dealer: 0 }).players[0].concealed;
    if (!first.some((k) => next.includes(k))) continue;

    // Hydrated and past the deal's grace period, then the clock stops: the bots move only when the test lets time run.
    await tapUntilLifted(tiles.first());
    await tiles.first().click();
    await expect(tiles.first()).not.toHaveAttribute('data-selected', 'true');
    await pauseClock(page);

    // Play the first hand out. On each turn, throw a tile the next hand won't hold; before every round of bot
    // moves, make sure one it will hold is lifted. The one lifted when the hand ends must not survive into the next.
    let discards = 0;
    lifted = null;
    for (let i = 0; ; i++) {
      expect(i, 'the first hand ends').toBeLessThan(MAX_STEPS);
      const s = await read(page);
      expect(s.broken, 'the error page').toBe(false);
      if (s.over) break;
      if (s.claim) {
        await page.locator('.sheet').getByRole('button', { name: 'Pass', exact: true }).click();
        lifted = null;
        continue;
      }
      if (s.discard) {
        const spare = s.hand.find((t) => !next.includes(t.kind as TileKind));
        if (spare) {
          await tileOf(spare.kind).click();
          await expect(tileOf(spare.kind)).toHaveAttribute('data-selected', 'true');
        }
        const before = s.hand.length;
        await stage.locator('.action-row button', { hasText: /^Discard / }).click();
        await expect(tiles).toHaveCount(before - 1);
        discards++;
        lifted = null;
        continue;
      }
      if (!s.hand.some((t) => t.selected)) {
        const keep = s.hand.find((t) => next.includes(t.kind as TileKind));
        if (keep) {
          await tileOf(keep.kind).click();
          await expect(tileOf(keep.kind)).toHaveAttribute('data-selected', 'true');
        }
        lifted = keep?.kind ?? null;
      }
      await page.clock.runFor(BOT_STEP_MS);
    }
    expect(discards).toBeGreaterThan(0);
    if (lifted !== null) break;
  }

  // Next hand, once the grace period after the hand ended has passed.
  await page.clock.runFor(SETTLE_MS + 100);
  await page.locator('.sheet').getByRole('button', { name: 'Next hand' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);

  // The new hand holds that kind again, and it isn't lifted: the pick stayed with the hand it was made in.
  const dealt = await read(page);
  expect(dealt.hand.map((t) => t.kind).sort()).toEqual([...next].sort());
  expect(dealt.hand.some((t) => t.kind === lifted)).toBe(true);
  expect(dealt.hand.filter((t) => t.selected)).toEqual([]);
  expect(dealt.river).toMatch(/discarded$/);

  // The bots open the new hand; then Discard, as offered, is taken and nothing breaks.
  for (let i = 0; !(await read(page)).discard; i++) {
    expect(i, 'the player gets a turn in the second hand').toBeLessThan(MAX_STEPS);
    if ((await read(page)).claim) await page.locator('.sheet').getByRole('button', { name: 'Pass', exact: true }).click();
    else await page.clock.runFor(BOT_STEP_MS);
  }
  const before = (await read(page)).hand.length;
  await stage.locator('.action-row button', { hasText: /^Discard / }).click();
  await expect(tiles).toHaveCount(before - 1);
  expect((await read(page)).broken).toBe(false);
  expect(pageErrors).toEqual([]);
});
