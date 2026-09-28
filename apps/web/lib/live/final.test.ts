import { describe, expect, it } from 'vitest';
import { finalPlayers, finalStandings } from './final';
import type { GameOver } from './table-state';
import type { Seats } from './types';

const SEATS: Seats = [
  { kind: 'human', userId: 'u-amna', name: 'Amna' },
  { kind: 'human', userId: 'u-bilal', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Omar' },
];
const named = (seats: Seats) => seats.map((s) => s && { name: s.name, bot: s.kind === 'bot' });

describe('finalStandings', () => {
  it('ranks the seats by score, highest first', () => {
    expect(finalStandings(named(SEATS), [2000, 14504, -8000, -8504])).toEqual([
      { seat: 1, name: 'Bilal', bot: false, score: 14504, rank: 1 },
      { seat: 0, name: 'Amna', bot: false, score: 2000, rank: 2 },
      { seat: 2, name: 'Sana', bot: true, score: -8000, rank: 3 },
      { seat: 3, name: 'Omar', bot: true, score: -8504, rank: 4 },
    ]);
  });

  it('gives a tie one rank, in seat order, and the next seat the rank after everyone above it (1, 1, 3, 4)', () => {
    const st = finalStandings(named(SEATS), [-4000, 6000, 6000, -8000]);
    expect(st.map((s) => [s.seat, s.rank])).toEqual([
      [1, 1],
      [2, 1],
      [0, 3],
      [3, 4],
    ]);
    expect(finalStandings(named(SEATS), [0, 0, 0, 0]).map((s) => s.rank)).toEqual([1, 1, 1, 1]);
    expect(finalStandings(named(SEATS), [5, 5, -5, -5]).map((s) => s.rank)).toEqual([1, 1, 3, 3]);
  });

  it('skips an empty seat', () => {
    const st = finalStandings([named(SEATS)[0]!, null, named(SEATS)[2]!, null], [10, 99, -10, 0]);
    expect(st.map((s) => s.seat)).toEqual([0, 2]);
    expect(st.map((s) => s.rank)).toEqual([1, 2]);
  });
});

describe('finalPlayers', () => {
  const over: GameOver = { how: 'complete', by: null, at: 0, hands: 16, scores: [2000, 14504, -8000, -8504], seats: SEATS };

  it('gives a row per seat: a person’s id on a human’s row only, the score and the place', () => {
    expect(finalPlayers(over)).toEqual([
      { seat: 0, user_id: 'u-amna', kind: 'human', name: 'Amna', score: 2000, place: 2 },
      { seat: 1, user_id: 'u-bilal', kind: 'human', name: 'Bilal', score: 14504, place: 1 },
      { seat: 2, user_id: null, kind: 'bot', name: 'Sana', score: -8000, place: 3 },
      { seat: 3, user_id: null, kind: 'bot', name: 'Omar', score: -8504, place: 4 },
    ]);
  });

  it('writes whole numbers, and places them as written', () => {
    const rows = finalPlayers({ ...over, scores: [0.4, 1.6, -0.6, -1.4] });
    expect(rows.map((r) => r.score)).toEqual([0, 2, -1, -1]);
    expect(rows.map((r) => r.place)).toEqual([2, 1, 3, 3]);
  });

  it('shares a place in a tie', () => {
    expect(finalPlayers({ ...over, scores: [6000, 6000, -4000, -8000] }).map((r) => r.place)).toEqual([1, 1, 3, 4]);
  });

  it('places nobody in an abandoned game', () => {
    const rows = finalPlayers({ ...over, how: 'abandoned' });
    expect(rows.map((r) => r.place)).toEqual([null, null, null, null]);
    expect(rows.map((r) => r.score)).toEqual(over.scores);
  });

  it('writes no row for a seat nobody sat in', () => {
    expect(finalPlayers({ ...over, seats: [SEATS[0], null, SEATS[2], SEATS[3]] }).map((r) => r.seat)).toEqual([0, 2, 3]);
  });
});
