import { describe, expect, it } from 'vitest';
import { karachi, startHand, viewFor, type Seat, type TileKind } from '@society/engine';
import { IM_BACK, WELCOME_BACK, awaySummary, awayTitle, canLetBotPlay, clockMoveNotice, letBotPlayLabel, letBotPlaySheet, seatMarks, tableNews } from './presence';
import type { GameSnapshot, OwnAbsence } from './snapshot';
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
  it('marks a person a bot is playing for as away, and nobody whose clock has only run out', () => {
    expect(seatMarks(snap([AMNA, { ...BILAL, presence: 'away' }, SANA, OMAR]))).toEqual({ 1: 'away', 2: 'bot', 3: 'bot' });
    expect(seatMarks(snap([AMNA, { ...BILAL, presence: 'missed' }, SANA, OMAR]))).toEqual({ 2: 'bot', 3: 'bot' });
  });

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

/** The reader's own absence, as the server sends it to them alone. */
function own(over: Partial<OwnAbsence> = {}): OwnAbsence {
  return { misses: 0, away: null, clockMoves: 0, lastClockMove: null, played: { turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0 }, ...over };
}
const DISCARD: Move = { by: 'clock', seat: 0, a: { type: 'discard', seat: 0, tile: 'm7' } };
const RAN_OUT = 'You ran out of time, so a bot discarded the 7 Characters for you.';
const AWAY_BILAL = `${I('Bilal')}'s away, so a bot's playing their tiles for now.`;
const BACK_BILAL = `${I('Bilal')}'s back.`;
const HINT_BILAL = `${I('Bilal')}'s time ran out. If they've stepped away, tap their name to let a bot play for them.`;

describe('tableNews: away and back', () => {
  const AWAY: PublicSeats = [AMNA, { ...BILAL, presence: 'away' }, SANA, OMAR];
  const MISSED: PublicSeats = [AMNA, { ...BILAL, presence: 'missed' }, SANA, OMAR];

  it('says when someone else goes away, and when they’re back', () => {
    expect(tableNews(snap(FOUR), snap(AWAY, { version: 6 }))).toBe(AWAY_BILAL);
    expect(tableNews(snap(MISSED, { isHost: false }), snap(AWAY, { version: 6, isHost: false }))).toBe(AWAY_BILAL);
    expect(tableNews(snap(AWAY), snap(FOUR, { version: 7 }))).toBe(BACK_BILAL);
    expect(tableNews(snap(AWAY), snap(AWAY, { version: 7 }))).toBeNull();
  });

  it('calls someone away who then leaves the table left', () => {
    expect(tableNews(snap(AWAY), snap(BILAL_LEFT, { version: 7 }))).toBe(LEFT_BILAL);
  });

  it('tells the host alone about someone’s first clock that ran out, with what they can do', () => {
    expect(tableNews(snap(FOUR), snap(MISSED, { version: 6 }))).toBe(HINT_BILAL);
    expect(tableNews(snap(FOUR, { isHost: false }), snap(MISSED, { version: 6, isHost: false }))).toBeNull();
    // Once is enough: a second miss doesn't tell it again.
    expect(tableNews(snap(MISSED), snap(MISSED, { version: 7 }))).toBeNull();
  });

  it('welcomes the reader back from being away', () => {
    expect(tableNews(snap(FOUR, { mine: own({ away: 'clock' }) }), snap(FOUR, { version: 6, mine: own() }))).toBe(WELCOME_BACK);
    expect(WELCOME_BACK).toBe('Welcome back.');
  });

  it('tells the reader what a clock did for them, whichever phone found it, once', () => {
    const before = snap(FOUR, { mine: own() });
    const after = snap(FOUR, { version: 6, mine: own({ misses: 1, clockMoves: 1, lastClockMove: DISCARD }) });
    expect(tableNews(before, after)).toBe(RAN_OUT);
    expect(tableNews(after, { ...after, version: 7 })).toBeNull();
    // A table sent before this deploy carried no absence: its first ran-out move is still news.
    expect(tableNews(snap(FOUR), after)).toBe(RAN_OUT);
  });

  it('says nothing about the reader’s own clock once a bot is playing for them: the away note says it', () => {
    const away = snap(FOUR, { version: 6, mine: own({ misses: 2, away: 'clock', clockMoves: 2, lastClockMove: DISCARD }) });
    expect(tableNews(snap(FOUR, { mine: own({ misses: 1, clockMoves: 1, lastClockMove: DISCARD }) }), away)).toBeNull();
  });

  it('puts it all in order: back, their own clock, the seats, then the host’s hint', () => {
    const three: PublicSeats = [AMNA, BILAL, ZARA, OMAR];
    const prev = snap(three, { mine: own({ away: 'host' }) });
    const next = snap([AMNA, { ...BILAL, presence: 'missed' }, { ...ZARA, presence: 'away' }, OMAR], { version: 9, mine: own({ clockMoves: 1, lastClockMove: DISCARD }) });
    expect(tableNews(prev, next)).toBe(`${WELCOME_BACK} ${RAN_OUT} ${I('Zara')}'s away, so a bot's playing their tiles for now. ${HINT_BILAL}`);
  });
});

describe('canLetBotPlay', () => {
  it('is for the host, at a game in play, on someone else who’s a person and not away already', () => {
    const table = snap([AMNA, BILAL, SANA, { ...ZARA, presence: 'away' }]);
    expect(canLetBotPlay(table, 1)).toBe(true);
    expect(canLetBotPlay(table, 0)).toBe(false);
    expect(canLetBotPlay(table, 2)).toBe(false);
    expect(canLetBotPlay(table, 3)).toBe(false);
    expect(canLetBotPlay({ ...table, isHost: false }, 1)).toBe(false);
    expect(canLetBotPlay({ ...table, me: null }, 1)).toBe(false);
    expect(canLetBotPlay({ ...table, status: 'finished' }, 1)).toBe(false);
    expect(canLetBotPlay(snap([AMNA, { ...BILAL, presence: 'missed' }, SANA, OMAR]), 1)).toBe(true);
  });
});

describe('the away note', () => {
  it('says why a bot is playing, for each reason', () => {
    expect(awayTitle('clock')).toBe("Your time ran out twice, so a bot's playing your tiles for now.");
    expect(awayTitle('host')).toBe('The host asked a bot to play your tiles for now.');
    expect(awayTitle('self')).toBe("You're taking a break, so a bot's playing your tiles for now.");
    expect(IM_BACK).toBe("I'm back");
  });

  const played = (p: Partial<OwnAbsence['played']>) => ({ turns: 0, sets: 0, exchanges: 0, wins: 0, hands: 0, ...p });

  it('says what the bot has done so far, in order, in words', () => {
    expect(awaySummary(played({ turns: 4, sets: 1, exchanges: 2 }))).toBe("So far it's taken four turns, put down one set and passed tiles twice for you.");
    expect(awaySummary(played({ turns: 1 }))).toBe("So far it's taken one turn for you.");
    expect(awaySummary(played({ sets: 2, exchanges: 1 }))).toBe("So far it's put down two sets and passed tiles once for you.");
    expect(awaySummary(played({ turns: 12, exchanges: 10 }))).toBe("So far it's taken 12 turns and passed tiles 10 times for you.");
  });

  it('says how many hands finished, and how many the bot won', () => {
    expect(awaySummary(played({ hands: 1 }))).toBe('A hand finished while you were away.');
    expect(awaySummary(played({ hands: 1, wins: 1 }))).toBe('A hand finished while you were away, and the bot won it for you.');
    expect(awaySummary(played({ hands: 2 }))).toBe('Two hands finished while you were away.');
    expect(awaySummary(played({ hands: 3, wins: 2 }))).toBe('Three hands finished while you were away, and the bot won two of them for you.');
    expect(awaySummary(played({ hands: 12, wins: 1 }))).toBe('12 hands finished while you were away, and the bot won one of them for you.');
    expect(awaySummary(played({ turns: 5, hands: 1 }))).toBe("So far it's taken five turns for you. A hand finished while you were away.");
  });

  it('says nothing has come round yet when it hasn’t', () => {
    expect(awaySummary(played({}))).toBe("Nothing's come round to you yet.");
  });

  it('never uses a word a first-timer can’t decode', () => {
    for (const p of [played({ turns: 3, sets: 2, exchanges: 3, hands: 2, wins: 1 }), played({ exchanges: 1 }), played({})]) {
      expect(awaySummary(p)).not.toMatch(/exchange|pung|chow|kong|away\b.*\d/i);
    }
  });
});

describe('the host’s sheet', () => {
  it('asks, in the table’s words, with the name isolated', () => {
    expect(letBotPlaySheet('Bilal')).toEqual({
      title: `Let a bot play for ${I('Bilal')}?`,
      body: `A bot will play ${I('Bilal')}'s tiles straight away, as well as it can, so nobody's kept waiting. They can take over again with one tap.`,
      confirmLabel: 'Let a bot play',
      cancelLabel: 'Keep waiting',
    });
    expect(letBotPlayLabel('Bilal')).toBe(`Let a bot play for ${I('Bilal')}`);
  });
});
