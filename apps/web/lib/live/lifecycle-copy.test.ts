import { describe, expect, it } from 'vitest';
import { finalStandings } from './final';
import {
  HOST_LEAVE,
  LEAVE,
  NOT_HERE_HINT,
  NO_SEAT,
  NO_SEAT_OVER,
  SHARE,
  countdown,
  endLine,
  endSheet,
  hereCount,
  seatTag,
  startLabel,
  takeSeatCopy,
  topLine,
  waitCopy,
  waitingForHost,
} from './lifecycle-copy';
import type { RoomSnapshot } from './snapshot';
import type { PublicGameOver } from './lifecycle';

/**
 * The lifecycle copy, word for word. Names are wrapped in isolates (U+2068
 * and U+2069) so a right-to-left name can't reorder the sentence around it.
 */
const I = (name: string) => `⁨${name}⁩`;

/** Amna, Bilal (people), Sana and Omar (bots), with these totals. */
const table = (scores: readonly number[]) =>
  finalStandings(
    [
      { name: 'Amna', bot: false },
      { name: 'Bilal', bot: false },
      { name: 'Sana', bot: true },
      { name: 'Omar', bot: true },
    ],
    scores,
  );

const BILAL_TOP = table([2000, 14504, -8000, -8504]);
const AMNA_TOP = table([14504, 2000, -8000, -8504]);
const SANA_TOP = table([2000, -8504, 14504, -8000]);
const NOBODY = table([0, 0, 0, 0]);
const AMNA_AND_BILAL = table([6000, 6000, -4000, -8000]);
const THREE_TIE = table([4000, 4000, 4000, -12000]);

describe('topLine', () => {
  it('on the final table ("now")', () => {
    expect(topLine(NOBODY, 0, 'now')).toBe('Nobody won a hand, so everyone finishes on 0.');
    expect(topLine(AMNA_TOP, 0, 'now')).toBe('You finish top on +14,504.');
    expect(topLine(BILAL_TOP, 0, 'now')).toBe(`${I('Bilal')} finishes top on +14,504.`);
    expect(topLine(SANA_TOP, 0, 'now')).toBe(`${I('Sana')}, a bot, finishes top on +14,504.`);
    expect(topLine(AMNA_AND_BILAL, 2, 'now')).toBe(`${I('Amna')} and ${I('Bilal')} tie for top on +6,000.`);
  });

  it('puts "You" first in a tie the reader is in, whatever their seat', () => {
    expect(topLine(AMNA_AND_BILAL, 0, 'now')).toBe(`You and ${I('Bilal')} tie for top on +6,000.`);
    expect(topLine(AMNA_AND_BILAL, 1, 'now')).toBe(`You and ${I('Amna')} tie for top on +6,000.`);
    expect(topLine(THREE_TIE, 2, 'now')).toBe(`You, ${I('Amna')} and ${I('Bilal')} tie for top on +4,000.`);
  });

  it('for a game that’s over ("then")', () => {
    expect(topLine(NOBODY, 0, 'then')).toBe('Nobody won a hand.');
    expect(topLine(AMNA_TOP, 0, 'then')).toBe('You finished top on +14,504.');
    expect(topLine(BILAL_TOP, 0, 'then')).toBe(`${I('Bilal')} finished top on +14,504.`);
    expect(topLine(SANA_TOP, null, 'then')).toBe(`${I('Sana')}, a bot, finished top on +14,504.`);
    expect(topLine(AMNA_AND_BILAL, 3, 'then')).toBe(`${I('Amna')} and ${I('Bilal')} tied for top on +6,000.`);
    expect(topLine(AMNA_AND_BILAL, 1, 'then')).toBe(`You and ${I('Amna')} tied for top on +6,000.`);
  });

  it('calls someone watching by name, never "You"', () => {
    expect(topLine(AMNA_TOP, null, 'now')).toBe(`${I('Amna')} finishes top on +14,504.`);
  });
});

describe('endLine', () => {
  const ended = (how: PublicGameOver['how'], hands: number, byName: string | null = null, byMe = false): PublicGameOver => ({ how, hands, byName, byMe });
  const top = `${I('Bilal')} finishes top on +14,504.`;

  it('after the last hand', () => {
    expect(endLine(null, BILAL_TOP, 0)).toBe(`That's the game. ${top}`);
    expect(endLine(ended('complete', 16), BILAL_TOP, 0)).toBe(`That's the game. ${top}`);
    expect(endLine(ended('complete', 16), AMNA_TOP, 0)).toBe(`That's the game. You finish top on +14,504.`);
    expect(endLine(null, NOBODY, 0)).toBe(`That's the game. Nobody won a hand, so everyone finishes on 0.`);
  });

  it('ended by the reader', () => {
    expect(endLine(ended('host', 2, 'Amna', true), BILAL_TOP, 0)).toBe(`You ended the game after two hands. ${top}`);
    expect(endLine(ended('host', 1, 'Amna', true), BILAL_TOP, 0)).toBe(`You ended the game after one hand. ${top}`);
    expect(endLine(ended('host', 12, 'Amna', true), BILAL_TOP, 0)).toBe(`You ended the game after 12 hands. ${top}`);
    expect(endLine(ended('host', 0, 'Amna', true), NOBODY, 0)).toBe('You ended the game before any hands finished.');
  });

  it('ended by someone else, or by a host whose name isn’t known', () => {
    expect(endLine(ended('host', 2, 'Bilal'), BILAL_TOP, 0)).toBe(`${I('Bilal')} ended the game after two hands. ${top}`);
    expect(endLine(ended('host', 2, 'Amna'), BILAL_TOP, 1)).toBe(`${I('Amna')} ended the game after two hands. You finish top on +14,504.`);
    expect(endLine(ended('host', 0, 'Amna'), NOBODY, 1)).toBe(`${I('Amna')} ended the game before any hands finished.`);
    expect(endLine(ended('host', 7), BILAL_TOP, 0)).toBe(`The host ended the game after seven hands. ${top}`);
    expect(endLine(ended('host', 0), NOBODY, 0)).toBe('The host ended the game before any hands finished.');
  });

  it('ended because nobody was playing', () => {
    expect(endLine(ended('idle', 5), BILAL_TOP, 0)).toBe(`This game ended after five hands, because nobody had played for a while. ${top}`);
    expect(endLine(ended('idle', 1), BILAL_TOP, 0)).toBe(`This game ended after one hand, because nobody had played for a while. ${top}`);
    expect(endLine(ended('idle', 0), NOBODY, 0)).toBe('This game ended before any hands finished, because nobody had played for a while.');
  });
});

describe('endSheet', () => {
  it('from the result sheet, when every hand so far has counted', () => {
    expect(endSheet(false, 2)).toEqual({
      title: 'End the game here?',
      body: "Everyone will see the final scores from the two hands you've played.",
      confirmLabel: 'End the game',
      cancelLabel: 'Keep playing',
    });
    expect(endSheet(false, 1).body).toBe("Everyone will see the final scores from the one hand you've played.");
    expect(endSheet(false, 12).body).toBe("Everyone will see the final scores from the 12 hands you've played.");
  });

  it('mid-hand, when the hand being played won’t count', () => {
    expect(endSheet(true, 5)).toEqual({
      title: 'End the game now?',
      body: "This hand won't count. Everyone will see the final scores from the five hands you've finished.",
      confirmLabel: 'End the game',
      cancelLabel: 'Keep playing',
    });
    expect(endSheet(true, 1).body).toBe("This hand won't count. Everyone will see the final scores from the one hand you've finished.");
    expect(endSheet(true, 15).body).toBe("This hand won't count. Everyone will see the final scores from the 15 hands you've finished.");
  });

  it('mid-hand before any hand has finished', () => {
    expect(endSheet(true, 0)).toEqual({
      title: 'End the game now?',
      body: 'No hands have finished yet, so nobody has any points.',
      confirmLabel: 'End the game',
      cancelLabel: 'Keep playing',
    });
  });
});

describe('HOST_LEAVE', () => {
  it('offers the host leaving, ending the game for everyone, or staying', () => {
    expect(HOST_LEAVE).toEqual({
      title: 'Leave the table?',
      body: "A bot will play your seat so the others can carry on, and someone still here can start the next game. Or, if everyone's done, end the game for the whole table.",
      leave: 'Leave',
      end: 'End the game for everyone',
      stay: 'Stay',
    });
  });
});

describe('countdown', () => {
  it('shows minutes and seconds, whole seconds rounded up, never below nought', () => {
    expect(countdown(14_000)).toBe('0:14');
    expect(countdown(13_200)).toBe('0:14');
    expect(countdown(20_000)).toBe('0:20');
    expect(countdown(65_000)).toBe('1:05');
    expect(countdown(1)).toBe('0:01');
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-5_000)).toBe('0:00');
    expect(countdown(Number.NaN)).toBe('0:00');
  });
});

describe('waitCopy', () => {
  /** Amna (me, seat 0), Bilal, Sana (a bot) and Zara. */
  const names = { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Zara' } as const;
  const at = (ready: readonly (0 | 1 | 2 | 3)[], waiting: readonly (0 | 1 | 2 | 3)[], startsAt: number | null = 1) => ({ ready, waiting, startsAt });

  it('is a plain Next hand before anyone has tapped, with no line', () => {
    expect(waitCopy(at([], [0, 1, 3], null), 0, names, null)).toEqual({ button: 'Next hand', line: null, ready: false });
  });

  it('says who I’m waiting for once I’ve tapped, and can’t be tapped again', () => {
    expect(waitCopy(at([0], [1]), 0, names, 14_000)).toEqual({
      button: `Waiting for ${I('Bilal')}`,
      line: "The next hand starts in 0:14, or as soon as everyone's ready.",
      ready: true,
    });
    expect(waitCopy(at([0], [1, 3]), 0, names, 19_100).button).toBe(`Waiting for ${I('Bilal')} and ${I('Zara')}`);
  });

  it('tells me when I’m the only one left, naming who’s ready: one name, then more', () => {
    expect(waitCopy(at([1], [0]), 0, names, 9_000)).toEqual({
      button: 'Next hand',
      line: `${I('Bilal')}'s ready. The next hand starts in 0:09, or as soon as you tap.`,
      ready: false,
    });
    expect(waitCopy(at([1, 3], [0]), 0, names, 9_000).line).toBe(`${I('Bilal')} and ${I('Zara')} are ready. The next hand starts in 0:09, or as soon as you tap.`);
  });

  it('tells me who’s ready when others are still to tap too', () => {
    expect(waitCopy(at([1], [0, 3]), 0, names, 20_000).line).toBe(`${I('Bilal')}'s ready. The next hand starts in 0:20, or as soon as everyone's ready.`);
    const four = { 0: 'You', 1: 'Bilal', 2: 'Hana', 3: 'Zara' } as const;
    expect(waitCopy(at([1, 2], [0, 3]), 0, four, 20_000).line).toBe(`${I('Bilal')} and ${I('Hana')} are ready. The next hand starts in 0:20, or as soon as everyone's ready.`);
  });

  it('has no line until a start time is set, and none without the time left', () => {
    expect(waitCopy(at([1], [0]), 0, names, null).line).toBeNull();
    expect(waitCopy(at([1], [0], null), 0, names, 5_000).line).toBeNull();
  });

  it('keeps to the plain line when whoever tapped first is no longer here, and to Next hand with nobody left to wait for', () => {
    expect(waitCopy(at([], [0, 1]), 0, names, 5_000)).toEqual({ button: 'Next hand', line: "The next hand starts in 0:05, or as soon as everyone's ready.", ready: false });
    expect(waitCopy(at([0], []), 0, names, 5_000)).toMatchObject({ button: 'Next hand', ready: true });
  });
});

describe('the lobby', () => {
  /** Amna hosts; Bilal hasn't opened the link tonight; Sana is a bot; the last seat is empty. */
  const lobby = (extra: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
    id: 'r-1',
    code: 'KHI-4287Q',
    rulesetId: 'karachi',
    status: 'finished',
    seats: [{ kind: 'human', name: 'Amna' }, { kind: 'human', name: 'Bilal', notHere: true }, { kind: 'bot', name: 'Sana' }, null],
    me: 0,
    isHost: true,
    hostSeat: 0,
    gameId: 'g-1',
    lastGame: null,
    ...extra,
  });
  const full = [
    { kind: 'human', name: 'Amna' },
    { kind: 'human', name: 'Bilal' },
    { kind: 'human', name: 'Hana' },
    { kind: 'human', name: 'Zara' },
  ] as const;

  it('invites with a line and a button that says when the link went to the clipboard', () => {
    expect(SHARE).toEqual({ line: 'Send your friends the link, or read them the code.', button: 'Send link', copied: 'Link copied' });
  });

  it('labels the host’s button by the bots that will sit down, counting empty seats, bots and anyone not here yet', () => {
    expect(startLabel(lobby({ status: 'lobby', seats: full }))).toBe('Start');
    expect(startLabel(lobby({ status: 'lobby', seats: [full[0], null, null, null] }))).toBe('Start, with three bots');
    expect(startLabel(lobby({ status: 'lobby', seats: [full[0], full[1], full[2], { kind: 'bot', name: 'Sana' }] }))).toBe('Start, with one bot');
    expect(startLabel(lobby({ seats: full }))).toBe('Play again, same seats');
    // Bilal isn't here yet, Sana's a bot and the last seat is empty: three bots sit down.
    expect(startLabel(lobby())).toBe('Play again, with three bots');
    // Someone not here yet gets a bot that keeps their seat for them.
    expect(startLabel(lobby({ seats: [full[0], { ...full[1], notHere: true }, full[2], full[3]] }))).toBe('Play again, with one bot');
    expect(startLabel(lobby({ status: 'lobby', seats: [full[0], { ...full[1], notHere: true }, null, null] }))).toBe('Start, with three bots');
  });

  it('tells the host what the start does for anyone not here yet', () => {
    expect(NOT_HERE_HINT).toBe('Anyone not here yet gets a bot when you start, and can take their seat back when they arrive.');
  });

  it('tags each seat: the reader’s own, a bot, someone not here yet, and whoever has the host’s powers', () => {
    const r = lobby({ me: 2, seats: [full[0], { kind: 'human', name: 'Bilal', notHere: true }, full[2], { kind: 'bot', name: 'Sana' }] });
    expect([0, 1, 2, 3].map((i) => seatTag(r, i))).toEqual(['host', 'not here yet', 'you', 'bot']);
    expect(seatTag(lobby(), 0)).toBe('you');
    expect(seatTag(lobby(), 3)).toBe('');
    // The powers passed to Hana, who's here, while the room's host isn't.
    const passed = lobby({ me: 1, hostSeat: 2, seats: [{ kind: 'human', name: 'Amna', notHere: true }, full[1], full[2], null] });
    expect([0, 1, 2, 3].map((i) => seatTag(passed, i))).toEqual(['not here yet', 'you', 'host', '']);
  });

  it('tells everyone else who they’re waiting for, before the first game and between games', () => {
    expect(waitingForHost(lobby({ status: 'lobby', me: 1, isHost: false }))).toBe(`Waiting for ${I('Amna')} to start.`);
    expect(waitingForHost(lobby({ me: 1, isHost: false }))).toBe(`That game's over. Waiting for ${I('Amna')} to start the next one.`);
    expect(waitingForHost(lobby({ status: 'lobby', hostSeat: null, isHost: false }))).toBe('Waiting for the host to start.');
    expect(waitingForHost(lobby({ hostSeat: null, isHost: false }))).toBe("That game's over. Waiting for the host to start the next one.");
  });

  it('counts the people here, as a tally, leaving out bots and anyone not here yet', () => {
    expect(hereCount(lobby(), 'Karachi rules')).toBe('1 of 4 here · Karachi rules');
    expect(hereCount(lobby({ seats: full }), 'Karachi rules')).toBe('4 of 4 here · Karachi rules');
    expect(hereCount(lobby({ seats: [null, null, null, null] }), 'Karachi rules')).toBe('0 of 4 here · Karachi rules');
  });

  it('says how the last game went, looking back', () => {
    expect(topLine(table([2000, 14504, -8000, -8504]), null, 'then')).toBe(`${I('Bilal')} finished top on +14,504.`);
    expect(topLine(table([2000, 14504, -8000, -8504]), 1, 'then')).toBe('You finished top on +14,504.');
    expect(topLine(table([-9000, -8000, 25000, -8000]), null, 'then')).toBe(`${I('Sana')}, a bot, finished top on +25,000.`);
    expect(topLine(table([9000, 9000, -9000, -9000]), 1, 'then')).toBe(`You and ${I('Amna')} tied for top on +9,000.`);
    expect(topLine(table([0, 0, 0, 0]), 0, 'then')).toBe('Nobody won a hand.');
  });
});

describe('keeping seats', () => {
  it('asks before anyone but the host leaves, and says the link sits them back down', () => {
    expect(LEAVE).toEqual({
      title: 'Leave the table?',
      body: "A bot will play your seat so the others can carry on. If you change your mind, open the invite link again to sit back down. If you're the last person here, the game ends.",
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
    });
  });

  it('offers someone who left their own seat back, with their points so far', () => {
    expect(takeSeatCopy({ seat: 1, botName: 'Hamza', why: 'left', score: 14504 })).toEqual({
      title: 'Sit back down?',
      body: "A bot's been playing your seat since you left. Sit down and you'll carry on with its tiles, and your points so far (+14,504).",
      confirmLabel: 'Sit back down',
      cancelLabel: 'Not now',
    });
    expect(takeSeatCopy({ seat: 1, botName: 'Hamza', why: 'left', score: 0 }).body).toBe(
      "A bot's been playing your seat since you left. Sit down and you'll carry on with its tiles.",
    );
  });

  it('offers someone who wasn’t here at the start the seat kept for them', () => {
    expect(takeSeatCopy({ seat: 1, botName: 'Hamza', why: 'late', score: -3000 })).toEqual({
      title: 'Take your seat?',
      body: "We kept your seat, and a bot's been playing it since the game started. Sit down and you'll carry on with its tiles, and its points so far (−3,000).",
      confirmLabel: 'Take your seat',
      cancelLabel: 'Not now',
    });
    expect(takeSeatCopy({ seat: 1, botName: 'Hamza', why: 'late', score: 0 }).body).toBe(
      "We kept your seat, and a bot's been playing it since the game started. Sit down and you'll carry on with its tiles.",
    );
  });

  it('offers anyone else a bot’s seat by the bot’s name, and says the tutor is there', () => {
    expect(takeSeatCopy({ seat: 2, botName: 'Sana', why: 'other', score: -3000 })).toEqual({
      title: `Take over from ${I('Sana')}?`,
      body: `This game's under way, and a bot called ${I('Sana')} is playing one of the seats. Take over and you'll play on with its tiles and its points so far (−3,000). The tutor's there if you want help.`,
      confirmLabel: `Take over from ${I('Sana')}`,
      cancelLabel: 'Not now',
    });
    expect(takeSeatCopy({ seat: 2, botName: 'Sana', why: 'other', score: 0 }).body).toBe(
      `This game's under way, and a bot called ${I('Sana')} is playing one of the seats. Take over and you'll play on with its tiles. The tutor's there if you want help.`,
    );
  });

  it('says every seat is a person’s, or the game is over, to someone with no seat to take', () => {
    expect(NO_SEAT).toEqual({
      heading: 'All four seats are taken in this game.',
      line: "When it's over, open the invite link again and you can play the next one.",
      link: 'Back to the start',
    });
    expect(NO_SEAT_OVER).toEqual({ heading: "This game's over.", line: 'Head back to the room for the next one.', link: 'Back to the room' });
  });

  it('never meets a newcomer with a word they can’t decode', () => {
    const offers = (['left', 'late', 'other'] as const).flatMap((why) => [0, 2000].map((score) => takeSeatCopy({ seat: 0, botName: 'Sana', why, score })));
    const words = [LEAVE.body, NOT_HERE_HINT, NO_SEAT.heading, NO_SEAT.line, ...offers.flatMap((o) => [o.title, o.body, o.confirmLabel])].join(' ');
    expect(words).not.toMatch(/pung|chow|kong|goulash|exchange|\bdeal\b/i);
  });
});
