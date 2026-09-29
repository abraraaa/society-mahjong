import { FULL_SET, isDragonTile, isWindTile, windOf } from '../../tiles';
import type { Guard, Guards } from '../../patterns/types';
import type { GameProgress, HandSpec, Ruleset, Settlement, WinInput } from '../../ruleset';
import { KARACHI_ALIASES, KARACHI_EXAMPLES } from './examples';
import { EAST_GENERAL, EAST_NAMED, GOULASH, NORTH, SOUTH } from './patterns';
import { scoreKarachi } from './scoring';

/**
 * Goulash honour gate: a hand containing any honour pung must satisfy two of
 * (dragon pung, round-wind pung, seat-wind pung). Conditions are counted, so a
 * pung that is both round and seat wind satisfies two. ⚠ confirm at the table.
 */
const goulashHonours: Guard = (sol, _hand, ctx) => {
  let honourPungs = 0;
  let conditions = 0;
  for (const g of sol.groups) {
    if (g.type !== 'pung' && g.type !== 'kong') continue;
    const k = g.tiles[0]!;
    if (isDragonTile(k)) {
      honourPungs++;
      conditions++;
    } else if (isWindTile(k)) {
      honourPungs++;
      if (windOf(k) === ctx.roundWind) conditions++;
      if (windOf(k) === ctx.seatWind) conditions++;
    }
  }
  return honourPungs === 0 || conditions >= 2;
};

export const karachiGuards: Guards = {
  'karachi.goulashHonours': goulashHonours,
};

const GOULASH_SPEC: HandSpec = {
  kind: 'goulash',
  label: 'Goulash',
  description:
    'Four pungs and a pair, no runs. Honour pungs only count with two pungs among the dragons, the round wind and your own wind; one pung of a wind that is both is enough.',
  patterns: [GOULASH],
};

/** Patterns are listed most specific first: the reducer announces the first match, and the analyser uses spec order to break ties. */
export function karachiHandSpec(p: GameProgress): HandSpec {
  switch (p.roundWind) {
    case 'E':
      if (p.handInRound === 0) return GOULASH_SPEC;
      return {
        kind: 'honour',
        label: 'East: the honour hand',
        description: 'Three runs or three pungs, one suit or one per suit, plus five honours (all four winds with one paired, or an honour pung and pair).',
        patterns: [...EAST_NAMED, ...EAST_GENERAL],
      };
    case 'S':
      return {
        kind: 'noHonour',
        label: 'South: no honours',
        description: 'Any four sets and a pair, with no winds or dragons at all, or one of the named South hands.',
        patterns: SOUTH,
      };
    case 'W':
      return {
        ...GOULASH_SPEC,
        label: 'West: all goulash',
        preplay: [{ type: 'exchange', count: 3, order: ['right', 'across', 'left'] }],
      };
    case 'N':
      return {
        kind: 'big',
        label: 'North: big hands only',
        description: 'Only the named hands count: most are long runs in one suit, or full of winds and dragons.',
        patterns: NORTH,
      };
  }
}

export function karachiScore(win: WinInput): Settlement {
  // The same spec that dealt the hand decides how it pays: the opening goulash
  // and the West goulashes score by the calculator, everything else at the flat stake.
  return scoreKarachi(win, karachiHandSpec(win.progress).kind);
}

export const karachi: Ruleset = {
  id: 'karachi',
  name: 'Karachi',
  description: 'Karachi-style 13-tile play: rules shift by wind round, chows only from the wall.',
  tiles: FULL_SET, // ⚠ flowers/seasons assumed present
  shape: { handSize: 13, sets: 4 },
  deadWallSize: 14,
  claims: { chowFromDiscard: 'never', pungFromDiscard: true, kongFromDiscard: true, winFromDiscard: true, multipleWinners: false },
  dealerRetainsOnWin: false, // ⚠ unconfirmed
  roundsPerGame: 4,
  handsPerRound: 4,
  handSpec: karachiHandSpec,
  guards: karachiGuards,
  score: karachiScore,
  examples: KARACHI_EXAMPLES,
  aliases: KARACHI_ALIASES,
};

export * from './examples';
export * from './patterns';
export * from './scoring';
