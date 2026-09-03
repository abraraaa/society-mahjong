/**
 * Karachi scoring, from the Mahjong Mates Karachi score tracker (Sep 2026):
 *
 *  - East, South and North rounds: a flat stake per round. Every loser pays
 *    the winner. East pays and receives double. Defaults 2000 / 1000 / 4000,
 *    editable per table.
 *  - West round, and the opening goulash of East: the Cantonese-style
 *    calculation. Base points for melds, pairs, flowers and the win, then
 *    doubled once per "doubler". Every loser pays the final amount.
 *  - False mahjong: the offender pays a fixed penalty to each other player.
 *
 * ⚠ Open: what the winner's own-flower / own-season count does to a flat
 * payout (the tracker offers 0 / 1 / 2). Modelled as a multiplier table.
 * ⚠ Open: the value of each flower/season in the Cantonese base (4 assumed).
 */
import { isDragonTile, isHonourTile, isSuitTile, isTerminal, isWindTile, suitOf, windTile, type Suit, type Wind } from '../../tiles';
import { SEATS, type Seat } from '../../hand';
import type { Group, Solution } from '../../patterns/types';
import type { ScoreLine, Settlement, Transfer, WinInput } from '../../ruleset';

export interface KarachiStakes {
  readonly east: number;
  readonly south: number;
  readonly north: number;
  readonly falseMahjong: number;
  /** multiplier by the winner's count of own flower + own season (0, 1, 2) ⚠ */
  readonly flowerMultiplier: readonly [number, number, number];
  /** Cantonese base: points per flower or season tile ⚠ */
  readonly flowerPoints: number;
}

export const DEFAULT_STAKES: KarachiStakes = {
  east: 2000,
  south: 1000,
  north: 4000,
  falseMahjong: 4000,
  flowerMultiplier: [1, 2, 4],
  flowerPoints: 4,
};

const seatIndex = (w: Wind): number => ['E', 'S', 'W', 'N'].indexOf(w) + 1;

/** 0, 1 or 2: does the winner hold their own flower and/or own season. */
export function ownBonusCount(win: WinInput): number {
  const i = seatIndex(win.ctx.seatWind);
  const own = new Set([`F${i}`, `S${i}`]);
  return win.bonus.filter((b) => own.has(b)).length;
}

function everyonePays(winner: Seat, amountFor: (loser: Seat) => number): Transfer[] {
  return SEATS.filter((s) => s !== winner).map((from) => ({ from, to: winner, amount: amountFor(from) }));
}

/** East, South and North: flat stake, East doubles whichever side it is on. */
export function scoreFlat(win: WinInput, stakes: KarachiStakes = DEFAULT_STAKES): Settlement {
  const base = win.ctx.roundWind === 'S' ? stakes.south : win.ctx.roundWind === 'N' ? stakes.north : stakes.east;
  const flowerLevel = Math.min(ownBonusCount(win), 2) as 0 | 1 | 2;
  const mult = stakes.flowerMultiplier[flowerLevel];
  const lines: ScoreLine[] = [{ id: 'stake', name: `${win.ctx.roundWind} round stake`, value: base }];
  if (mult !== 1) lines.push({ id: 'ownFlowers', name: 'Own flower / season', value: mult });
  const transfers = everyonePays(win.seat, (loser) => base * mult * (loser === win.dealer || win.seat === win.dealer ? 2 : 1));
  return {
    winner: win.seat,
    unit: 'points',
    total: transfers.reduce((a, t) => a + t.amount, 0),
    lines,
    transfers,
    provisional: false,
  };
}

/** False mahjong: the offender pays every other player. */
export function falseMahjongPenalty(offender: Seat, stakes: KarachiStakes = DEFAULT_STAKES): Transfer[] {
  return SEATS.filter((s) => s !== offender).map((to) => ({ from: offender, to, amount: stakes.falseMahjong }));
}

// ---------------------------------------------------------------------------
// Cantonese-style calculation for West and the opening goulash
// ---------------------------------------------------------------------------

const MELD_POINTS = {
  pung: { basic: { revealed: 2, concealed: 4 }, major: { revealed: 4, concealed: 8 } },
  kong: { basic: { revealed: 8, concealed: 16 }, major: { revealed: 16, concealed: 32 } },
} as const;

function isMajor(kind: string): boolean {
  return isHonourTile(kind as never) || isTerminal(kind as never);
}

interface Detail {
  readonly base: ScoreLine[];
  readonly doublers: ScoreLine[];
}

function detail(win: WinInput, sol: Solution, stakes: KarachiStakes): Detail {
  const base: ScoreLine[] = [];
  const doublers: ScoreLine[] = [];
  const { ctx } = win;
  const sets: Group[] = sol.groups.filter((g) => g.type === 'pung' || g.type === 'kong' || g.type === 'chow');
  const pungs = sets.filter((g) => g.type === 'pung' || g.type === 'kong');
  const kongs = sets.filter((g) => g.type === 'kong');
  const pair = sol.groups.find((g) => g.c === 'pair')?.tiles[0];
  const allTiles = [...win.hand.concealed, ...win.hand.melds.flatMap((m) => m.tiles)];

  base.push({ id: 'mahjong', name: win.selfDrawn ? 'Mahjong (self-drawn)' : 'Mahjong (discarded tile)', value: 20 });
  for (const g of pungs) {
    const k = g.tiles[0]!;
    const v = MELD_POINTS[g.type as 'pung' | 'kong'][isMajor(k) ? 'major' : 'basic'][g.concealed ? 'concealed' : 'revealed'];
    base.push({ id: `meld:${k}`, name: `${g.concealed ? 'Concealed' : 'Revealed'} ${g.type} of ${k}`, value: v });
  }
  if (pair) {
    if (isDragonTile(pair)) base.push({ id: 'pairDragons', name: 'Pair of dragons', value: 2 });
    if (pair === windTile(ctx.seatWind)) base.push({ id: 'pairOwnWind', name: 'Pair of own wind', value: 2 });
    if (pair === windTile(ctx.roundWind)) base.push({ id: 'pairRoundWind', name: 'Pair of round wind', value: 2 });
    if (isTerminal(pair)) base.push({ id: 'pairTerminals', name: 'Pair of terminals', value: 2 });
  }
  if (win.bonus.length > 0) base.push({ id: 'flowers', name: 'Flowers and seasons', value: stakes.flowerPoints * win.bonus.length });

  const honourPungs = pungs.filter((g) => isHonourTile(g.tiles[0]!));
  const dragonPungs = pungs.filter((g) => isDragonTile(g.tiles[0]!));
  const windPungs = pungs.filter((g) => isWindTile(g.tiles[0]!));
  const suits = new Set<Suit>();
  for (const k of allTiles) if (isSuitTile(k)) suits.add(suitOf(k));
  const hasHonours = allTiles.some(isHonourTile);

  if (honourPungs.length === 4) doublers.push({ id: 'allHonourPungs', name: 'All honours pungs', value: 3 });
  if (kongs.length >= 3) doublers.push({ id: 'threeKongs', name: 'Three or more kongs', value: 2 });
  if (dragonPungs.length === 3) doublers.push({ id: 'allDragons', name: 'All three dragon pungs', value: 2 });
  if (windPungs.length === 4) doublers.push({ id: 'allWinds', name: 'All four wind pungs', value: 2 });
  if (suits.size === 1 && hasHonours) doublers.push({ id: 'oneSuitHonours', name: 'One suit with honours', value: 1 });
  if (suits.size === 1 && !hasHonours) doublers.push({ id: 'oneSuit', name: 'One suit, no honours', value: 1 });
  if (win.selfDrawn) doublers.push({ id: 'selfDraw', name: 'Self-drawn win', value: 1 });
  if (pungs.filter((g) => g.concealed).length >= 3) doublers.push({ id: 'concealed3', name: 'Three or more concealed sets', value: 1 });
  if (pungs.length === sets.length && sets.length === 4) doublers.push({ id: 'allPungs', name: 'All pungs', value: 1 });
  if (windPungs.some((g) => g.tiles[0] === windTile(ctx.roundWind))) doublers.push({ id: 'roundWindPung', name: 'Round wind pung', value: 1 });
  if (windPungs.some((g) => g.tiles[0] === windTile(ctx.seatWind))) doublers.push({ id: 'seatWindPung', name: 'Seat wind pung', value: 1 });
  if (dragonPungs.length > 0 && dragonPungs.length < 3) doublers.push({ id: 'dragonPungs', name: 'Dragon pungs', value: dragonPungs.length });
  const own = ownBonusCount(win);
  if (own > 0) doublers.push({ id: 'ownFlowers', name: 'Own flower / season', value: own });

  return { base, doublers };
}

/** West round and the opening goulash: base × 2^doublers, every loser pays it. */
export function scoreCantonese(win: WinInput, stakes: KarachiStakes = DEFAULT_STAKES): Settlement {
  let best: { lines: ScoreLine[]; final: number } | null = null;
  for (const m of win.matches) {
    const d = detail(win, m.solution, stakes);
    const baseTotal = d.base.reduce((a, l) => a + l.value, 0);
    const doubles = d.doublers.reduce((a, l) => a + l.value, 0);
    const final = baseTotal * 2 ** doubles;
    if (!best || final > best.final) {
      best = {
        lines: [...d.base, ...d.doublers.map((l) => ({ ...l, name: `${l.name} (×2 each)` })), { id: 'final', name: `Base ${baseTotal} × 2^${doubles}`, value: final }],
        final,
      };
    }
  }
  const final = best?.final ?? 20;
  const transfers = everyonePays(win.seat, () => final);
  return {
    winner: win.seat,
    unit: 'points',
    total: final * 3,
    lines: best?.lines ?? [],
    transfers,
    provisional: false,
  };
}

/** Route a win to the right calculation for its round and hand kind. */
export function scoreKarachi(win: WinInput, handKind: string, stakes: KarachiStakes = DEFAULT_STAKES): Settlement {
  if (win.ctx.roundWind === 'W' || handKind === 'goulash') return scoreCantonese(win, stakes);
  return scoreFlat(win, stakes);
}
