import { FULL_SET, isDragonTile, isWindTile, windOf } from '../../tiles';
import type { Guard, Guards } from '../../patterns/types';
import type { GameProgress, HandSpec, Ruleset, Settlement, WinInput } from '../../ruleset';
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
  description: 'Pungs only. Honour pungs need two of: a dragon pung, a round-wind pung, your own wind pung.',
  patterns: [GOULASH],
};

export function karachiHandSpec(p: GameProgress): HandSpec {
  switch (p.roundWind) {
    case 'E':
      if (p.handInRound === 0) return GOULASH_SPEC;
      return {
        kind: 'honour',
        label: 'East: the honour hand',
        description: 'Three chows or three pungs, all one suit or one per suit, plus five honours.',
        patterns: [...EAST_GENERAL, ...EAST_NAMED],
      };
    case 'S':
      return {
        kind: 'noHonour',
        label: 'South: no honours',
        description: 'Four pungs and a pair with no winds or dragons, or one of the Western special hands.',
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
        description: 'Long runs and the rare named hands.',
        patterns: NORTH,
      };
  }
}

export function karachiScore(win: WinInput): Settlement {
  const handKind = karachiHandSpec(win.ctx.roundWind === 'E' && win.handIndex === 0 ? { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 } : { roundWind: win.ctx.roundWind, roundIndex: 0, handInRound: 1, handIndex: 1 }).kind;
  return scoreKarachi(win, handKind);
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
};

export * from './patterns';
export * from './scoring';
