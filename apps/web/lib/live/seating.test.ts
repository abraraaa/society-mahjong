import { describe, expect, it } from 'vitest';
import { seatJoiner, vacate } from './seating';
import type { Seats } from './types';

const host = { kind: 'human', userId: 'u-host', name: 'Abrar' } as const;
const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
const bot = { kind: 'bot', name: 'Sana' } as const;
const zara = { userId: 'u-zara', name: 'Zara' };

describe('seatJoiner', () => {
  it('takes the first empty seat and leaves the others as they were', () => {
    const seats: Seats = [host, null, bilal, null];
    expect(seatJoiner(seats, 'lobby', zara)).toEqual([host, { kind: 'human', ...zara }, bilal, null]);
  });

  it('leaves bots in their seats until the game is over', () => {
    const seats: Seats = [host, bot, null, null];
    expect(seatJoiner(seats, 'lobby', zara)).toEqual([host, bot, { kind: 'human', ...zara }, null]);
    expect(seatJoiner([host, bot, bot, bot], 'playing', zara)).toBeNull();
  });

  it('takes a bot’s seat between games, so a late friend can play the next one', () => {
    expect(seatJoiner([host, bot, bot, bot], 'finished', zara)).toEqual([host, { kind: 'human', ...zara }, bot, bot]);
  });

  it('returns null for a full table', () => {
    const full: Seats = [host, bilal, { kind: 'human', userId: 'u-c', name: 'C' }, { kind: 'human', userId: 'u-d', name: 'D' }];
    expect(seatJoiner(full, 'lobby', zara)).toBeNull();
    expect(seatJoiner(full, 'finished', zara)).toBeNull();
  });

  it('does not touch the seats it was given', () => {
    const seats: Seats = [host, null, null, null];
    const out = seatJoiner(seats, 'lobby', zara);
    expect(out).not.toBe(seats);
    expect(seats).toEqual([host, null, null, null]);
  });
});

describe('vacate', () => {
  it('empties one seat and nothing else', () => {
    const seats: Seats = [host, bilal, bot, null];
    expect(vacate(seats, 1)).toEqual([host, null, bot, null]);
    expect(seats[1]).toBe(bilal);
  });
});
