import { describe, expect, it } from 'vitest';
import { karachi, type GameProgress, type HandState, type Seat } from '@society/engine';
import { EVERYONE_HERE, markAway } from './absence';
import { STALE_GAME_MS, addHandScores, endOfGame, handsPlayed, isLastHand, isStale, presentAtEnd, publicGameOver } from './lifecycle';
import { dealFirstHand } from './table';
import { NEW_TABLE, type GameOver, type Scores4 } from './table-state';
import type { GameEndHow, Seats } from './types';

/** Just what adding a hand's points reads of it. */
function won(transfers: readonly { from: number; to: number; amount: number }[]): HandState {
  return { phase: 'finished', result: { type: 'win', winner: 1, patternId: 'all-pungs', selfDrawn: false, settlement: { transfers } } } as unknown as HandState;
}

describe('handsPlayed', () => {
  it('counts every hand before this one, and this one once it has finished', () => {
    const at = (handIndex: number, phase: HandState['phase']) => handsPlayed({ phase, progress: { roundWind: 'E', roundIndex: 0, handInRound: handIndex % 4, handIndex } });
    expect(at(0, 'turn')).toBe(0);
    expect(at(0, 'finished')).toBe(1);
    expect(at(1, 'preplay')).toBe(1);
    expect(at(7, 'claim')).toBe(7);
    expect(at(15, 'finished')).toBe(16);
  });
});

describe('addHandScores', () => {
  it('adds a win’s transfers, seat to seat', () => {
    const before: Scores4 = [3, -3, 0, 0];
    const after = addHandScores(
      before,
      won([
        { from: 0, to: 1, amount: 8 },
        { from: 2, to: 1, amount: 4 },
        { from: 3, to: 1, amount: 4 },
      ]),
    );
    expect(after).toEqual([-5, 13, -4, -4]);
    expect(after.reduce((a, b) => a + b, 0)).toBe(0);
    // The totals it was given are left as they were.
    expect(before).toEqual([3, -3, 0, 0]);
  });

  it('adds nothing for a washout, or a hand with no result', () => {
    const before: Scores4 = [3, -3, 0, 0];
    expect(addHandScores(before, { phase: 'finished', result: { type: 'draw' } } as unknown as HandState)).toBe(before);
    expect(addHandScores(before, { phase: 'turn', result: null } as unknown as HandState)).toBe(before);
  });
});

describe('STALE_GAME_MS', () => {
  it('is six hours', () => {
    expect(STALE_GAME_MS).toBe(6 * 60 * 60 * 1000);
  });
});

describe('isStale', () => {
  const T0 = 1_700_000_000_000;

  it('is a game nobody has moved for more than six hours: at six hours exactly it’s still in play', () => {
    expect(isStale(T0, T0)).toBe(false);
    expect(isStale(T0, T0 + STALE_GAME_MS - 1)).toBe(false);
    expect(isStale(T0, T0 + STALE_GAME_MS)).toBe(false);
    expect(isStale(T0, T0 + STALE_GAME_MS + 1)).toBe(true);
  });

  it('is never a game moved after the moment asked about, as a clock a little ahead can make it', () => {
    expect(isStale(T0 + 5000, T0)).toBe(false);
  });
});

/** Four bots: the deal plays the whole hand, so this is a finished hand with its result. */
const BOTS: Seats = [
  { kind: 'bot', name: 'A' },
  { kind: 'bot', name: 'B' },
  { kind: 'bot', name: 'C' },
  { kind: 'bot', name: 'D' },
];
const finished = dealFirstHand(karachi, BOTS, 'life-1', { claimSeconds: 20, turnSeconds: 90 }, 0).state;
const at = (p: GameProgress, phase: HandState['phase'] = 'finished'): HandState => ({ ...finished, progress: p, phase });
const NORTH_3: GameProgress = { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 };
const NORTH_2: GameProgress = { roundWind: 'N', roundIndex: 3, handInRound: 2, handIndex: 14 };

describe('isLastHand', () => {
  it('is the sixteenth hand once it has its result, and no hand before it', () => {
    expect(finished.phase).toBe('finished');
    expect(isLastHand(at(NORTH_3), karachi)).toBe(true);
    expect(isLastHand(at(NORTH_2), karachi)).toBe(false);
    expect(isLastHand(finished, karachi)).toBe(false);
  });

  it('is not a last hand still being played, or one with no result', () => {
    expect(isLastHand(at(NORTH_3, 'turn'), karachi)).toBe(false);
    expect(isLastHand({ ...at(NORTH_3), result: null }, karachi)).toBe(false);
  });
});

const SEATS: Seats = [{ kind: 'human', userId: 'u-amna', name: 'Amna' }, { kind: 'human', userId: 'u-bilal', name: 'Bilal' }, { kind: 'bot', name: 'Sana' }, null];

describe('endOfGame', () => {
  const table = { ...NEW_TABLE, scores: [2000, 14504, -8000, -8504] as Scores4 };

  it.each(['complete', 'host', 'idle', 'abandoned'] as GameEndHow[])('records %s with the table’s totals and seats at that moment', (how) => {
    const by = how === 'host' ? { userId: 'u-amna', name: 'Amna' } : null;
    expect(endOfGame(how, at(NORTH_3), table, SEATS, by, 1234)).toEqual({ how, by, at: 1234, hands: 16, scores: table.scores, seats: SEATS });
  });

  it('counts only the hands that finished: one cut short doesn’t count', () => {
    expect(endOfGame('abandoned', at(NORTH_2, 'turn'), table, SEATS, null, 0).hands).toBe(14);
    expect(endOfGame('abandoned', at(NORTH_2), table, SEATS, null, 0).hands).toBe(15);
  });

  it('gives a table with no totals of its own nought each', () => {
    expect(endOfGame('complete', at(NORTH_3), { ...NEW_TABLE, scores: null }, SEATS, null, 0).scores).toEqual([0, 0, 0, 0]);
  });
});

describe('presentAtEnd', () => {
  const over = (how: GameEndHow): GameOver => ({ how, by: null, at: 0, hands: 16, scores: [0, 0, 0, 0], seats: SEATS });

  it('is the people seated at the end, never a bot or an empty seat', () => {
    expect(presentAtEnd(over('complete'), undefined)).toEqual(['u-amna', 'u-bilal']);
    expect(presentAtEnd(over('host'), EVERYONE_HERE)).toEqual(['u-amna', 'u-bilal']);
  });

  it('leaves out anyone a bot was playing for when it ended', () => {
    const bilal = SEATS.findIndex((s) => s?.kind === 'human' && s.userId === 'u-bilal') as Seat;
    const away = markAway(EVERYONE_HERE, SEATS, bilal, 'clock');
    expect(presentAtEnd(over('complete'), away)).toEqual(['u-amna']);
    expect(presentAtEnd(over('host'), away)).toEqual(['u-amna']);
  });

  it('is nobody for a game that ended because nobody was playing, or because everyone left', () => {
    expect(presentAtEnd(over('idle'), undefined)).toEqual([]);
    expect(presentAtEnd(over('abandoned'), undefined)).toEqual([]);
  });
});

describe('publicGameOver', () => {
  const over: GameOver = { how: 'host', by: { userId: 'u-amna', name: 'Amna' }, at: 5, hands: 7, scores: [1, -1, 0, 0], seats: SEATS };

  it('says how it ended and by whom, by name, and whether it was the one asking', () => {
    expect(publicGameOver(over, 'u-amna')).toEqual({ how: 'host', hands: 7, byName: 'Amna', byMe: true });
    expect(publicGameOver(over, 'u-bilal')).toEqual({ how: 'host', hands: 7, byName: 'Amna', byMe: false });
    expect(publicGameOver(over, null)).toEqual({ how: 'host', hands: 7, byName: 'Amna', byMe: false });
  });

  it('carries no id, and nobody for an end nobody made', () => {
    expect(JSON.stringify(publicGameOver(over, 'u-bilal'))).not.toContain('u-amna');
    expect(publicGameOver({ ...over, how: 'complete', by: null }, 'u-amna')).toEqual({ how: 'complete', hands: 7, byName: null, byMe: false });
  });
});
