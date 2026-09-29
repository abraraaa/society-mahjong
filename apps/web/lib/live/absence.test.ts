import { describe, expect, it } from 'vitest';
import type { HandState } from '@society/engine';
import {
  AWAY_AFTER_MISSES,
  EVERYONE_HERE,
  awaySeats,
  isAway,
  markAway,
  markOnBreak,
  markPresent,
  noteClockMove,
  noteHandEnd,
  notePlayed,
  parseAbsence,
  presentHumans,
  presentUserIds,
  reconcileAbsence,
  sameAbsence,
} from './absence';
import type { Absence } from './table-state';
import type { Move, Seats } from './types';

/**
 * Who's away, per seat: two missed turns in a row make a seat away, a tap of
 * the person's own brings them back, and an entry belongs to one sitting.
 */
const T0 = 1_700_000_000_000;
const AMNA = { kind: 'human', userId: 'u-amna', name: 'Amna', since: '2026-09-28T19:00:00.000Z' } as const;
const BILAL = { kind: 'human', userId: 'u-bilal', name: 'Bilal' } as const;
const SANA = { kind: 'bot', name: 'Sana' } as const;
const SEATS: Seats = [AMNA, BILAL, SANA, null];

const discard: Move = { by: 'clock', seat: 1, a: { type: 'discard', seat: 1, tile: 's5' } };
const pass: Move = { by: 'clock', seat: 1, a: { type: 'pass', seat: 1 } };

describe('parseAbsence', () => {
  it('reads anything that isn’t four entries as everyone here', () => {
    for (const x of [[], '[]', null, undefined, 7, { 0: {} }, [{}, {}, {}]]) expect(parseAbsence(x), JSON.stringify(x)).toEqual(EVERYONE_HERE);
  });

  it('reads garbage in an entry as nothing, and a count that isn’t a whole number from nought up as nought', () => {
    const [a, b, c, d] = parseAbsence([
      { userId: 'u-amna', since: 'then', misses: -3, away: 'napping', clockMoves: 1.5, lastTap: 'soon', tapVersion: 2.5, played: { turns: -1, sets: 2, exchanges: 'x' } },
      'garbage',
      null,
      { userId: 7, misses: 1, away: 'host', lastClockMove: { by: 'clock', seat: 3, a: { type: 'resolveClaims' } }, lastTap: 5, tapVersion: 12 },
    ]);
    expect(a).toEqual({
      userId: 'u-amna',
      since: 'then',
      misses: 0,
      away: null,
      clockMoves: 0,
      lastClockMove: null,
      lastTap: null,
      tapVersion: null,
      played: { turns: 0, sets: 2, exchanges: 0, wins: 0, hands: 0 },
    });
    expect(b).toEqual(EVERYONE_HERE[1]);
    expect(c).toEqual(EVERYONE_HERE[2]);
    expect(d).toMatchObject({ userId: null, misses: 1, away: 'host', lastClockMove: null, lastTap: 5, tapVersion: 12 });
  });

  it('reads back what it wrote, the clock’s last move rebuilt from its checked fields', () => {
    const a = markPresent(noteClockMove(EVERYONE_HERE, SEATS, discard, true), SEATS, 0, T0);
    expect(parseAbsence(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
});

describe('sameAbsence', () => {
  it('ignores when each person last tapped', () => {
    const a = noteClockMove(EVERYONE_HERE, SEATS, discard, true);
    expect(sameAbsence(markPresent(EVERYONE_HERE, SEATS, 0, T0), EVERYONE_HERE)).toBe(true);
    expect(sameAbsence(markPresent(a, SEATS, 0, T0), markPresent(a, SEATS, 0, T0 + 9_000))).toBe(true);
  });

  it('ignores whose an entry is while both have nothing else to say, and nothing else', () => {
    const blank: Absence = [{ ...EVERYONE_HERE[0], userId: 'u-zed', since: 'x' }, EVERYONE_HERE[1], EVERYONE_HERE[2], EVERYONE_HERE[3]];
    expect(sameAbsence(blank, EVERYONE_HERE)).toBe(true);
    expect(sameAbsence(noteClockMove(EVERYONE_HERE, SEATS, discard, true), EVERYONE_HERE)).toBe(false);
    expect(sameAbsence(markAway(EVERYONE_HERE, SEATS, 1, 'host'), markAway(EVERYONE_HERE, SEATS, 1, 'clock'))).toBe(false);
    const once = noteClockMove(EVERYONE_HERE, SEATS, discard, false);
    expect(sameAbsence(once, noteClockMove(EVERYONE_HERE, SEATS, pass, false))).toBe(false);
  });
});

describe('reconcileAbsence', () => {
  const missed = noteClockMove(EVERYONE_HERE, SEATS, discard, true);

  it('gives back the same list when every entry is still its seat’s', () => {
    expect(reconcileAbsence(missed, SEATS)).toBe(missed);
    expect(reconcileAbsence(EVERYONE_HERE, SEATS)).toBe(EVERYONE_HERE);
    expect(reconcileAbsence(parseAbsence(JSON.parse(JSON.stringify(missed))), SEATS)).toEqual(missed);
  });

  it('starts afresh a seat someone else sits in now, a bot’s, or its person’s new sitting', () => {
    expect(reconcileAbsence(missed, [AMNA, { kind: 'human', userId: 'u-zara', name: 'Zara' }, SANA, null])[1]).toEqual(EVERYONE_HERE[1]);
    expect(reconcileAbsence(missed, [AMNA, { kind: 'bot', name: 'Bilal' }, SANA, null])[1]).toEqual(EVERYONE_HERE[1]);
    // The same person, sat down again: a new `since`, and a fresh entry, even in the same seat.
    const again = reconcileAbsence(missed, [AMNA, { ...BILAL, since: '2026-09-28T20:00:00.000Z' }, SANA, null]);
    expect(again[1]).toEqual(EVERYONE_HERE[1]);
    expect(again[0]).toBe(missed[0]);
  });
});

describe('noteClockMove', () => {
  it('makes a seat away on its second missed turn in a row, with that move the first thing its bot has played', () => {
    const once = noteClockMove(EVERYONE_HERE, SEATS, discard, true);
    expect(once[1]).toMatchObject({ userId: 'u-bilal', since: null, misses: 1, away: null, clockMoves: 1, lastClockMove: discard });
    expect(isAway(once, SEATS, 1)).toBe(false);
    const twice = noteClockMove(once, SEATS, discard, true);
    expect(AWAY_AFTER_MISSES).toBe(2);
    expect(twice[1]).toMatchObject({ misses: 2, away: 'clock', clockMoves: 2, played: { turns: 1, sets: 0, exchanges: 0, wins: 0, hands: 0 } });
    expect(isAway(twice, SEATS, 1)).toBe(true);
  });

  it('tells the person about a move that doesn’t count (a claim window, or their own late tap), and counts no miss', () => {
    const a = noteClockMove(noteClockMove(EVERYONE_HERE, SEATS, pass, false), SEATS, pass, false);
    expect(a[1]).toMatchObject({ misses: 0, away: null, clockMoves: 2, lastClockMove: pass });
  });

  it('stamps the entry with its sitting, and leaves a seat without a person alone', () => {
    expect(noteClockMove(EVERYONE_HERE, SEATS, { ...discard, seat: 0, a: { type: 'discard', seat: 0, tile: 's5' } }, true)[0]).toMatchObject({
      userId: 'u-amna',
      since: AMNA.since,
    });
    expect(noteClockMove(EVERYONE_HERE, SEATS, { by: 'clock', seat: 2, a: { type: 'pass', seat: 2 } }, true)).toBe(EVERYONE_HERE);
  });
});

describe('markPresent and markAway', () => {
  it('brings someone back: no misses, not away, nothing played, the tap noted; the clock moves they were told of stay told', () => {
    const away = noteClockMove(noteClockMove(EVERYONE_HERE, SEATS, discard, true), SEATS, discard, true);
    const back = markPresent(away, SEATS, 1, T0);
    expect(back[1]).toEqual({ ...away[1], misses: 0, away: null, lastTap: T0, played: { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 } });
    expect(markPresent(back, SEATS, 1, T0)).toEqual(back);
    // With the version of the table that saves it, when there's one: the host's hand-over is judged by it (R8).
    expect(markPresent(away, SEATS, 1, T0 + 5, 9)[1]).toMatchObject({ lastTap: T0 + 5, tapVersion: 9 });
    expect(back[1].tapVersion).toBeNull();
  });

  it('hands a seat to a bot once, with nothing played for it yet, and leaves a seat already away as it is', () => {
    const away = markAway(EVERYONE_HERE, SEATS, 1, 'host');
    expect(away[1]).toMatchObject({ userId: 'u-bilal', away: 'host' });
    expect(markAway(away, SEATS, 1, 'clock')).toBe(away);
  });

  it('puts someone on a break, and tells a seat already away for another reason that it’s a break now, keeping what the bot played', () => {
    expect(markOnBreak(EVERYONE_HERE, SEATS, 1)[1]).toEqual(markAway(EVERYONE_HERE, SEATS, 1, 'self')[1]);
    const clocked = noteClockMove(noteClockMove(EVERYONE_HERE, SEATS, discard, true), SEATS, discard, true);
    expect(clocked[1]).toMatchObject({ away: 'clock', played: { turns: 1 } });
    expect(markOnBreak(clocked, SEATS, 1)[1]).toEqual({ ...clocked[1], away: 'self' });
    const onBreak = markOnBreak(EVERYONE_HERE, SEATS, 1);
    expect(markOnBreak(onBreak, SEATS, 1)).toBe(onBreak);
    expect(markOnBreak(EVERYONE_HERE, SEATS, 2)).toBe(EVERYONE_HERE);
  });

  it('does nothing to a bot’s seat or an empty one', () => {
    expect(markPresent(EVERYONE_HERE, SEATS, 2, T0)).toBe(EVERYONE_HERE);
    expect(markAway(EVERYONE_HERE, SEATS, 3, 'host')).toBe(EVERYONE_HERE);
    expect(isAway(markAway(EVERYONE_HERE, SEATS, 2, 'host'), SEATS, 2)).toBe(false);
  });
});

describe('notePlayed and noteHandEnd', () => {
  it('counts a discard as a turn, a set picked up or four of a kind as a set, and three tiles passed as a pass; nothing else', () => {
    let a = markAway(EVERYONE_HERE, SEATS, 1, 'host');
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'discard', seat: 1, tile: 's5' } });
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'claim', seat: 1, claim: { type: 'pung', tiles: ['s5', 's5'] } } as Move['a'] });
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'declareKong', seat: 1, tile: 's5' } });
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'exchange', seat: 1, tiles: ['s1', 's2', 's3'] } });
    const before = a;
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'pass', seat: 1 } });
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'claim', seat: 1, claim: { type: 'win' } } as Move['a'] });
    a = notePlayed(a, { by: 'away', seat: 1, a: { type: 'declareWin', seat: 1 } });
    expect(a).toBe(before);
    expect(a[1].played).toEqual({ turns: 1, sets: 2, exchanges: 1, wins: 0, hands: 0 });
  });

  it('counts a finished hand for the away seats only, and a win for the one whose bot won it', () => {
    const away = markAway(EVERYONE_HERE, SEATS, 1, 'clock');
    const won = { phase: 'finished', result: { type: 'win', winner: 1 } } as unknown as HandState;
    const drawn = { phase: 'finished', result: { type: 'draw' } } as unknown as HandState;
    const after = noteHandEnd(noteHandEnd(away, SEATS, won), SEATS, drawn);
    expect(after[1].played).toMatchObject({ hands: 2, wins: 1 });
    expect(after[0]).toBe(away[0]);
    expect(noteHandEnd(EVERYONE_HERE, SEATS, won)).toBe(EVERYONE_HERE);
  });
});

describe('who’s here', () => {
  it('names the people here, by seat and by id, and flags the away seats', () => {
    const a = markAway(EVERYONE_HERE, SEATS, 1, 'host');
    expect(presentHumans(SEATS, a)).toEqual([0]);
    expect(presentHumans(SEATS, undefined)).toEqual([0, 1]);
    expect(presentUserIds(SEATS, a)).toEqual(['u-amna']);
    expect(awaySeats(SEATS, a)).toEqual([false, true, false, false]);
    // An entry that isn't the seat's person's says nothing about them.
    expect(isAway(a, [AMNA, { kind: 'human', userId: 'u-zara', name: 'Zara' }, SANA, null], 1)).toBe(false);
  });
});
