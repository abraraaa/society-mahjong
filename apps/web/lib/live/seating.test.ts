import { describe, expect, it } from 'vitest';
import type { Seat } from '@society/engine';
import { EVERYONE_HERE, isAway, markAway, markPresent } from './absence';
import { hostOf, seatJoiner, seatsBack, vacate } from './seating';
import type { Absence } from './table-state';
import type { Seats } from './types';

const host = { kind: 'human', userId: 'u-host', name: 'Abrar' } as const;
const bilal = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
const bot = { kind: 'bot', name: 'Sana' } as const;
const zara = { userId: 'u-zara', name: 'Zara' };
const NOW = Date.UTC(2026, 8, 28, 19, 30);
/** When Zara sits down, as her seat keeps it. */
const SINCE = '2026-09-28T19:30:00.000Z';

describe('seatJoiner', () => {
  it('takes the first empty seat and leaves the others as they were', () => {
    const seats: Seats = [host, null, bilal, null];
    expect(seatJoiner(seats, 'lobby', zara, NOW)).toEqual([host, { kind: 'human', ...zara, since: SINCE }, bilal, null]);
  });

  it('leaves bots in their seats until the game is over', () => {
    const seats: Seats = [host, bot, null, null];
    expect(seatJoiner(seats, 'lobby', zara, NOW)).toEqual([host, bot, { kind: 'human', ...zara, since: SINCE }, null]);
    expect(seatJoiner([host, bot, bot, bot], 'playing', zara, NOW)).toBeNull();
  });

  it('takes a bot’s seat between games, so a late friend can play the next one', () => {
    expect(seatJoiner([host, bot, bot, bot], 'finished', zara, NOW)).toEqual([host, { kind: 'human', ...zara, since: SINCE }, bot, bot]);
  });

  it('returns null for a full table', () => {
    const full: Seats = [host, bilal, { kind: 'human', userId: 'u-c', name: 'C' }, { kind: 'human', userId: 'u-d', name: 'D' }];
    expect(seatJoiner(full, 'lobby', zara, NOW)).toBeNull();
    expect(seatJoiner(full, 'finished', zara, NOW)).toBeNull();
  });

  it('stamps the new seat with when they sat down, so who has sat longest can be told and their absence starts afresh', () => {
    const out = seatJoiner([host, null, null, null], 'lobby', zara, NOW)!;
    expect(out[1]).toEqual({ kind: 'human', userId: 'u-zara', name: 'Zara', since: SINCE });
    expect(new Date(SINCE).getTime()).toBe(NOW);
  });

  it('does not touch the seats it was given', () => {
    const seats: Seats = [host, null, null, null];
    const out = seatJoiner(seats, 'lobby', zara, NOW);
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

describe('seatsBack', () => {
  const omar = { kind: 'bot', name: 'Omar' } as const;

  it('gives the seat back to someone the game ended with whose seat went to a bot at the last moment', () => {
    // Bilal left as the last hand was scored: the final table has him in seat 1, the room a bot.
    const atEnd: Seats = [host, bilal, bot, null];
    const room: Seats = [host, omar, bot, null];
    expect(seatsBack(room, atEnd)).toEqual([host, bilal, bot, null]);
    expect(room[1]).toBe(omar);
  });

  it('gives nothing back when the room already matches the game’s end, or the leave came before the end read the seats', () => {
    expect(seatsBack([host, bilal, bot, null], [host, bilal, bot, null])).toBeNull();
    // The end already had a bot in seat 1: Bilal left before it, and the bot played the rest.
    expect(seatsBack([host, omar, bot, null], [host, omar, bot, null])).toBeNull();
  });

  it('never takes a seat from a person, nor seats anyone twice', () => {
    const zaraSeated = { kind: 'human', ...zara, since: SINCE } as const;
    // Zara has taken seat 1 in the lobby since: it's hers.
    expect(seatsBack([host, zaraSeated, bot, null], [host, bilal, bot, null])).toBeNull();
    // Bilal is sitting in seat 3 now: seat 1's bot stays.
    expect(seatsBack([host, omar, bot, bilal], [host, bilal, bot, null])).toBeNull();
    // An empty seat isn't a bot's: someone who stood up in the lobby stays standing.
    expect(seatsBack([host, null, bot, null], [host, bilal, bot, null])).toBeNull();
  });

  it('reads an end with no seats (an old row) as nobody to give back', () => {
    expect(seatsBack([host, omar, bot, null], [null, null, null, null])).toBeNull();
  });
});

describe('hostOf', () => {
  const amna = { kind: 'human', userId: 'u-amna', name: 'Amna' } as const;
  const everyone = (): boolean => true;
  /** Present: everyone seated but these seats. */
  const allBut =
    (...away: Seat[]) =>
    (seat: Seat): boolean =>
      !away.includes(seat);

  it('is the room’s host while they’re seated and here, wherever they sit', () => {
    expect(hostOf('u-host', [host, bilal, bot, null], everyone)).toBe('u-host');
    expect(hostOf('u-host', [bilal, bot, null, host], everyone)).toBe('u-host');
  });

  it('passes to whoever has sat longest once the host has stood up', () => {
    const since = (entry: typeof bilal | typeof amna, iso: string) => ({ ...entry, since: iso });
    expect(hostOf('u-host', [bot, since(bilal, '2026-09-24T19:05:00Z'), since(amna, '2026-09-24T19:00:00Z'), null], everyone)).toBe('u-amna');
    expect(hostOf('u-host', [bot, since(bilal, '2026-09-24T19:00:00Z'), since(amna, '2026-09-24T19:05:00Z'), null], everyone)).toBe('u-bilal');
  });

  it('counts a seat with no time it was taken, or one it can’t read, as the longest held', () => {
    expect(hostOf('u-host', [bot, { ...bilal, since: '2026-09-24T19:00:00Z' }, amna, null], everyone)).toBe('u-amna');
    expect(hostOf('u-host', [bot, { ...bilal, since: '2026-09-24T19:00:00Z' }, { ...amna, since: 'yesterday-ish' }, null], everyone)).toBe('u-amna');
  });

  it('goes by seat order between people who sat down at the same time, or whose times are all unknown', () => {
    expect(hostOf('u-host', [bot, bilal, amna, null], everyone)).toBe('u-bilal');
    expect(hostOf('u-host', [amna, bilal, bot, null], everyone)).toBe('u-amna');
    const at = '2026-09-24T19:00:00Z';
    expect(hostOf('u-host', [bot, { ...amna, since: at }, { ...bilal, since: at }, null], everyone)).toBe('u-amna');
  });

  it('passes over anyone who isn’t here, the host included', () => {
    expect(hostOf('u-host', [host, bilal, amna, null], allBut(0))).toBe('u-bilal');
    expect(hostOf('u-host', [host, bilal, amna, null], allBut(0, 1))).toBe('u-amna');
  });

  it('passes over a host a bot is playing for (away), and comes back to them once they’re back', () => {
    const seats = [host, { ...bilal, since: '2026-09-24T19:05:00Z' }, bot, null] as const;
    const away = markAway(EVERYONE_HERE, seats, 0, 'clock');
    const here = (a: Absence) => (seat: Seat) => seats[seat]?.kind === 'human' && !isAway(a, seats, seat);
    expect(hostOf('u-host', seats, here(away))).toBe('u-bilal');
    expect(hostOf('u-host', seats, here(markPresent(away, seats, 0, 1)))).toBe('u-host');
  });

  it('falls back to the seated host when nobody is here, and to nobody when the host isn’t seated either', () => {
    expect(hostOf('u-host', [host, bilal, amna, null], allBut(0, 1, 2))).toBe('u-host');
    expect(hostOf('u-host', [bot, bilal, amna, null], allBut(1, 2))).toBeNull();
  });

  it('is nobody at a table with no people, and never someone who isn’t seated, whatever their id', () => {
    expect(hostOf('u-host', [bot, bot, null, null], everyone)).toBeNull();
    expect(hostOf('u-host', [null, null, null, null], everyone)).toBeNull();
    // A bot is never the host, even one named after someone.
    expect(hostOf('u-host', [{ kind: 'bot', name: 'Abrar' }, bilal, null, null], everyone)).toBe('u-bilal');
  });
});
