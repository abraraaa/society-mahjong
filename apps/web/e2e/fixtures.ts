import { analysisBot, karachi, publicView, startHand, viewFor, type GameProgress, type HandState, type Seat, type TileKind } from '@society/engine';
import { EVERYONE_HERE, noteClockMove, presentHumans } from '../lib/live/absence';
import { nextHandWait, publicGameOver } from '../lib/live/lifecycle';
import { ownAbsence, publicSeats, type GameSnapshot, type RoomSnapshot } from '../lib/live/snapshot';
import { deadlinesFor, settle, step, type StepResult } from '../lib/live/table';
import { NEW_TABLE, type Absence, type TableState } from '../lib/live/table-state';
import type { ClientAction, Deadlines, Seats, TimerPolicy } from '../lib/live/types';

/**
 * The tables the browser tests serve in place of the game routes, made by the
 * real engine and the server's own step(), so a snapshot is always one the
 * server could have sent. Everything is seeded, so every run gets the same
 * tables; the seeds are searched for, not hard-coded, so an engine change that
 * moves the deal can't quietly turn a scenario into a different one.
 */

/** The guest the tests sit down as. The fake Supabase answers getUser with this user. */
export const USER_ID = '00000000-0000-4000-8000-000000000001';
export const USER_NAME = 'Amna';
export const GAME_ID = '6d1f3a8e-2b4c-4d5e-8f60-718293a4b5c6';
const ROOM_ID = '0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f';
const ROOM_CODE = 'KHI-4287Q';

/** Two humans, so a snapshot can change under Amna while her own move is on its way; two bots to fill the table. */
const SEATS: Seats = [
  { kind: 'human', userId: USER_ID, name: USER_NAME },
  { kind: 'human', userId: '00000000-0000-4000-8000-000000000002', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'bot', name: 'Omar' },
];
const ME: Seat = 0;

/** An hour on every clock, so no test ever runs into a deadline and the page never asks for a tick. */
const POLICY: TimerPolicy = { claimSeconds: 3600, turnSeconds: 3600 };
/** The server's clock when the snapshots were made. `serve` moves every snapshot to the moment it's sent. */
const MADE_AT = 1_000_000;

const EAST_HONOUR: GameProgress = { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 };
const WEST_GOULASH: GameProgress = { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 };
/** The game's sixteenth hand, its last. */
const NORTH_LAST: GameProgress = { roundWind: 'N', roundIndex: 3, handInRound: 3, handIndex: 15 };

/** The seats and Amna's own absence, as the server sends them for a table where `absence` says who's away. */
function presence(absence: Absence): Pick<GameSnapshot, 'seats' | 'mine'> {
  return { seats: publicSeats(SEATS, absence), mine: ownAbsence(SEATS, absence, ME) };
}

function snapshot(state: HandState, version: number, deadlines: Deadlines, status: GameSnapshot['status'] = 'active', extra: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    gameId: GAME_ID,
    roomId: ROOM_ID,
    roomCode: ROOM_CODE,
    isHost: true,
    rulesetId: karachi.id,
    version,
    deadlines,
    seats: SEATS.map((s) => (s ? { kind: s.kind, name: s.name } : null)),
    scores: [0, 0, 0, 0],
    me: ME,
    mine: ownAbsence(SEATS, EVERYONE_HERE, ME),
    view: viewFor(state, karachi, ME),
    status,
    now: MADE_AT,
    ...extra,
  };
}

/** One request against the table, as the act route makes it: with the game's seed when it may start a hand, and the table's bookkeeping when it has some. */
function act(state: HandState, deadlines: Deadlines, action: ClientAction, actor: Seat, opts: { readonly seed?: string; readonly tableState?: TableState } = {}) {
  return step({
    game: { state, deadlines, ...(opts.tableState ? { tableState: opts.tableState } : {}) },
    ruleset: karachi,
    seats: SEATS,
    policy: POLICY,
    now: MADE_AT,
    action,
    actor,
    ...(opts.seed ? { seed: opts.seed } : {}),
  });
}

/** The wait for the next hand as the server tells Amna: the people here, who has tapped Next hand and when it starts regardless. */
function waitOf(r: StepResult): Pick<GameSnapshot, 'nextHand'> {
  return { nextHand: nextHandWait(r.state, SEATS, presentHumans(SEATS, r.tableState.absence), r.tableState) };
}

/** A fresh hand with the bots played up to the first human decision, as dealing it does. */
function deal(seed: string, progress: GameProgress, dealer: Seat = 0) {
  const state = settle(startHand(karachi, { seed, progress, dealer }), karachi, SEATS);
  return { state, deadlines: deadlinesFor(state, karachi, SEATS, POLICY, MADE_AT) };
}

/** Play a hand out, each human's move the one the server's bot would make for them: the step that finished it, or null if it never got there. */
function playOut(start: { state: HandState; deadlines: Deadlines }): StepResult | null {
  let s: { state: HandState; deadlines: Deadlines } = start;
  let last: StepResult | null = null;
  for (let i = 0; i < 400 && s.state.phase !== 'finished'; i++) {
    const seat = s.state.phase === 'turn' ? s.state.turn : ([0, 1] as const).find((x) => viewFor(s.state, karachi, x).legal.claims !== undefined);
    if (seat === undefined) return null;
    const move = analysisBot(viewFor(s.state, karachi, seat), karachi) ?? ({ type: 'pass', seat } as const);
    if (move.type === 'resolveClaims') return null;
    last = act(s.state, s.deadlines, move, seat);
    s = last;
  }
  return s.state.phase === 'finished' ? last : null;
}

/** The first seed of `e2e-0`, `e2e-1`, ... for which `make` returns something. */
function search<T>(what: string, make: (seed: string) => T | null): T {
  for (let i = 0; i < 200; i++) {
    const found = make(`e2e-${i}`);
    if (found) return found;
  }
  throw new Error(`no seed gives ${what}`);
}

export interface Fixtures {
  /** Amna's turn to discard. */
  readonly turn: GameSnapshot;
  /** The same turn for a first-timer, as the server tallies her. */
  readonly newTurn: GameSnapshot;
  /** The same turn for a regular. */
  readonly solidTurn: GameSnapshot;
  /** The same turn after Bilal got up from the table: a bot plays his seat, under his name. Getting up changes the seats and not the table, so the version is the same. */
  readonly bilalLeft: GameSnapshot;
  /** Amna's turn clock ran out, and the tick that found it had a bot move for her: the table after it, with that move in her own absence (`mine`). */
  readonly timedOut: GameSnapshot;
  /** Amna's second turn in a row whose clock ran out, the first already missed: a bot plays her tiles now, and it's Bilal's turn. Bilal has the host's powers while she's away. */
  readonly awayTurn: GameSnapshot;
  /** The same, after her "I'm back". */
  readonly awayBack: GameSnapshot;
  /** `turn`'s table after Amna took a break from the Leave sheet: a bot has played her turn for her. Bilal has the host's powers while she's away. */
  readonly onBreak: GameSnapshot;
  /** Amna's turn, the host's table (hers), after she handed Bilal's seat to a bot. */
  readonly bilalAway: GameSnapshot;
  /** A West pass of three tiles: Bilal, host while she's away, handed Amna's seat to a bot, which passed her tiles at once; Bilal still owes his. */
  readonly awayWest: GameSnapshot;
  /** Amna's turn, at a table where she isn't the host. */
  readonly notHost: GameSnapshot;
  /** The table after her discard: Bilal's turn, so she has no Discard button. */
  readonly turnAfter: GameSnapshot;
  /** The same hand, finished, with the game over. */
  readonly finished: GameSnapshot;
  /** The same hand, finished, in a game still in play: the host's result sheet, with Next hand and End the game here. Two hands have finished. */
  readonly handDone: GameSnapshot;
  /** That result sheet, the game ended there by the host, Amna: her final table. */
  readonly endedByHost: GameSnapshot;
  /** That result sheet after Amna took a break between hands, from a Leave sheet still open as the hand ended: Bilal has the host's powers while she's away. */
  readonly breakBetween: GameSnapshot;
  /** The same, after her "I'm back": the host's result sheet again, Next hand still to tap. */
  readonly breakBetweenBack: GameSnapshot;
  /** That result sheet after Amna's tap of Next hand: waiting for Bilal, twenty seconds on the clock. */
  readonly readyWaiting: GameSnapshot;
  /** That result sheet after Bilal's tap of Next hand, Amna still to tap: twenty seconds on the clock. */
  readonly bilalReady: GameSnapshot;
  /** The next hand, started when Amna's wait for Bilal ran out: the tick's answer. */
  readonly nextDealt: GameSnapshot;
  /** The last hand scored, so the game is over: the host's final table. Bilal finishes top. */
  readonly lastHandOver: GameSnapshot;
  /** The same final table for someone who isn't the host. */
  readonly lastHandOverGuest: GameSnapshot;
  /** A West goulash: both humans still to pass three tiles. */
  readonly westSent: GameSnapshot;
  /** The same pass after Bilal's exchange: a newer version, nothing logged, Amna's exchange still open. */
  readonly westConflict: GameSnapshot;
  /** After Amna's exchange of `westTiles` too: the next pass. */
  readonly westLanded: GameSnapshot;
  /** The first three tiles in Amna's hand, the ones the tests pick in the exchange sheet. */
  readonly westTiles: readonly TileKind[];
  /** The lobby a week after the last game, for Amna, the host: Bilal hasn't opened the link tonight, and he finished top last time. */
  readonly lobbyAgain: RoomSnapshot;
  /** The same lobby for Amna when Hana is the host. */
  readonly lobbyGuest: RoomSnapshot;
  /** `turn`'s table for Amna while she isn't seated at it: Sana the bot's seat is hers to take over, with Sana's −3,000. */
  readonly offer: GameSnapshot;
  /** The same, with her own seat on offer: a bot has kept it since she left, with her +2,000. */
  readonly offerYours: GameSnapshot;
  /** The same, with the seat kept for her since the deal she missed on offer. */
  readonly offerKept: GameSnapshot;
  /** The lobby for Amna, not seated, at a game in play: Sana the bot's seat is on offer. */
  readonly lobbyOffer: RoomSnapshot;
  /** That lobby once she has taken Sana's seat: she's seated, so it's off to the table. */
  readonly lobbySeated: RoomSnapshot;
}

/** The room between games: four people, Bilal not here yet, and the last game, which Bilal won. */
const LOBBY_AGAIN: RoomSnapshot = {
  id: ROOM_ID,
  code: ROOM_CODE,
  rulesetId: karachi.id,
  status: 'finished',
  seats: [
    { kind: 'human', name: USER_NAME },
    { kind: 'human', name: 'Bilal', notHere: true },
    { kind: 'human', name: 'Hana' },
    { kind: 'human', name: 'Zara' },
  ],
  me: ME,
  isHost: true,
  hostSeat: ME,
  gameId: GAME_ID,
  lastGame: {
    how: 'complete',
    hands: 16,
    rows: [
      { seat: 0, name: USER_NAME, bot: false, score: 2000 },
      { seat: 1, name: 'Bilal', bot: false, score: 14504 },
      { seat: 2, name: 'Hana', bot: false, score: -8000 },
      { seat: 3, name: 'Zara', bot: false, score: -8504 },
    ],
    me: ME,
  },
};

/** A game in play with Hana and Bilal seated and two bots; Amna, reading, isn't seated. */
const LOBBY_OFFER: RoomSnapshot = {
  id: ROOM_ID,
  code: ROOM_CODE,
  rulesetId: karachi.id,
  status: 'playing',
  seats: [
    { kind: 'human', name: 'Hana' },
    { kind: 'human', name: 'Bilal' },
    { kind: 'bot', name: 'Sana' },
    { kind: 'bot', name: 'Omar' },
  ],
  me: null,
  isHost: false,
  hostSeat: 0,
  gameId: GAME_ID,
  offer: { seat: 2, botName: 'Sana', why: 'other', score: -3000 },
};

function build(): Fixtures {
  const live = search('a turn that passes to Bilal and a hand that finishes', (seed) => {
    const t = deal(seed, EAST_HONOUR);
    const v = viewFor(t.state, karachi, ME);
    const tile = v.legal.discard?.[0];
    if (t.state.phase !== 'turn' || t.state.turn !== ME || tile === undefined) return null;
    const after = act(t.state, t.deadlines, { type: 'discard', seat: ME, tile }, ME);
    if (after.state.phase !== 'turn' || after.state.turn !== 1) return null;
    const end = playOut(after);
    return end && { t, after, end, seed };
  });

  // Her clock runs out on that turn, and a tick finds it: the stand-in's move is kept in her own absence, which only she is sent.
  const expired = step({ game: { ...live.t, tableState: NEW_TABLE }, ruleset: karachi, seats: SEATS, policy: POLICY, now: live.t.deadlines.turn! + 1 });
  const timedOut = snapshot(expired.state, 6, expired.deadlines, 'active', presence(expired.tableState.absence));

  // Her second turn in a row with nobody at her phone: the first miss is behind her, and this one makes her away. The seed is one
  // where Bilal's turn comes next, so the table waits on him.
  const away = search('a second missed turn that leaves Bilal to play', (seed) => {
    const t = deal(seed, EAST_HONOUR);
    if (t.state.phase !== 'turn' || t.state.turn !== ME) return null;
    const missed = noteClockMove(EVERYONE_HERE, SEATS, { by: 'clock', seat: ME, a: { type: 'pass', seat: ME } }, true);
    const r = step({ game: { ...t, tableState: { ...NEW_TABLE, absence: missed } }, ruleset: karachi, seats: SEATS, policy: POLICY, now: t.deadlines.turn! + 1 });
    if (r.state.phase !== 'turn' || r.state.turn !== 1 || r.tableState.absence[ME].away !== 'clock') return null;
    const back = step({ game: r, ruleset: karachi, seats: SEATS, policy: POLICY, now: MADE_AT + 1, change: { type: 'back', seat: ME } });
    return { r, back };
  });
  // On her turn at `turn`'s table she takes a break from the Leave sheet instead: her bot plays the turn at once.
  const broke = step({ game: { ...live.t, tableState: NEW_TABLE }, ruleset: karachi, seats: SEATS, policy: POLICY, now: MADE_AT, change: { type: 'break', seat: ME } });
  // The host, Amna, hands Bilal's seat to a bot on her own turn: nobody was waiting on him, so her clock runs on.
  const handed = step({
    game: { ...live.t, tableState: NEW_TABLE },
    ruleset: karachi,
    seats: SEATS,
    policy: POLICY,
    now: MADE_AT,
    change: { type: 'letBotPlay', seat: 1, bySeat: ME, sawAt: null },
  });

  // The step that scores the last hand ends the game by itself: that step's end is what the page is told.
  const last = search('a last hand that plays out and ends the game', (seed) => {
    const end = playOut(deal(seed, NORTH_LAST, 3));
    return end?.tableState.over ? { end, over: end.tableState.over } : null;
  });
  const lastHandOver = snapshot(last.end.state, 31, { claim: null, turn: null }, 'finished', {
    scores: [2000, 14504, -8000, -8504],
    ended: publicGameOver(last.over, USER_ID),
  });

  // Next hand on that finished hand: Amna taps first, and the table waits for Bilal; or Bilal does, and it waits for her. When the wait
  // runs out, the tick that finds it starts the next hand.
  const hand = live.end.state.progress.handIndex;
  const amnaVoted = act(live.end.state, live.end.deadlines, { type: 'nextHand', hand }, ME, { seed: live.seed, tableState: live.end.tableState });
  const bilalVoted = act(live.end.state, live.end.deadlines, { type: 'nextHand', hand }, 1, { seed: live.seed, tableState: live.end.tableState });
  const dealt = step({ game: amnaVoted, ruleset: karachi, seats: SEATS, policy: POLICY, now: amnaVoted.tableState.ready!.dealAt + 1, seed: live.seed });
  const doneScores = [...(live.end.tableState.scores ?? [0, 0, 0, 0])];

  // Between hands, on that finished hand, Amna takes a break from the Leave sheet; then she's back.
  const brokeBetween = step({ game: live.end, ruleset: karachi, seats: SEATS, policy: POLICY, now: MADE_AT, change: { type: 'break', seat: ME } });
  const backBetween = step({ game: brokeBetween, ruleset: karachi, seats: SEATS, policy: POLICY, now: MADE_AT + 1, change: { type: 'back', seat: ME } });

  // The host ends the game on the finished hand, as the end route's step does: that step's end is what the page is told.
  const byHost = step({ game: live.end, ruleset: karachi, seats: SEATS, policy: POLICY, now: MADE_AT, end: { how: 'host', by: { userId: USER_ID, name: USER_NAME } } });
  const hostOver = byHost.tableState.over!;

  const west = search('a West goulash with both humans still to pass', (seed) => {
    const w = deal(seed, WEST_GOULASH);
    const mine = viewFor(w.state, karachi, ME);
    const bilal = viewFor(w.state, karachi, 1);
    if (w.state.phase !== 'preplay' || mine.legal.exchange?.count !== 3 || bilal.legal.exchange?.count !== 3) return null;
    const conflict = act(w.state, w.deadlines, { type: 'exchange', seat: 1, tiles: bilal.concealed.slice(0, 3) }, 1);
    const still = viewFor(conflict.state, karachi, ME);
    // Bilal's exchange must log nothing and leave Amna's hand as she saw it, or the page would rightly refuse to try again.
    if (conflict.state.seq !== w.state.seq || still.legal.exchange?.count !== 3 || still.concealed.join() !== mine.concealed.join()) return null;
    const tiles = mine.concealed.slice(0, 3);
    const landed = act(conflict.state, conflict.deadlines, { type: 'exchange', seat: ME, tiles }, ME);
    if (landed.state.seq === w.state.seq) return null;
    return { w, conflict, landed, tiles };
  });

  // Bilal hands Amna's seat to a bot during a West pass both owe: her bot passes her tiles at once, and he still owes his.
  const westAway = step({
    game: { ...west.w, tableState: NEW_TABLE },
    ruleset: karachi,
    seats: SEATS,
    policy: POLICY,
    now: MADE_AT,
    change: { type: 'letBotPlay', seat: ME, bySeat: 1, sawAt: null },
  });

  return {
    turn: snapshot(live.t.state, 5, live.t.deadlines),
    newTurn: { ...snapshot(live.t.state, 5, live.t.deadlines), stage: 'new' },
    solidTurn: { ...snapshot(live.t.state, 5, live.t.deadlines), stage: 'solid' },
    bilalLeft: snapshot(live.t.state, 5, live.t.deadlines, 'active', {
      seats: SEATS.map((s, i) => (i === 1 ? { kind: 'bot', name: 'Bilal' } : s && { kind: s.kind, name: s.name })),
    }),
    timedOut,
    awayTurn: snapshot(away.r.state, 7, away.r.deadlines, 'active', { ...presence(away.r.tableState.absence), isHost: false }),
    awayBack: snapshot(away.back.state, 8, away.back.deadlines, 'active', presence(away.back.tableState.absence)),
    onBreak: snapshot(broke.state, 6, broke.deadlines, 'active', { ...presence(broke.tableState.absence), isHost: false }),
    bilalAway: snapshot(handed.state, 6, handed.deadlines, 'active', presence(handed.tableState.absence)),
    awayWest: snapshot(westAway.state, 2, westAway.deadlines, 'active', { ...presence(westAway.tableState.absence), isHost: false }),
    notHost: { ...snapshot(live.t.state, 5, live.t.deadlines), isHost: false },
    turnAfter: snapshot(live.after.state, 6, live.after.deadlines),
    finished: snapshot(live.end.state, 9, { claim: null, turn: null }, 'finished'),
    handDone: snapshot(live.end.state, 9, { claim: null, turn: null }, 'active', { scores: doneScores, ...waitOf(live.end) }),
    readyWaiting: snapshot(amnaVoted.state, 10, amnaVoted.deadlines, 'active', { scores: doneScores, ...waitOf(amnaVoted) }),
    bilalReady: snapshot(bilalVoted.state, 10, bilalVoted.deadlines, 'active', { scores: doneScores, ...waitOf(bilalVoted) }),
    nextDealt: snapshot(dealt.state, 11, dealt.deadlines, 'active', { scores: [...(dealt.tableState.scores ?? [0, 0, 0, 0])], ...waitOf(dealt) }),
    endedByHost: snapshot(byHost.state, 10, byHost.deadlines, 'finished', { scores: [...hostOver.scores], ended: publicGameOver(hostOver, USER_ID) }),
    breakBetween: snapshot(brokeBetween.state, 10, brokeBetween.deadlines, 'active', {
      scores: doneScores,
      ...presence(brokeBetween.tableState.absence),
      ...waitOf(brokeBetween),
      isHost: false,
    }),
    breakBetweenBack: snapshot(backBetween.state, 11, backBetween.deadlines, 'active', { scores: doneScores, ...presence(backBetween.tableState.absence), ...waitOf(backBetween) }),
    lastHandOver,
    lastHandOverGuest: { ...lastHandOver, isHost: false },
    westSent: snapshot(west.w.state, 1, west.w.deadlines),
    westConflict: snapshot(west.conflict.state, 2, west.conflict.deadlines),
    westLanded: snapshot(west.landed.state, 3, west.landed.deadlines),
    westTiles: west.tiles,
    lobbyAgain: LOBBY_AGAIN,
    lobbyGuest: { ...LOBBY_AGAIN, isHost: false, hostSeat: 2 },
    ...offers(live.t.state, live.t.deadlines),
    lobbyOffer: LOBBY_OFFER,
    lobbySeated: { ...LOBBY_OFFER, seats: [LOBBY_OFFER.seats[0]!, LOBBY_OFFER.seats[1]!, { kind: 'human', name: USER_NAME }, LOBBY_OFFER.seats[3]!], me: 2, offer: null },
  };
}

/** A table Amna isn't seated at, as the server shows it to her: the public view, with a bot's seat on offer. */
function offers(state: HandState, deadlines: Deadlines): Pick<Fixtures, 'offer' | 'offerYours' | 'offerKept'> {
  const unseated = (offer: NonNullable<GameSnapshot['offer']>, seats: GameSnapshot['seats']): GameSnapshot => ({
    ...snapshot(state, 5, deadlines),
    isHost: false,
    seats,
    scores: [2000, 14504, -3000, -13504],
    me: null,
    view: publicView(state),
    mine: null,
    stage: null,
    offer,
  });
  const others = SEATS.map((s) => s && { kind: s.kind, name: s.name });
  // Hamza the bot keeps Amna's seat for her.
  const kept: GameSnapshot['seats'] = [{ kind: 'bot', name: 'Hamza', keptFor: USER_NAME }, others[1]!, others[2]!, others[3]!];
  return {
    offer: unseated({ seat: 2, botName: 'Sana', why: 'other', score: -3000 }, [{ kind: 'human', name: 'Hana' }, others[1]!, others[2]!, others[3]!]),
    offerYours: unseated({ seat: 0, botName: 'Hamza', why: 'left', score: 2000 }, kept),
    offerKept: unseated({ seat: 0, botName: 'Hamza', why: 'late', score: 2000 }, kept),
  };
}

let built: Fixtures | null = null;

/** The fixtures, built once per worker. */
export function fixtures(): Fixtures {
  built ??= build();
  return built;
}

/** A snapshot as the server would send it now: its clock, its deadlines and when the next hand starts moved to the moment of sending. */
export function serve(s: GameSnapshot): GameSnapshot {
  const now = Date.now();
  const shift = (d: number | null) => (d === null ? null : d - s.now + now);
  const nextHand = s.nextHand && { ...s.nextHand, startsAt: shift(s.nextHand.startsAt) };
  return { ...s, now, deadlines: { claim: shift(s.deadlines.claim), turn: shift(s.deadlines.turn) }, ...(nextHand ? { nextHand } : {}) };
}
