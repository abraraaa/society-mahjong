import { WINDS, buildTileSet, countKinds, isBonusTile, isSuitTile, numOf, sortTiles, suitOf, suitTile, type TileInstance, type TileKind, type Wind } from '../tiles';
import { createRng, shuffle } from '../rng';
import { SEATS, acrossFrom, leftOf, nextSeat, removeMany, removeOne, countOf, type Meld, type Seat } from '../hand';
import { matchPatterns, type MatchCtx, type PatternMatch } from '../patterns/index';
import type { GameProgress, HandSpec, Ruleset, WinInput } from '../ruleset';
import { IllegalAction, type Action, type ClaimOption, type ClaimResponse, type GameEvent, type HandState, type LegalActions, type PlayerState, type WallState } from './types';

export interface StartHandOptions {
  readonly seed: string;
  readonly progress: GameProgress;
  readonly dealer: Seat;
  readonly dealerStreak?: number;
}

type Players = HandState['players'];

function seatWind(seat: Seat, dealer: Seat): Wind {
  return WINDS[(seat - dealer + 4) % 4]!;
}

function withPlayer(players: Players, seat: Seat, patch: Partial<PlayerState>): Players {
  const next = players.map((p) => (p.seat === seat ? { ...p, ...patch } : p));
  return next as unknown as Players;
}

function emit(state: HandState, ev: Omit<GameEvent, 'seq'>): HandState {
  const seq = state.seq + 1;
  return { ...state, seq, events: [...state.events, { ...ev, seq }] };
}

function drawFrom(wall: WallState, from: 'live' | 'dead'): { tile: TileInstance; wall: WallState } | null {
  if (from === 'live') {
    const tile = wall.live[0];
    if (!tile) return null;
    return { tile, wall: { ...wall, live: wall.live.slice(1) } };
  }
  const tile = wall.dead[wall.dead.length - 1];
  if (!tile) return null;
  return { tile, wall: { ...wall, dead: wall.dead.slice(0, -1) } };
}

function ctxFor(state: HandState, seat: Seat): MatchCtx {
  return { seatWind: state.players[seat].seatWind, roundWind: state.progress.roundWind };
}

export function currentSpec(state: HandState, ruleset: Ruleset): HandSpec {
  return ruleset.handSpec(state.progress);
}

export interface PreplaySubstep {
  readonly count: number;
  readonly direction: 'right' | 'across' | 'left';
}

/** Preplay steps flattened so an exchange "right, across, left" becomes three sub-steps. */
export function preplaySubsteps(spec: HandSpec): PreplaySubstep[] {
  return (spec.preplay ?? []).flatMap((step) => step.order.map((direction) => ({ count: step.count, direction })));
}

export function evaluateWin(state: HandState, ruleset: Ruleset, seat: Seat, concealed: readonly TileKind[]): PatternMatch[] {
  const p = state.players[seat];
  return matchPatterns(currentSpec(state, ruleset).patterns, { concealed, melds: p.melds, bonus: p.bonus }, ctxFor(state, seat), ruleset.guards);
}

/** Draw for `seat` from the live wall, replacing bonus tiles from the dead wall. */
function drawForTurn(state: HandState, seat: Seat, source: 'live' | 'dead'): HandState {
  let s = state;
  let wall = s.wall;
  let from = source;
  for (;;) {
    const d = drawFrom(wall, from);
    if (!d) {
      return { ...emit({ ...s, wall }, { type: 'exhausted' }), phase: 'finished', result: { type: 'draw' }, drawn: null, turn: seat };
    }
    wall = d.wall;
    const kind = d.tile.kind;
    const p = s.players[seat];
    if (isBonusTile(kind)) {
      s = emit({ ...s, wall, players: withPlayer(s.players, seat, { bonus: [...p.bonus, kind] }) }, { type: 'bonus', seat, tile: kind });
      from = 'dead';
      continue;
    }
    const isLast = from === 'live' && wall.live.length === 0;
    s = {
      ...s,
      wall,
      players: withPlayer(s.players, seat, { concealed: sortTiles([...p.concealed, kind]) }),
      turn: seat,
      phase: 'turn',
      drawn: kind,
      drawnWasLastWallTile: isLast,
      afterKong: source === 'dead' ? true : false,
      lastDiscard: source === 'dead' ? s.lastDiscard : null,
      claims: {},
    };
    return emit(s, { type: from === 'dead' ? 'replacement' : 'drew', seat, tile: kind, secret: true });
  }
}

export function startHand(ruleset: Ruleset, opts: StartHandOptions): HandState {
  const rng = createRng(`${opts.seed}:${opts.progress.handIndex}`);
  const shuffled = shuffle(buildTileSet(ruleset.tiles), rng);
  const dead = shuffled.slice(shuffled.length - ruleset.deadWallSize);
  let wall: WallState = { live: shuffled.slice(0, shuffled.length - ruleset.deadWallSize), dead };
  const spec = ruleset.handSpec(opts.progress);
  const order: Seat[] = [opts.dealer, nextSeat(opts.dealer), acrossFrom(opts.dealer), leftOf(opts.dealer)];
  const hands: TileKind[][] = [[], [], [], []];
  for (let i = 0; i < ruleset.shape.handSize; i++) {
    for (const seat of order) {
      const d = drawFrom(wall, 'live');
      if (!d) throw new Error('wall too small to deal');
      wall = d.wall;
      hands[seat]!.push(d.tile.kind);
    }
  }
  const extra = drawFrom(wall, 'live');
  if (!extra) throw new Error('wall too small to deal');
  wall = extra.wall;
  hands[opts.dealer]!.push(extra.tile.kind);

  let players = SEATS.map((seat): PlayerState => ({
    seat,
    seatWind: seatWind(seat, opts.dealer),
    concealed: hands[seat]!,
    melds: [],
    bonus: [],
    discards: [],
    passed: [],
  })) as unknown as Players;

  let state: HandState = {
    rulesetId: ruleset.id,
    seed: opts.seed,
    progress: opts.progress,
    dealer: opts.dealer,
    dealerStreak: opts.dealerStreak ?? 0,
    handKind: spec.kind,
    phase: spec.preplay && spec.preplay.length > 0 ? 'preplay' : 'turn',
    preplayStep: 0,
    exchanges: {},
    wall,
    players,
    turn: opts.dealer,
    drawn: extra.tile.kind,
    drawnWasLastWallTile: false,
    lastDiscard: null,
    claims: {},
    afterKong: false,
    discardCount: 0,
    seq: 0,
    events: [],
    result: null,
  };
  state = emit(state, { type: 'handStarted', data: { dealer: opts.dealer, roundWind: opts.progress.roundWind, handKind: spec.kind, label: spec.label } });

  // replace bonus tiles in seat order starting with the dealer
  for (const seat of order) {
    for (;;) {
      const p = state.players[seat];
      const b = p.concealed.find(isBonusTile);
      if (!b) break;
      const d = drawFrom(state.wall, 'dead');
      if (!d) throw new Error('dead wall exhausted during deal');
      state = emit(
        {
          ...state,
          wall: d.wall,
          // the replacement may itself be a bonus tile; the loop replaces it on the next pass
          players: withPlayer(state.players, seat, { bonus: [...p.bonus, b], concealed: [...removeOne(p.concealed, b), d.tile.kind] }),
        },
        { type: 'bonus', seat, tile: b },
      );
    }
  }
  players = state.players.map((p) => ({ ...p, concealed: sortTiles(p.concealed) })) as unknown as Players;
  state = { ...state, players };
  if (state.players[opts.dealer].concealed.includes(state.drawn!) === false) state = { ...state, drawn: state.players[opts.dealer].concealed[state.players[opts.dealer].concealed.length - 1] ?? null };
  return state;
}

function claimsFor(state: HandState, ruleset: Ruleset, seat: Seat): ClaimOption[] {
  const ld = state.lastDiscard;
  if (!ld || ld.from === seat) return [];
  const p = state.players[seat];
  const k = ld.kind;
  if (ruleset.claims.passingRule && p.passed.includes(k)) return [];
  const out: ClaimOption[] = [];
  if (ruleset.claims.winFromDiscard && evaluateWin(state, ruleset, seat, [...p.concealed, k]).length > 0) out.push({ type: 'win' });
  const n = countOf(p.concealed, k);
  if (ruleset.claims.kongFromDiscard && n >= 3) out.push({ type: 'kong', tiles: [k, k, k] });
  if (ruleset.claims.pungFromDiscard && n >= 2) out.push({ type: 'pung', tiles: [k, k] });
  if (ruleset.claims.chowFromDiscard === 'left' && seat === nextSeat(ld.from) && isSuitTile(k)) {
    const s = suitOf(k);
    const num = numOf(k);
    const counts = countKinds(p.concealed);
    const hasN = (x: number) => x >= 1 && x <= 9 && (counts.get(suitTile(s, x)) ?? 0) > 0;
    for (const [a, b] of [[num - 2, num - 1], [num - 1, num + 1], [num + 1, num + 2]] as const) {
      if (hasN(a) && hasN(b)) out.push({ type: 'chow', tiles: [suitTile(s, a), suitTile(s, b)] });
    }
  }
  return out;
}

export function legalActions(state: HandState, ruleset: Ruleset, seat: Seat): LegalActions {
  if (state.phase === 'finished') return {};
  if (state.phase === 'preplay') {
    if (state.exchanges[seat]) return {};
    const step = preplaySubsteps(currentSpec(state, ruleset))[state.preplayStep];
    return step ? { exchange: { count: step.count } } : {};
  }
  if (state.phase === 'claim') {
    if (state.claims[seat] !== undefined || state.lastDiscard?.from === seat) return {};
    const claims = claimsFor(state, ruleset, seat);
    return { claims, pass: true };
  }
  if (state.turn !== seat) return {};
  const p = state.players[seat];
  const counts = countKinds(p.concealed);
  const kong: TileKind[] = [];
  for (const [k, n] of counts) {
    if (n === 4) kong.push(k);
    else if (n >= 1 && p.melds.some((m) => m.type === 'pung' && m.tiles[0] === k)) kong.push(k);
  }
  const win = state.drawn !== null && evaluateWin(state, ruleset, seat, p.concealed).length > 0;
  const out: LegalActions = { discard: [...counts.keys()], kong, win };
  return out;
}

function sameClaim(a: ClaimOption, b: ClaimOption): boolean {
  return a.type === b.type && (a.tiles ?? []).join() === (b.tiles ?? []).join();
}

function finishWin(state: HandState, ruleset: Ruleset, seat: Seat, concealed: readonly TileKind[], selfDrawn: boolean, discarder: Seat | undefined): HandState {
  const matches = evaluateWin(state, ruleset, seat, concealed);
  if (matches.length === 0) throw new IllegalAction('not a winning hand');
  const p = state.players[seat];
  const win: WinInput = {
    seat,
    dealer: state.dealer,
    hand: { concealed, melds: p.melds, bonus: p.bonus },
    matches,
    selfDrawn,
    ...(discarder === undefined ? {} : { discarder }),
    ctx: ctxFor(state, seat),
    bonus: p.bonus,
    wallRemaining: state.wall.live.length,
    handIndex: state.progress.handIndex,
    flags: {
      lastWallTile: selfDrawn && state.drawnWasLastWallTile,
      robbedKong: false,
      afterKong: selfDrawn && state.afterKong,
      firstDiscard: !selfDrawn && state.discardCount === 1 && discarder === state.dealer,
      heavenly: selfDrawn && state.discardCount === 0 && seat === state.dealer,
    },
  };
  const settlement = ruleset.score(win);
  const patternId = matches[0]!.pattern.id;
  let s: HandState = {
    ...state,
    players: withPlayer(state.players, seat, { concealed }),
    phase: 'finished',
    claims: {},
    result: { type: 'win', winner: seat, patternId, settlement, selfDrawn, ...(discarder === undefined ? {} : { discarder }) },
  };
  s = emit(s, { type: 'won', seat, tiles: concealed, data: { patternId, selfDrawn, discarder, total: settlement.total, unit: settlement.unit } });
  return s;
}

function resolve(state: HandState, ruleset: Ruleset): HandState {
  const ld = state.lastDiscard;
  if (!ld) throw new IllegalAction('nothing to resolve');
  const responses = SEATS.filter((s) => s !== ld.from).map((seat) => ({ seat, r: (state.claims[seat] ?? 'pass') as ClaimResponse }));
  // record passes for the passing rule
  let players = state.players;
  for (const { seat, r } of responses) {
    if (r === 'pass') players = withPlayer(players, seat, { passed: [...players[seat].passed, ld.kind] });
  }
  let s: HandState = { ...state, players, claims: {} };

  const winners = responses.filter((x) => x.r !== 'pass' && x.r.type === 'win').map((x) => x.seat);
  if (winners.length > 0) {
    // order from the discarder's right; multiple winners not yet settled jointly (TODO)
    const ordered = [nextSeat(ld.from), acrossFrom(ld.from), leftOf(ld.from)].filter((x) => winners.includes(x));
    const winner = ordered[0]!;
    const p = s.players[winner];
    const discarder = s.players[ld.from];
    s = { ...s, players: withPlayer(s.players, ld.from, { discards: discarder.discards.slice(0, -1) }) };
    return finishWin(s, ruleset, winner, sortTiles([...p.concealed, ld.kind]), false, ld.from);
  }
  const byType = (t: ClaimOption['type']) => responses.find((x) => x.r !== 'pass' && x.r.type === t);
  const chosen = byType('kong') ?? byType('pung') ?? byType('chow');
  if (!chosen || chosen.r === 'pass') {
    return drawForTurn({ ...s, lastDiscard: ld }, nextSeat(ld.from), 'live');
  }
  const claim = chosen.r;
  const seat = chosen.seat;
  const p = s.players[seat];
  const used = claim.tiles ?? [];
  const meld: Meld = { type: claim.type as Meld['type'], tiles: sortTiles([...used, ld.kind]), concealed: false, from: ld.from };
  const discarder = s.players[ld.from];
  s = {
    ...s,
    players: withPlayer(withPlayer(s.players, seat, { concealed: removeMany(p.concealed, used), melds: [...p.melds, meld] }), ld.from, {
      discards: discarder.discards.slice(0, -1),
    }),
    lastDiscard: null,
    turn: seat,
    phase: 'turn',
    drawn: null,
    afterKong: false,
  };
  s = emit(s, { type: 'claimed', seat, tile: ld.kind, tiles: meld.tiles, data: { claim: claim.type, from: ld.from } });
  if (claim.type === 'kong') return drawForTurn(s, seat, 'dead');
  return s;
}

export function reduce(state: HandState, action: Action, ruleset: Ruleset): HandState {
  if (state.phase === 'finished') throw new IllegalAction('hand is finished');
  switch (action.type) {
    case 'exchange': {
      if (state.phase !== 'preplay') throw new IllegalAction('not in preplay');
      const substeps = preplaySubsteps(currentSpec(state, ruleset));
      const step = substeps[state.preplayStep];
      if (!step) throw new IllegalAction('no exchange step');
      if (state.exchanges[action.seat]) throw new IllegalAction('already exchanged');
      if (action.tiles.length !== step.count) throw new IllegalAction(`exchange exactly ${step.count} tiles`);
      removeMany(state.players[action.seat].concealed, action.tiles); // validates ownership
      const exchanges = { ...state.exchanges, [action.seat]: action.tiles };
      let s: HandState = { ...state, exchanges };
      if (SEATS.some((seat) => !exchanges[seat])) return s;
      const dir = step.direction;
      const target = (seat: Seat): Seat => (dir === 'right' ? nextSeat(seat) : dir === 'across' ? acrossFrom(seat) : leftOf(seat));
      let players = s.players;
      for (const seat of SEATS) {
        const giving = exchanges[seat]!;
        const giver = SEATS.find((g) => target(g) === seat)!;
        const receiving = exchanges[giver]!;
        const p = players[seat];
        players = withPlayer(players, seat, { concealed: sortTiles([...removeMany(p.concealed, giving), ...receiving]) });
      }
      const nextStep = state.preplayStep + 1;
      const done = nextStep >= substeps.length;
      s = { ...s, players, exchanges: {}, preplayStep: nextStep, phase: done ? 'turn' : 'preplay' };
      return emit(s, { type: 'exchanged', data: { direction: dir, count: step.count } });
    }
    case 'discard': {
      if (state.phase !== 'turn' || state.turn !== action.seat) throw new IllegalAction('not your turn');
      const p = state.players[action.seat];
      const concealed = removeOne(p.concealed, action.tile);
      let s: HandState = {
        ...state,
        players: withPlayer(state.players, action.seat, { concealed, discards: [...p.discards, action.tile], passed: [] }),
        lastDiscard: { kind: action.tile, from: action.seat },
        drawn: null,
        afterKong: false,
        discardCount: state.discardCount + 1,
        claims: {},
        phase: 'claim',
      };
      s = emit(s, { type: 'discarded', seat: action.seat, tile: action.tile });
      const anyClaim = SEATS.some((seat) => seat !== action.seat && claimsFor(s, ruleset, seat).length > 0);
      if (!anyClaim) return resolve(s, ruleset);
      return s;
    }
    case 'claim':
    case 'pass': {
      if (state.phase !== 'claim') throw new IllegalAction('no discard to claim');
      if (state.lastDiscard?.from === action.seat) throw new IllegalAction('cannot claim your own discard');
      if (state.claims[action.seat] !== undefined) throw new IllegalAction('already responded');
      let response: ClaimResponse = 'pass';
      if (action.type === 'claim') {
        const legal = claimsFor(state, ruleset, action.seat);
        if (!legal.some((c) => sameClaim(c, action.claim))) throw new IllegalAction('illegal claim');
        response = action.claim;
      }
      const claims = { ...state.claims, [action.seat]: response };
      const s: HandState = { ...state, claims };
      const allIn = SEATS.filter((x) => x !== state.lastDiscard!.from).every((x) => claims[x] !== undefined);
      return allIn ? resolve(s, ruleset) : s;
    }
    case 'resolveClaims': {
      if (state.phase !== 'claim') throw new IllegalAction('no claims pending');
      return resolve(state, ruleset);
    }
    case 'declareKong': {
      if (state.phase !== 'turn' || state.turn !== action.seat) throw new IllegalAction('not your turn');
      const p = state.players[action.seat];
      const k = action.tile;
      const n = countOf(p.concealed, k);
      let s: HandState;
      if (n === 4) {
        const meld: Meld = { type: 'kong', tiles: [k, k, k, k], concealed: true };
        s = { ...state, players: withPlayer(state.players, action.seat, { concealed: removeMany(p.concealed, [k, k, k, k]), melds: [...p.melds, meld] }) };
        s = emit(s, { type: 'kong', seat: action.seat, tile: k, data: { concealed: true } });
      } else if (n >= 1 && p.melds.some((m) => m.type === 'pung' && m.tiles[0] === k)) {
        const melds = p.melds.map((m): Meld => (m.type === 'pung' && m.tiles[0] === k ? { ...m, type: 'kong', tiles: [k, k, k, k] } : m));
        s = { ...state, players: withPlayer(state.players, action.seat, { concealed: removeOne(p.concealed, k), melds }) };
        s = emit(s, { type: 'kong', seat: action.seat, tile: k, data: { concealed: false } });
        // TODO: robbing the kong (other players may win on this tile)
      } else throw new IllegalAction('no kong available');
      return drawForTurn(s, action.seat, 'dead');
    }
    case 'declareWin': {
      if (state.phase !== 'turn' || state.turn !== action.seat) throw new IllegalAction('not your turn');
      if (state.drawn === null) throw new IllegalAction('nothing drawn');
      return finishWin(state, ruleset, action.seat, state.players[action.seat].concealed, true, undefined);
    }
  }
}

/** Progress to the next hand, or null when the game is over. */
export function nextHand(state: HandState, ruleset: Ruleset): { progress: GameProgress; dealer: Seat; dealerStreak: number } | null {
  if (state.phase !== 'finished' || !state.result) throw new IllegalAction('hand not finished');
  const retained = state.result.type === 'win' && state.result.winner === state.dealer && ruleset.dealerRetainsOnWin;
  const p = state.progress;
  if (retained) {
    return { progress: { ...p, handIndex: p.handIndex + 1 }, dealer: state.dealer, dealerStreak: state.dealerStreak + 1 };
  }
  let handInRound = p.handInRound + 1;
  let roundIndex = p.roundIndex;
  if (handInRound >= ruleset.handsPerRound) {
    handInRound = 0;
    roundIndex += 1;
  }
  if (roundIndex >= ruleset.roundsPerGame) return null;
  return {
    progress: { roundWind: WINDS[roundIndex]!, roundIndex, handInRound, handIndex: p.handIndex + 1 },
    dealer: nextSeat(state.dealer),
    dealerStreak: 0,
  };
}

export const initialProgress: GameProgress = { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 };
