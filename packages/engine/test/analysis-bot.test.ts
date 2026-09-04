import { describe, expect, it } from 'vitest';
import { SEATS, analysisBot, isWindTile, karachi, reduce, startHand, viewFor, type GameProgress, type HandState, type PrivatePlayerView, type TileKind } from '../src/index';

const ROUNDS: GameProgress[] = [
  { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 },
  { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 },
  { roundWind: 'S', roundIndex: 1, handInRound: 0, handIndex: 4 },
  { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 },
  { roundWind: 'N', roundIndex: 3, handInRound: 0, handIndex: 12 },
];

function playHand(state: HandState): HandState {
  let s = state;
  for (let guard = 0; guard < 2000 && s.phase !== 'finished'; guard++) {
    let acted = false;
    for (const seat of SEATS) {
      if (s.phase === 'finished') break;
      const a = analysisBot(viewFor(s, karachi, seat), karachi);
      if (a) {
        s = reduce(s, a, karachi);
        acted = true;
      }
    }
    if (!acted) throw new Error(`no bot could act in phase ${s.phase}`);
  }
  return s;
}

/** A claim window for seat 0 on a discard from seat 1, with the given hand. */
function claimView(progress: GameProgress, tiles: readonly TileKind[], discard: TileKind): PrivatePlayerView {
  return {
    progress,
    me: 0,
    concealed: tiles,
    players: [{ seat: 0, seatWind: 'E', melds: [], concealed: tiles }],
    phase: 'claim',
    turn: 1,
    discardCount: 6,
    legal: { claims: [{ type: 'pung', tiles: [discard, discard] }], pass: true },
    lastDiscard: { kind: discard, from: 1 },
    result: null,
    revealed: {},
  } as unknown as PrivatePlayerView;
}

describe('analysisBot', () => {
  // Ten whole hands with four analysing seats: a few seconds, so give it room.
  it('finishes Karachi hands in every round', { timeout: 60_000 }, () => {
    for (const progress of ROUNDS) {
      for (let i = 0; i < 2; i++) {
        const s = playHand(startHand(karachi, { seed: `ab-${progress.roundWind}-${progress.handInRound}-${i}`, progress, dealer: (i % 4) as 0 | 1 | 2 | 3 }));
        expect(s.phase).toBe('finished');
        expect(s.result).not.toBeNull();
      }
    }
  });

  it('will not pung a wind that breaks the East honour hand', () => {
    // NEWS with North paired, three runs in progress: a North pung would leave no pair.
    const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN'];
    const a = analysisBot(claimView(ROUNDS[1]!, tiles, 'WN'), karachi);
    expect(a?.type).toBe('pass');
  });

  it('pungs a pair that the goulash wants', () => {
    const tiles: TileKind[] = ['m1', 'm1', 'p7', 'p7', 'p7', 'DR', 'DR', 'DR', 'WW', 'WW', 's4', 's5', 's9'];
    const a = analysisBot(claimView(ROUNDS[3]!, tiles, 'm1'), karachi);
    expect(a?.type).toBe('claim');
  });

  it('keeps its lone winds in the East honour hand', () => {
    const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'p9'];
    const view = {
      ...claimView(ROUNDS[1]!, tiles, 'WN'),
      phase: 'turn',
      turn: 0,
      legal: { discard: tiles },
      lastDiscard: null,
    } as unknown as PrivatePlayerView;
    const a = analysisBot(view, karachi);
    expect(a?.type).toBe('discard');
    if (a?.type === 'discard') expect(isWindTile(a.tile)).toBe(false);
  });
});
