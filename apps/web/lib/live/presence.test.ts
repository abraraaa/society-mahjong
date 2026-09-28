import { describe, expect, it } from 'vitest';
import { karachi, startHand, viewFor, type Seat, type TileKind } from '@society/engine';
import { clockMoveNotice, seatMarks, tableNews } from './presence';
import type { GameSnapshot } from './snapshot';
import type { Move, PlayerMove, TableNote } from './types';

/**
 * The table's words about who's playing each seat, word for word. Names are
 * wrapped in isolates (U+2068 and U+2069) so a right-to-left name can't
 * reorder the sentence around it.
 */
const I = (name: string) => `⁨${name}⁩`;

const VIEW = viewFor(startHand(karachi, { seed: 'presence', progress: { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 }, dealer: 0 }), karachi, 0);

type PublicSeats = GameSnapshot['seats'];
const AMNA = { kind: 'human', name: 'Amna' } as const;
const BILAL = { kind: 'human', name: 'Bilal' } as const;
const ZARA = { kind: 'human', name: 'Zara' } as const;
const SANA = { kind: 'bot', name: 'Sana' } as const;
const OMAR = { kind: 'bot', name: 'Omar' } as const;
/** Amna and Bilal at the table with two bots, Amna reading. */
const FOUR: PublicSeats = [AMNA, BILAL, SANA, OMAR];

function snap(seats: PublicSeats, over: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    gameId: 'g1',
    roomId: 'r1',
    roomCode: 'KHI-4287Q',
    isHost: true,
    rulesetId: 'karachi',
    version: 5,
    deadlines: { claim: null, turn: null },
    seats,
    scores: [0, 0, 0, 0],
    me: 0,
    view: VIEW,
    status: 'active',
    now: 1_000_000,
    ...over,
  };
}

/** Bilal's seat after he got up: a bot plays it, under his name, as leaving leaves it. */
const BILAL_LEFT: PublicSeats = [AMNA, { kind: 'bot', name: 'Bilal' }, SANA, OMAR];
const LEFT_BILAL = `${I('Bilal')}'s left the table, so a bot's playing their seat for now.`;

describe('tableNews: someone leaves', () => {
  it('says who left, by the name they had, when a person’s seat turns into a bot', () => {
    expect(tableNews(snap(FOUR), snap(BILAL_LEFT, { version: 6 }))).toBe(LEFT_BILAL);
    // The bot in the seat may carry a name of its own: the line names the person who went.
    expect(tableNews(snap(FOUR), snap([AMNA, { kind: 'bot', name: 'Bot' }, SANA, OMAR], { version: 6 }))).toBe(LEFT_BILAL);
  });

  it('isolates the name, so a right-to-left name keeps its place in the sentence', () => {
    const line = tableNews(snap([AMNA, { kind: 'human', name: 'سارہ' }, SANA, OMAR]), snap([AMNA, { kind: 'bot', name: 'سارہ' }, SANA, OMAR]));
    expect(line).toBe(`⁨سارہ⁩'s left the table, so a bot's playing their seat for now.`);
  });

  it('comes with the same version too: getting up changes the seats, not the table, unless the bot then has a move to make', () => {
    expect(tableNews(snap(FOUR), snap(BILAL_LEFT))).toBe(LEFT_BILAL);
  });

  it('tells two at once in seat order, one sentence after the other', () => {
    const three: PublicSeats = [AMNA, BILAL, ZARA, OMAR];
    const both: PublicSeats = [AMNA, { kind: 'bot', name: 'Bilal' }, { kind: 'bot', name: 'Zara' }, OMAR];
    expect(tableNews(snap(three), snap(both, { version: 7 }))).toBe(`${LEFT_BILAL} ${I('Zara')}'s left the table, so a bot's playing their seat for now.`);
  });

  it('has nothing to say when no person’s seat went to a bot', () => {
    expect(tableNews(snap(FOUR), snap(FOUR, { version: 6 }))).toBeNull();
    // A bot swapped for another bot, a person for a person, or a seat that emptied: none of them is someone leaving the table.
    expect(tableNews(snap(FOUR), snap([AMNA, BILAL, OMAR, SANA], { version: 6 }))).toBeNull();
    expect(tableNews(snap(FOUR), snap([AMNA, ZARA, SANA, OMAR], { version: 6 }))).toBeNull();
    expect(tableNews(snap(FOUR), snap([AMNA, null, SANA, OMAR], { version: 6 }))).toBeNull();
    // A bot's seat taken by a person isn't a leave either.
    expect(tableNews(snap(FOUR), snap([AMNA, BILAL, ZARA, OMAR], { version: 6 }))).toBeNull();
  });

  it('never tells the reader about their own seat, before or after', () => {
    // Bilal reading, from his other phone: his own seat went to a bot. That's no news to him.
    expect(tableNews(snap(FOUR, { me: 1 }), snap(BILAL_LEFT, { me: null, version: 6 }))).toBeNull();
    expect(tableNews(snap(FOUR, { me: 1 }), snap(BILAL_LEFT, { me: 1, version: 6 }))).toBeNull();
    // Someone else leaving still is.
    expect(tableNews(snap(FOUR, { me: 1 }), snap([{ kind: 'bot', name: 'Amna' }, BILAL, SANA, OMAR], { me: 1, version: 6 }))).toBe(
      `${I('Amna')}'s left the table, so a bot's playing their seat for now.`,
    );
  });

  it('says nothing across games', () => {
    expect(tableNews(snap(FOUR), snap(BILAL_LEFT, { gameId: 'g2', version: 1 }))).toBeNull();
    expect(tableNews(snap(FOUR), snap(BILAL_LEFT, { gameId: 'g2', version: 9 }))).toBeNull();
  });

  it('says nothing for a snapshot older than the one before it', () => {
    expect(tableNews(snap(FOUR, { version: 8 }), snap(BILAL_LEFT, { version: 7 }))).toBeNull();
  });

  it('says nothing once the game is no longer in play: nobody is playing anyone’s seat for now', () => {
    expect(tableNews(snap(FOUR), snap(BILAL_LEFT, { version: 6, status: 'finished' }))).toBeNull();
    expect(tableNews(snap(FOUR), snap(BILAL_LEFT, { version: 6, status: 'abandoned' }))).toBeNull();
  });
});

describe('seatMarks', () => {
  it('marks each seat a bot plays, and no other', () => {
    expect(seatMarks(snap(FOUR))).toEqual({ 2: 'bot', 3: 'bot' });
    expect(seatMarks(snap(BILAL_LEFT))).toEqual({ 1: 'bot', 2: 'bot', 3: 'bot' });
    expect(seatMarks(snap([AMNA, null, SANA, null]))).toEqual({ 2: 'bot' });
    expect(seatMarks(snap([AMNA, BILAL, ZARA, { kind: 'human', name: 'Omar' }]))).toEqual({});
  });
});

describe('clockMoveNotice', () => {
  const ME: Seat = 0;
  const clock = (a: PlayerMove | TableNote): Move => ({ by: 'clock', seat: ME, a });
  const SEVEN: TileKind = 'm7';

  it('says what the bot did, in plain words', () => {
    expect(clockMoveNotice(clock({ type: 'discard', seat: ME, tile: SEVEN }))).toBe('You ran out of time, so a bot discarded the 7 Characters for you.');
    expect(clockMoveNotice(clock({ type: 'discard', seat: ME, tile: 's1' }))).toBe('You ran out of time, so a bot discarded the 1 Bamboo for you.');
    expect(clockMoveNotice(clock({ type: 'discard', seat: ME, tile: 'DR' }))).toBe('You ran out of time, so a bot discarded the Red Dragon for you.');
    expect(clockMoveNotice(clock({ type: 'pass', seat: ME }))).toBe('You ran out of time, so a bot let that tile go for you.');
    expect(clockMoveNotice(clock({ type: 'exchange', seat: ME, tiles: ['m1', 'm2', 'm3'] }))).toBe('You ran out of time, so a bot chose which tiles to pass for you.');
    expect(clockMoveNotice(clock({ type: 'declareKong', seat: ME, tile: SEVEN }))).toBe('You ran out of time, so a bot put down four of a kind for you.');
  });

  it('calls any set a set, however it was made', () => {
    const set = 'You ran out of time, so a bot picked up that tile to make a set for you.';
    expect(clockMoveNotice(clock({ type: 'claim', seat: ME, claim: { type: 'pung', tiles: [SEVEN, SEVEN] } }))).toBe(set);
    expect(clockMoveNotice(clock({ type: 'claim', seat: ME, claim: { type: 'chow', tiles: ['m8', 'm9'] } }))).toBe(set);
    expect(clockMoveNotice(clock({ type: 'claim', seat: ME, claim: { type: 'kong', tiles: [SEVEN, SEVEN, SEVEN] } }))).toBe(set);
  });

  it('calls Mahjong the same whether it came from a discard or the wall', () => {
    const win = 'Time ran out, so a bot called Mahjong for you.';
    expect(clockMoveNotice(clock({ type: 'claim', seat: ME, claim: { type: 'win' } }))).toBe(win);
    expect(clockMoveNotice(clock({ type: 'declareWin', seat: ME }))).toBe(win);
  });

  it('falls back to a plain line for anything else', () => {
    const moved = 'You ran out of time, so a bot moved for you.';
    expect(clockMoveNotice(clock({ type: 'back' }))).toBe(moved);
    expect(clockMoveNotice(clock({ type: 'away', reason: 'clock' }))).toBe(moved);
    expect(clockMoveNotice({ by: 'table', a: { type: 'endGame', how: 'idle' } })).toBe(moved);
  });

  it('never uses a word a first-timer can’t decode', () => {
    const every: (PlayerMove | TableNote)[] = [
      { type: 'discard', seat: ME, tile: SEVEN },
      { type: 'pass', seat: ME },
      { type: 'claim', seat: ME, claim: { type: 'pung', tiles: [SEVEN, SEVEN] } },
      { type: 'claim', seat: ME, claim: { type: 'chow', tiles: ['m8', 'm9'] } },
      { type: 'claim', seat: ME, claim: { type: 'kong', tiles: [SEVEN, SEVEN, SEVEN] } },
      { type: 'claim', seat: ME, claim: { type: 'win' } },
      { type: 'declareWin', seat: ME },
      { type: 'declareKong', seat: ME, tile: SEVEN },
      { type: 'exchange', seat: ME, tiles: ['m1', 'm2', 'm3'] },
      { type: 'back' },
    ];
    for (const a of every) expect(clockMoveNotice(clock(a))).not.toMatch(/pung|chow|kong|exchange|stand-in/i);
  });
});
