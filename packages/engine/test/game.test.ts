import { describe, expect, it } from 'vitest';
import { SEATS, createTaiwanese, initialProgress, karachi, legalActions, nextHand, reduce, simpleBot, startHand, type HandState, type Ruleset } from '../src/index';

function totalTiles(s: HandState): number {
  let n = s.wall.live.length + s.wall.dead.length;
  for (const p of s.players) n += p.concealed.length + p.bonus.length + p.discards.length + p.melds.reduce((a, m) => a + m.tiles.length, 0);
  return n;
}

function playHand(ruleset: Ruleset, state: HandState): HandState {
  let s = state;
  let guard = 0;
  while (s.phase !== 'finished') {
    if (++guard > 2000) throw new Error('hand did not terminate');
    let acted = false;
    for (const seat of SEATS) {
      if (s.phase === 'finished') break;
      const a = simpleBot(s, ruleset, seat);
      if (a) {
        s = reduce(s, a, ruleset);
        acted = true;
      }
    }
    if (!acted) throw new Error(`stuck in phase ${s.phase}`);
    expect(totalTiles(s)).toBe(144);
  }
  return s;
}

describe('startHand', () => {
  it('deals 13 tiles each plus one for the dealer in Karachi', () => {
    const s = startHand(karachi, { seed: 'deal', progress: initialProgress, dealer: 0 });
    expect(s.players[0].concealed).toHaveLength(14);
    for (const seat of [1, 2, 3] as const) expect(s.players[seat].concealed).toHaveLength(13);
    expect(s.players.every((p) => p.concealed.every((k) => !k.startsWith('F') && !k.startsWith('S') || k[0] === 's'))).toBe(true);
    expect(s.phase).toBe('turn');
    expect(totalTiles(s)).toBe(144);
  });
  it('deals 16 tiles each in Taiwanese', () => {
    const tw = createTaiwanese({ sheet: 'house' });
    const s = startHand(tw, { seed: 'deal', progress: initialProgress, dealer: 2 });
    expect(s.players[2].concealed).toHaveLength(17);
    expect(s.players[0].concealed).toHaveLength(16);
    expect(s.players[2].seatWind).toBe('E');
    expect(s.players[3].seatWind).toBe('S');
  });
  it('starts a Karachi West hand in preplay with an exchange', () => {
    const s = startHand(karachi, { seed: 'west', progress: { roundWind: 'W', roundIndex: 2, handInRound: 1, handIndex: 9 }, dealer: 1 });
    expect(s.phase).toBe('preplay');
    expect(legalActions(s, karachi, 0)).toEqual({ exchange: { count: 3 } });
  });
});

describe('bots play whole hands', () => {
  it('finish Taiwanese hands from many seeds, with wins', () => {
    const tw = createTaiwanese({ sheet: 'house' });
    let wins = 0;
    for (let i = 0; i < 30; i++) {
      const s = playHand(tw, startHand(tw, { seed: `tw-${i}`, progress: initialProgress, dealer: (i % 4) as 0 | 1 | 2 | 3 }));
      expect(s.result).not.toBeNull();
      if (s.result?.type === 'win') {
        wins++;
        expect(s.result.settlement.total).toBeGreaterThan(0);
        expect(s.result.settlement.transfers.length).toBeGreaterThan(0);
      }
    }
    expect(wins).toBeGreaterThan(0);
  });
  it('finish Karachi hands in every round', () => {
    const rounds = [
      { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 },
      { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 },
      { roundWind: 'S', roundIndex: 1, handInRound: 0, handIndex: 4 },
      { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 },
      { roundWind: 'N', roundIndex: 3, handInRound: 0, handIndex: 12 },
    ] as const;
    for (const progress of rounds) {
      for (let i = 0; i < 6; i++) {
        const s = playHand(karachi, startHand(karachi, { seed: `k-${i}`, progress, dealer: 0 }));
        expect(s.result).not.toBeNull();
      }
    }
  });
  it('plays a full Taiwanese game through all four rounds', () => {
    const tw = createTaiwanese({ sheet: 'standard' });
    let next: ReturnType<typeof nextHand> = { progress: initialProgress, dealer: 0, dealerStreak: 0 };
    let hands = 0;
    while (next) {
      const s = playHand(tw, startHand(tw, { seed: 'full-game', ...next }));
      hands++;
      next = nextHand(s, tw);
      if (hands > 60) throw new Error('game did not end');
    }
    expect(hands).toBeGreaterThanOrEqual(16);
  });
});
