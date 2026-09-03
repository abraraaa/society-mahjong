/**
 * Taiwanese scoring: one set of pattern detectors, three value sheets.
 * Values transcribed from docs/RULES-TAIWANESE.md. A value of 0 means the
 * sheet does not award the item. Families not yet detected are listed in
 * the TODO at the bottom.
 */
import { isDragonTile, isHonourTile, isSuitTile, isWindTile, suitOf, windOf, windTile, type Suit, type TileKind } from '../../tiles';
import type { Group, Solution } from '../../patterns/types';
import type { ScoreLine, Settlement, WinInput } from '../../ruleset';

export type TaiwaneseSheet = 'standard' | 'house' | 'advanced';

export interface SheetValues {
  readonly unit: 'tai' | 'points';
  readonly base: number;
  readonly values: Readonly<Record<string, number>>;
  /** items that stack with concealed-self-pick style combined items are removed when the combined item scores */
  readonly excludes: readonly (readonly [winner: string, loser: string])[];
  readonly dealerBonus: (streak: number) => number;
}

const STANDARD: SheetValues = {
  unit: 'tai',
  base: 0,
  values: {
    selfPick: 1,
    concealed: 1,
    concealedSelfPick: 3,
    allPong: 4,
    allSheung: 2,
    semiPure: 4,
    pure: 8,
    allHonours: 16,
    dragonPong: 1,
    seatWindPong: 1,
    roundWindPong: 1,
    littleDragons: 4,
    bigDragons: 8,
    littleFourWinds: 8,
    bigFourWinds: 16,
    concealedPongs3: 2,
    concealedPongs4: 5,
    concealedPongs5: 8,
    heavenly: 24,
    earthly: 16,
    nicoNico: 30,
    flower: 0,
  },
  excludes: [
    ['concealedSelfPick', 'selfPick'],
    ['concealedSelfPick', 'concealed'],
    ['bigDragons', 'littleDragons'],
    ['bigFourWinds', 'littleFourWinds'],
    ['allHonours', 'semiPure'],
    ['pure', 'semiPure'],
  ],
  // 莊家 1 tai plus 2 per consecutive win: 2n+1
  dealerBonus: (streak) => 2 * streak + 1,
};

const HOUSE: SheetValues = {
  unit: 'points',
  base: 5,
  values: {
    selfPick: 5,
    selfPickFlowerWall: 10,
    concealedDiscard: 10,
    concealedSelfPick: 15,
    exposedDiscard: 15,
    lastWallTile: 20,
    earthly: 90,
    heavenly: 100,
    flower: 1,
    seatFlower: 1,
    noFlowers: 1,
    noHonours: 1,
    noFlowersNoHonours: 5,
    windPong: 1,
    seatWindPong: 1,
    roundWindPong: 1,
    littleThreeWinds: 15,
    bigThreeWinds: 30,
    littleFourWinds: 50,
    bigFourWinds: 60,
    dragonPong: 2,
    littleDragons: 20,
    bigDragons: 40,
    openKong: 1,
    robbedKong: 10,
    afterKong: 30,
    concealedPongs2: 5,
    concealedPongs3: 15,
    concealedPongs4: 30,
    concealedPongs5: 80,
    allSheung: 15,
    allPong: 25,
    semiPure: 30,
    pure: 100,
    allHonours: 140,
    twoSuits: 5,
    allFive: 10,
    nicoNico: 40,
    thirteenOrphans: 80,
    chicken: 20,
  },
  excludes: [
    ['concealedSelfPick', 'selfPick'],
    ['bigDragons', 'littleDragons'],
    ['bigFourWinds', 'littleFourWinds'],
    ['bigThreeWinds', 'littleThreeWinds'],
    ['bigFourWinds', 'bigThreeWinds'],
    ['littleFourWinds', 'bigThreeWinds'],
    ['bigFourWinds', 'littleThreeWinds'],
    ['littleFourWinds', 'littleThreeWinds'],
    ['noFlowersNoHonours', 'noFlowers'],
    ['noFlowersNoHonours', 'noHonours'],
    ['pure', 'semiPure'],
    ['allHonours', 'semiPure'],
    ['allHonours', 'allPong'],
    ['concealedPongs5', 'concealedPongs4'],
    ['concealedPongs4', 'concealedPongs3'],
    ['concealedPongs3', 'concealedPongs2'],
  ],
  dealerBonus: (streak) => (streak <= 0 ? 0 : [3, 5, 7, 9, 11, 13][Math.min(streak, 6) - 1]!),
};

const ADVANCED: SheetValues = {
  ...HOUSE,
  values: {
    ...HOUSE.values,
    closing: 5,
    concealedDiscard: 5,
    concealedSelfPick: 10,
    exposedDiscard: 5,
    exposedSelfPick: 10,
    lastWallTile: 50,
    earthly: 20,
    noFlowers: 5,
    noHonours: 5,
    noFlowersNoHonours: 10,
    littleFourWinds: 60,
    bigFourWinds: 80,
    allSheung: 5,
    pure: 90,
    allHonours: 0,
    chicken: 0,
  },
};

export const TAIWANESE_SHEETS: Readonly<Record<TaiwaneseSheet, SheetValues>> = { standard: STANDARD, house: HOUSE, advanced: ADVANCED };

const NAMES: Readonly<Record<string, string>> = {
  selfPick: 'Self-pick',
  selfPickFlowerWall: 'Self-pick from the flower wall',
  concealed: 'Concealed hand',
  concealedDiscard: 'Concealed hand, won on a discard',
  concealedSelfPick: 'Concealed self-pick',
  exposedDiscard: 'Fully exposed, won on a discard',
  exposedSelfPick: 'Fully exposed, self-pick',
  closing: 'Closed hand',
  lastWallTile: 'Seabed tile',
  earthly: 'Earthly hand',
  heavenly: 'Heavenly hand',
  flower: 'Flowers',
  seatFlower: 'Flower of own seat',
  noFlowers: 'No flowers',
  noHonours: 'No winds or dragons',
  noFlowersNoHonours: 'No flowers, winds or dragons',
  windPong: 'Pong of winds',
  seatWindPong: 'Pong of seat wind',
  roundWindPong: 'Pong of round wind',
  littleThreeWinds: 'Little three winds',
  bigThreeWinds: 'Big three winds',
  littleFourWinds: 'Little four winds',
  bigFourWinds: 'Big four winds',
  dragonPong: 'Pong of dragons',
  littleDragons: 'Little dragons',
  bigDragons: 'Big dragons',
  openKong: 'Open gong',
  robbedKong: 'Robbing a gong',
  afterKong: 'Win after a gong',
  concealedPongs2: 'Two concealed pongs',
  concealedPongs3: 'Three concealed pongs',
  concealedPongs4: 'Four concealed pongs',
  concealedPongs5: 'Five concealed pongs',
  allSheung: 'All sheung hand',
  allPong: 'All pong hand',
  semiPure: 'Semi pure',
  pure: 'Pure suit',
  allHonours: 'All honours',
  twoSuits: 'Two-suit hand',
  allFive: 'All five hand',
  nicoNico: 'Nico Nico',
  thirteenOrphans: '13 Orphans',
  chicken: 'Chicken hand',
  dealer: 'Dealer bonus',
  base: 'Base',
};

interface Detected {
  readonly id: string;
  readonly count?: number;
}

function sets(sol: Solution): Group[] {
  return sol.groups.filter((g) => g.c === 'set' || g.c === 'seq');
}

function detect(win: WinInput, sol: Solution, patternId: string): Detected[] {
  const out: Detected[] = [];
  const { hand, ctx, flags, bonus } = win;
  const allTiles: TileKind[] = [...hand.concealed, ...hand.melds.flatMap((m) => m.tiles)];
  const exposed = hand.melds.some((m) => !m.concealed);
  const setGroups = sets(sol);
  const pongs = setGroups.filter((g) => g.type === 'pung' || g.type === 'kong');
  const chows = setGroups.filter((g) => g.type === 'chow');
  const pairs = sol.groups.filter((g) => g.c === 'pair');
  const pairKind = pairs[0]?.tiles[0];

  // win type
  if (flags.heavenly) out.push({ id: 'heavenly' });
  else if (flags.firstDiscard && !win.selfDrawn) out.push({ id: 'earthly' });
  if (win.selfDrawn && !exposed) out.push({ id: 'concealedSelfPick' });
  if (win.selfDrawn) out.push({ id: flags.afterKong ? 'selfPickFlowerWall' : 'selfPick' });
  if (!win.selfDrawn && !exposed) out.push({ id: 'concealedDiscard' });
  if (!win.selfDrawn && !exposed) out.push({ id: 'concealed' });
  const concealedTileCount = hand.concealed.length;
  if (exposed && concealedTileCount <= 2) out.push({ id: win.selfDrawn ? 'exposedSelfPick' : 'exposedDiscard' });
  if (flags.lastWallTile) out.push({ id: 'lastWallTile' });
  if (flags.robbedKong) out.push({ id: 'robbedKong' });
  if (flags.afterKong) out.push({ id: 'afterKong' });

  // flowers
  if (bonus.length > 0) out.push({ id: 'flower', count: bonus.length });
  const seatIndex = ['E', 'S', 'W', 'N'].indexOf(ctx.seatWind) + 1;
  const seatFlowers = bonus.filter((b) => Number(b[1]) === seatIndex).length;
  if (seatFlowers > 0) out.push({ id: 'seatFlower', count: seatFlowers });
  const honoursInHand = allTiles.some(isHonourTile);
  if (bonus.length === 0) out.push({ id: 'noFlowers' });
  if (!honoursInHand) out.push({ id: 'noHonours' });
  if (bonus.length === 0 && !honoursInHand) out.push({ id: 'noFlowersNoHonours' });

  // honours
  const windPongs = pongs.filter((g) => isWindTile(g.tiles[0]!));
  const dragonPongs = pongs.filter((g) => isDragonTile(g.tiles[0]!));
  if (windPongs.length > 0) out.push({ id: 'windPong', count: windPongs.length });
  if (windPongs.some((g) => g.tiles[0] === windTile(ctx.seatWind))) out.push({ id: 'seatWindPong' });
  if (windPongs.some((g) => g.tiles[0] === windTile(ctx.roundWind))) out.push({ id: 'roundWindPong' });
  const windPair = pairKind !== undefined && isWindTile(pairKind);
  const dragonPair = pairKind !== undefined && isDragonTile(pairKind);
  if (windPongs.length === 4) out.push({ id: 'bigFourWinds' });
  else if (windPongs.length === 3 && windPair) out.push({ id: 'littleFourWinds' });
  else if (windPongs.length === 3) out.push({ id: 'bigThreeWinds' });
  else if (windPongs.length === 2 && windPair) out.push({ id: 'littleThreeWinds' });
  if (dragonPongs.length > 0) out.push({ id: 'dragonPong', count: dragonPongs.length });
  if (dragonPongs.length === 3) out.push({ id: 'bigDragons' });
  else if (dragonPongs.length === 2 && dragonPair) out.push({ id: 'littleDragons' });

  // kongs and concealed pongs
  const openKongs = hand.melds.filter((m) => m.type === 'kong' && !m.concealed).length;
  if (openKongs > 0) out.push({ id: 'openKong', count: openKongs });
  const concealedPongs = pongs.filter((g) => g.concealed).length;
  if (concealedPongs >= 2) out.push({ id: `concealedPongs${Math.min(concealedPongs, 5)}` });

  // shape
  if (patternId === 'taiwanese.nicoNico') out.push({ id: 'nicoNico' });
  else if (patternId === 'taiwanese.thirteenOrphans') out.push({ id: 'thirteenOrphans' });
  else {
    if (pongs.length === setGroups.length && setGroups.length > 0) out.push({ id: 'allPong' });
    if (chows.length === setGroups.length && setGroups.length > 0) out.push({ id: 'allSheung' });
  }

  // suits
  const suits = new Set<Suit>();
  for (const k of allTiles) if (isSuitTile(k)) suits.add(suitOf(k));
  if (suits.size === 0 && honoursInHand) out.push({ id: 'allHonours' });
  else if (suits.size === 1 && !honoursInHand) out.push({ id: 'pure' });
  else if (suits.size === 1) out.push({ id: 'semiPure' });
  else if (suits.size === 2 && !honoursInHand) out.push({ id: 'twoSuits' });
  else if (suits.size === 3 && allTiles.some(isWindTile) && allTiles.some(isDragonTile)) out.push({ id: 'allFive' });

  return out;
}

export function scoreTaiwanese(win: WinInput, sheetId: TaiwaneseSheet, dealerStreak = 0): Settlement {
  const sheet = TAIWANESE_SHEETS[sheetId];
  let best: { lines: ScoreLine[]; total: number } | null = null;
  for (const m of win.matches) {
    const detected = detect(win, m.solution, m.pattern.id);
    const present = new Set(detected.map((d) => d.id));
    for (const [winner, loser] of sheet.excludes) if (present.has(winner)) present.delete(loser);
    const lines: ScoreLine[] = [];
    for (const d of detected) {
      if (!present.has(d.id)) continue;
      const v = sheet.values[d.id] ?? 0;
      if (v === 0) continue;
      lines.push({ id: d.id, name: NAMES[d.id] ?? d.id, value: v * (d.count ?? 1) });
    }
    let total = lines.reduce((a, l) => a + l.value, 0);
    if (sheet.unit === 'points' && total <= 1 && (sheet.values['chicken'] ?? 0) > 0) {
      lines.push({ id: 'chicken', name: NAMES['chicken']!, value: sheet.values['chicken']! });
      total = sheet.values['chicken']!;
    }
    if (!best || total > best.total) best = { lines, total };
  }
  const lines: ScoreLine[] = best ? [...best.lines] : [];
  let total = best?.total ?? 0;
  if (sheet.base > 0) {
    lines.push({ id: 'base', name: NAMES['base']!, value: sheet.base });
    total += sheet.base;
  }
  const dealerInvolved = win.seat === win.dealer || win.discarder === win.dealer;
  const dealerBonus = dealerInvolved ? sheet.dealerBonus(dealerStreak) : 0;
  if (dealerBonus > 0) {
    lines.push({ id: 'dealer', name: NAMES['dealer']!, value: dealerBonus });
    total += dealerBonus;
  }
  const payers = win.selfDrawn || win.discarder === undefined ? ([0, 1, 2, 3] as const).filter((s) => s !== win.seat) : [win.discarder];
  return {
    winner: win.seat,
    unit: sheet.unit,
    total,
    lines,
    transfers: payers.map((from) => ({ from, to: win.seat, amount: total })),
    provisional: false,
  };
}

// TODO(scoring): dragon runs, brother/sister sheungs, sequential pongs, step-ups,
// terminals families, waits (good eyes, single wait, calling by pairs, four-in-N-ways),
// bouquets and other mid-hand payments, Jade/Ruby/Diamond, 16 Orphans, chasing tiles.
