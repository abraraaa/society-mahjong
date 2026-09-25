import { analysisBot, karachi, startHand, viewFor, type GameProgress, type HandState, type Seat, type TileKind } from '@society/engine';
import type { GameSnapshot } from '../lib/live/snapshot';
import { deadlinesFor, settle, step } from '../lib/live/table';
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
  { kind: 'bot', name: 'Bot' },
  { kind: 'bot', name: 'Bot' },
];
const ME: Seat = 0;

/** An hour on every clock, so no test ever runs into a deadline and the page never asks for a tick. */
const POLICY: TimerPolicy = { claimSeconds: 3600, turnSeconds: 3600 };
/** The server's clock when the snapshots were made. `serve` moves every snapshot to the moment it's sent. */
const MADE_AT = 1_000_000;

const EAST_HONOUR: GameProgress = { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: 1 };
const WEST_GOULASH: GameProgress = { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 };

function snapshot(state: HandState, version: number, deadlines: Deadlines, status: GameSnapshot['status'] = 'active'): GameSnapshot {
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
    view: viewFor(state, karachi, ME),
    status,
    now: MADE_AT,
  };
}

/** One request against the table, as the act route makes it. */
function act(state: HandState, deadlines: Deadlines, action: ClientAction, actor: Seat) {
  return step({ game: { state, deadlines }, ruleset: karachi, seats: SEATS, policy: POLICY, now: MADE_AT, action, actor });
}

/** A fresh hand with the bots played up to the first human decision, as dealing it does. */
function deal(seed: string, progress: GameProgress) {
  const state = settle(startHand(karachi, { seed, progress, dealer: 0 }), karachi, SEATS);
  return { state, deadlines: deadlinesFor(state, karachi, SEATS, POLICY, MADE_AT) };
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
  /** The table after her discard: Bilal's turn, so she has no Discard button. */
  readonly turnAfter: GameSnapshot;
  /** The same hand, finished, with the game over. */
  readonly finished: GameSnapshot;
  /** A West goulash: both humans still to pass three tiles. */
  readonly westSent: GameSnapshot;
  /** The same pass after Bilal's exchange: a newer version, nothing logged, Amna's exchange still open. */
  readonly westConflict: GameSnapshot;
  /** After Amna's exchange of `westTiles` too: the next pass. */
  readonly westLanded: GameSnapshot;
  /** The first three tiles in Amna's hand, the ones the tests pick in the exchange sheet. */
  readonly westTiles: readonly TileKind[];
}

function build(): Fixtures {
  const live = search('a turn that passes to Bilal and a hand that finishes', (seed) => {
    const t = deal(seed, EAST_HONOUR);
    const v = viewFor(t.state, karachi, ME);
    const tile = v.legal.discard?.[0];
    if (t.state.phase !== 'turn' || t.state.turn !== ME || tile === undefined) return null;
    const after = act(t.state, t.deadlines, { type: 'discard', seat: ME, tile }, ME);
    if (after.state.phase !== 'turn' || after.state.turn !== 1) return null;
    // Play the hand out, each human's move the one the server's bot would make for them.
    let s: { state: HandState; deadlines: Deadlines } = after;
    for (let i = 0; i < 400 && s.state.phase !== 'finished'; i++) {
      const seat = s.state.phase === 'turn' ? s.state.turn : ([0, 1] as const).find((x) => viewFor(s.state, karachi, x).legal.claims !== undefined);
      if (seat === undefined) return null;
      const move = analysisBot(viewFor(s.state, karachi, seat), karachi) ?? ({ type: 'pass', seat } as const);
      if (move.type === 'resolveClaims') return null;
      s = act(s.state, s.deadlines, move, seat);
    }
    if (s.state.phase !== 'finished') return null;
    return { t, after, end: s };
  });

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

  return {
    turn: snapshot(live.t.state, 5, live.t.deadlines),
    turnAfter: snapshot(live.after.state, 6, live.after.deadlines),
    finished: snapshot(live.end.state, 9, { claim: null, turn: null }, 'finished'),
    westSent: snapshot(west.w.state, 1, west.w.deadlines),
    westConflict: snapshot(west.conflict.state, 2, west.conflict.deadlines),
    westLanded: snapshot(west.landed.state, 3, west.landed.deadlines),
    westTiles: west.tiles,
  };
}

let built: Fixtures | null = null;

/** The fixtures, built once per worker. */
export function fixtures(): Fixtures {
  built ??= build();
  return built;
}

/** A snapshot as the server would send it now: its clock and deadlines moved to the moment of sending. */
export function serve(s: GameSnapshot): GameSnapshot {
  const now = Date.now();
  const shift = (d: number | null) => (d === null ? null : d - s.now + now);
  return { ...s, now, deadlines: { claim: shift(s.deadlines.claim), turn: shift(s.deadlines.turn) } };
}
