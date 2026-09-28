import {
  analyseHand,
  handAfterClaim,
  isHonourTile,
  isSuitTile,
  matchPatterns,
  numOf,
  sortTiles,
  suitOf,
  suitTile,
  tileName,
  type ClaimOption,
  type HandAnalysis,
  type HandInput,
  type MatchCtx,
  type Pattern,
  type PatternCandidate,
  type PrivatePlayerView,
  type Ruleset,
  type Seat,
  type TileKind,
} from '@society/engine';
import { goalFor } from './goal';
import { handsThisRound, winnerRef, yoursRef } from './hand-card';
import { shapeOf, titleOf } from './shape';
import { SAY_BUDGET, countWord, isLoner, isolate, liveCopies, myDiscardCount, planCount, textOf, tilesWord, visibleLength, waitList } from './words';
import type { CoachAction, CoachGoal, CoachHandRef, CoachOutcome, CoachSegment, CoachStage, CoachState, CoachTarget } from './types';

/**
 * The coach: everything the tutor says about a hand, derived from the engine's
 * analysis of that hand against the round's own patterns.
 *
 * The old tutor was a single heuristic over a tile list — throw your lone winds —
 * which is exactly backwards in East and North, where five honours is the hand.
 * Nothing here knows a rule of its own: which hands are on the table comes from
 * `ruleset.handSpec`, how close each one is comes from `analyseHand`, and whether
 * a tile can be claimed comes from `ruleset.claims`. Where the analysis has
 * nothing solid to say, the coach says less rather than guessing.
 */

/** Beyond this many tiles away, the coach stops claiming the player is "building" anything. */
const SHAPING_AT = 5;
const CLOSE_AT = 2;
export interface CoachInput {
  readonly view: PrivatePlayerView;
  readonly ruleset: Ruleset;
  /** from `analyseFor`, hoisted out so the caller can memoise it across renders */
  readonly analysis: HandAnalysis;
  readonly stage: CoachStage;
  /** table-local display names, since the engine knows seats and not people */
  readonly names: Readonly<Record<Seat, string>>;
}

export function handOf(view: PrivatePlayerView): HandInput {
  return { concealed: view.concealed, melds: view.players[view.me].melds };
}

function ctxOf(view: PrivatePlayerView): MatchCtx {
  return { seatWind: view.players[view.me].seatWind, roundWind: view.progress.roundWind };
}

/** The analysis the coach runs on. Separate so a component can memoise it by `seq`. */
export function analyseFor(view: PrivatePlayerView, ruleset: Ruleset): HandAnalysis {
  const spec = ruleset.handSpec(view.progress);
  return analyseHand(handOf(view), spec.patterns, ctxOf(view), ruleset.guards, { claims: ruleset.claims });
}

function targetOf(candidate: PatternCandidate | undefined, patterns: readonly Pattern[], ruleset: Ruleset, ctx: MatchCtx): CoachTarget | null {
  if (!candidate) return null;
  return {
    patternId: candidate.patternId,
    title: titleOf(candidate),
    shape: shapeOf(candidate.patternId, patterns),
    away: candidate.away,
    approximate: candidate.approximate,
    confidence: candidate.away <= CLOSE_AT ? 'close' : candidate.away <= SHAPING_AT ? 'shaping' : 'searching',
    holding: candidate.usingConcealed,
    wantsFromDiscard: candidate.needsClaimable,
    wantsFromWall: candidate.needsFromWall,
    layout: candidate.layout,
    hand: yoursRef(candidate, patterns, ruleset, ctx),
  };
}

/** True when `kind` would finish a run with two tiles already in hand. */
function completesRun(concealed: readonly TileKind[], kind: TileKind): boolean {
  if (!isSuitTile(kind)) return false;
  const suit = suitOf(kind);
  const num = numOf(kind);
  const has = (n: number) => n >= 1 && n <= 9 && concealed.includes(suitTile(suit, n));
  return (has(num - 2) && has(num - 1)) || (has(num - 1) && has(num + 1)) || (has(num + 1) && has(num + 2));
}

/** Whether a pattern is built from same-suit runs: the only hands a run note can be about. */
function hasRunGroup(pattern: Pattern | undefined): boolean {
  return !!pattern?.components.some((c) => (c.c === 'set' && c.of === 'chow') || c.c === 'seq' || c.c === 'run');
}

/**
 * True when the discard is a tile the plan wants for a same-suit run, one it
 * would finish with two tiles already held, and this ruleset never lets a run
 * be claimed. All of that matters: a goulash has no runs at all, Khalida's and
 * Crazy Chows take their "runs" across the suits, and a single tile a pung is
 * two short of is wall-only for a different reason.
 */
export function runNoteApplies(
  target: CoachTarget | null,
  goal: Pick<CoachGoal, 'chowsClaimable'>,
  patterns: readonly Pattern[],
  concealed: readonly TileKind[],
  kind: TileKind,
): boolean {
  if (goal.chowsClaimable || !target || target.away < 2) return false;
  if (!hasRunGroup(patterns.find((p) => p.id === target.patternId))) return false;
  return target.wantsFromWall.includes(kind) && completesRun(concealed, kind);
}

const CLAIM_VERB: Readonly<Record<ClaimOption['type'], string>> = { pung: 'Pung', kong: 'Kong', chow: 'Chow', win: 'Mahjong!' };

function seg(text: string): CoachSegment {
  return { text };
}
function act(text: string): CoachSegment {
  return { text, action: true };
}
/** A hand's title, said so it can be tapped to see the hand. */
function named(ref: CoachHandRef): CoachSegment {
  return { text: ref.title, hand: ref };
}

/** A piece of a sentence: plain words, or a segment (the bold action, a hand's name). */
type Part = CoachSegment | string;

/** A sentence from its parts, neighbouring plain words joined into one segment so a glossary phrase is never split across two. */
function line(...parts: readonly Part[]): CoachSegment[] {
  const out: CoachSegment[] = [];
  for (const part of parts) {
    const s = typeof part === 'string' ? seg(part) : part;
    const last = out[out.length - 1];
    if (last && !last.action && !last.hand && !s.action && !s.hand) out[out.length - 1] = seg(last.text + s.text);
    else out.push(s);
  }
  return out;
}

/** A winning hand the player would hold, told as theirs rather than as someone's win. An example it fell back to stays an example. */
function asMine(ref: CoachHandRef, whose: 'yours' | 'ifClaimed'): CoachHandRef {
  if (ref.whose !== 'winner') return ref;
  return { patternId: ref.patternId, title: ref.title, shape: ref.shape, whose, away: 0, layout: ref.layout };
}

interface Reason {
  readonly full: readonly Part[];
  readonly short: readonly Part[];
}

/**
 * Why this tile is the one to let go: the clause after the bold action, in a
 * full and a short form so a long hand name can't push the action out of the
 * bubble. The commonest reason rotates with the player's own discards, since
 * the same words every turn stop being read.
 */
function discardReason(analysis: HandAnalysis, goal: CoachGoal, target: CoachTarget | null, concealed: readonly TileKind[], tile: TileKind, r: number): Reason {
  const same = (full: string): Reason => ({ full: [full], short: [full] });
  if (goal.honours === 'forbidden' && isHonourTile(tile)) return { full: ['no wind or dragon fits a hand this round'], short: ['this round has no use for it'] };
  const rating = analysis.ratings.find((x) => x.kind === tile);
  const serves = rating?.serves ?? [];
  if (goal.honours === 'gated' && isHonourTile(tile) && serves.length === 0) return same('winds and dragons are fussy here');
  const title = target ? named(target.hand) : null;
  if (serves.length === 0 && isLoner(concealed, tile))
    return isHonourTile(tile) ? same("it's on its own") : { full: ["it's on its own, with no neighbours"], short: ["it's on its own"] };
  if (serves.length === 0) {
    if (!title) return same('your hand has no use for it');
    const full = [
      [title, ' has no use for it'],
      ['nothing in ', title, ' needs it'],
      ['it does nothing for ', title],
    ][r % 3]!;
    return { full, short: ['your hand has no use for it'] };
  }
  const use = target ? target.holding.filter((k) => k === tile).length : 0;
  const held = rating?.held ?? 1;
  if (use >= 1) return held >= 3 && use === 2 && title ? { full: [title, ' only needs two of them'], short: ["you've got a spare"] } : same("you've got a spare");
  if (title && r % 2 === 0 && !serves.includes(target!.patternId)) return { full: [title, ' can do without it'], short: ['it does the least for your hand'] };
  return same('it does the least for your hand');
}

function planLine(target: CoachTarget | null): string | null {
  if (!target) return null;
  return `${target.title} · ${planCount(target.away, target.approximate)}`;
}

/**
 * At one tile to go, what would finish the hand, judged on the hand as it will
 * stand after this discard (the hand before it is a tile too long, and named
 * waits from it were wrong one time in eight). Only the plan's own hand counts,
 * and only tiles that might still turn up.
 */
function progressAfter(input: CoachInput, spec: ReturnType<Ruleset['handSpec']>, target: CoachTarget, tile: TileKind): string {
  if (target.away !== 1) return '';
  if (target.approximate) return ' One tile to go.';
  const { view, ruleset } = input;
  const rest = [...view.concealed];
  rest.splice(rest.indexOf(tile), 1);
  const after = analyseHand({ concealed: rest, melds: view.players[view.me].melds }, spec.patterns, ctxOf(view), ruleset.guards, {
    claims: ruleset.claims,
    limit: Number.POSITIVE_INFINITY,
  });
  const found = new Set<TileKind>();
  for (const c of after.candidates) if (c.away === 1 && !c.approximate && titleOf(c) === target.title) for (const k of c.needs) found.add(k);
  if (found.size === 0) return ' One tile to go.';
  const live = [...found].filter((k) => liveCopies(view, k) > 0);
  if (live.length === 0) return ' One tile to go, but every tile that finishes it is already out.';
  if (live.length > 3) return ' One tile to go, and plenty of tiles would finish it.';
  return ` One tile to go: you need ${waitList(live)}.`;
}

/** The pattern a complete hand will be announced under: the ruleset's own first match. */
function winningPattern(input: CoachInput, hand: HandInput): Pattern | null {
  const { view, ruleset } = input;
  const spec = ruleset.handSpec(view.progress);
  return matchPatterns(spec.patterns, hand, ctxOf(view), ruleset.guards)[0]?.pattern ?? null;
}

/** The player's own winning hand, laid out, as theirs now (`yours`) or once they take the tile (`ifClaimed`). */
function myWinRef(input: CoachInput, hand: HandInput, whose: 'yours' | 'ifClaimed'): CoachHandRef | null {
  const pattern = winningPattern(input, hand);
  return pattern ? asMine(winnerRef(hand, pattern, ctxOf(input.view), input.ruleset, 'You'), whose) : null;
}

function outcomeOf(input: CoachInput, target: CoachTarget | null, patterns: readonly Pattern[]): CoachOutcome | null {
  const { view, names, ruleset } = input;
  const result = view.result;
  if (!result) return null;
  if (result.type === 'draw') return { type: 'draw', ...(target ? { myTarget: target } : {}) };
  const pattern = patterns.find((p) => p.id === result.patternId);
  const tiles = view.revealed[result.winner];
  const melds = view.players[result.winner].melds;
  const meldTiles = melds.flatMap((m) => m.tiles);
  // The winner's own winds: the goulash's honour gate reads their seat wind, not the viewer's.
  const winnerCtx: MatchCtx = { seatWind: view.players[result.winner].seatWind, roundWind: view.progress.roundWind };
  const owner = result.winner === view.me ? 'You' : names[result.winner];
  return {
    type: 'win',
    winner: result.winner,
    winnerName: names[result.winner],
    winnerIsMe: result.winner === view.me,
    selfDrawn: result.selfDrawn,
    ...(pattern
      ? { hand: { title: titleOf(pattern), shape: shapeOf(pattern.id, patterns), ref: winnerRef({ concealed: tiles ?? [], melds }, pattern, winnerCtx, ruleset, owner) } }
      : {}),
    tiles: sortTiles([...meldTiles, ...(tiles ?? [])]),
    ...(target ? { myTarget: target } : {}),
  };
}

/** E2 and E3: who won, with what, and how the last tile came. `hand` is the hand's name, or words when there's no pattern to name. */
export function winnerLine(who: string, hand: Part, how: string): CoachSegment[] {
  return line(`${isolate(who)} wins with `, hand, `, ${how}.`);
}

/** How the winning tile came: off the wall (no tile), on the player's own discard (no discarder), or on someone else's. */
export function howWon(tile: string | null, discarder?: string): string {
  if (tile === null) return 'off the wall';
  return `on ${discarder === undefined ? 'your' : `${isolate(discarder)}'s`} ${tile}`;
}

/** E5, after the line that says how the hand ended: how close the player got. */
export function shortOfLine(away: number, hand: Part): Part[] {
  return [` You were ${tilesWord(away)} short of `, hand, '.'];
}

/** The first of `attempts` that fits the bubble, or the last one: the action is never cut, only the words after it. */
function fitting(attempts: readonly CoachSegment[][]): CoachSegment[] {
  return attempts.find((say) => visibleLength(textOf(say)) <= SAY_BUDGET) ?? attempts[attempts.length - 1]!;
}

export function coachFor(input: CoachInput): CoachState {
  const { view, ruleset, analysis, stage, names } = input;
  const spec = ruleset.handSpec(view.progress);
  const ctx = ctxOf(view);
  const goal: CoachGoal = { ...goalFor(spec, view.progress.roundWind, ruleset), hands: handsThisRound(spec, analysis, ruleset, ctx) };
  const target = targetOf(analysis.candidates[0], spec.patterns, ruleset, ctx);
  const runnerUp = targetOf(analysis.candidates[1], spec.patterns, ruleset, ctx);
  const plan = planLine(target);
  const quiet = stage === 'solid';

  const base = {
    stage,
    goal,
    target,
    runnerUp,
    plan,
    outcome: null,
  } as const;

  // --- hand end: the debrief, where a beginner learns most -------------------
  if (view.phase === 'finished') {
    const outcome = outcomeOf(input, target, spec.patterns);
    // How close the player got, when it fits after the line that says how the hand ended.
    const withShort = (ended: CoachSegment[]) => fitting(target && target.away > 0 ? [line(...ended, ...shortOfLine(target.away, named(target.hand))), ended] : [ended]);
    let say: CoachSegment[];
    let reason: string | null = null;
    if (outcome?.type === 'win' && outcome.winnerIsMe) {
      say = outcome.hand ? line("Mahjong! That's ", named(outcome.hand.ref), `: ${outcome.hand.shape}.`) : [seg("Mahjong! That's a complete hand.")];
      reason = 'you completed the hand';
    } else if (outcome?.type === 'win') {
      const result = view.result?.type === 'win' ? view.result : null;
      const discarder = result?.discarder;
      const how =
        outcome.selfDrawn || discarder === undefined || !result?.patternId
          ? howWon(null)
          : howWon(lastDiscardName(view) ?? 'discard', discarder === view.me ? undefined : names[discarder]);
      say = withShort(winnerLine(outcome.winnerName ?? 'Someone', outcome.hand ? named(outcome.hand.ref) : 'a complete hand', how));
      reason = 'the hand is over';
    } else {
      say = withShort(line("Washed out: the wall's run dry and nobody won. No points change hands."));
      reason = 'the wall ran dry';
    }
    return { ...base, moment: 'handEnd', action: { kind: 'wait' }, say, reason, highlight: [], outcome };
  }

  // --- the West exchange -----------------------------------------------------
  if (view.legal.exchange) {
    const count = view.legal.exchange.count;
    const spare = analysis.spare.length >= count;
    const loose = spare ? analysis.spare.slice(0, count) : analysis.ratings.slice(0, count).map((r) => r.kind);
    const action: CoachAction = { kind: 'exchange', tiles: loose };
    const n = countWord(count);
    const say = !target
      ? [seg(`I've lit up ${n} you can spare.`)]
      : spare
        ? line(`I've lit up ${n} you can spare: none of them helps `, named(target.hand), '.')
        : line(`I've lit up the ${n} doing the least for `, named(target.hand), '.');
    return { ...base, moment: 'exchange', action, say, reason: 'the exchange is a chance to shed dead tiles', highlight: loose };
  }

  // --- a claim window --------------------------------------------------------
  const discard = view.lastDiscard;
  if (view.phase === 'claim' && discard && view.legal.claims && view.legal.claims.length > 0) {
    const options = view.legal.claims;
    const win = options.find((o) => o.type === 'win');
    if (win) {
      const ref = myWinRef(input, { concealed: [...view.concealed, discard.kind], melds: view.players[view.me].melds }, 'ifClaimed');
      return {
        ...base,
        moment: 'claim',
        action: { kind: 'claim', option: win, tile: discard.kind },
        say: ref ? line(`That ${tileName(discard.kind)} finishes `, named(ref), '. Call ', act('Mahjong!')) : [seg('That tile completes your hand. Call '), act('Mahjong!')],
        reason: 'the discard is your winning tile',
        highlight: [],
      };
    }
    // The only honest answer to "does this help" is to re-analyse the hand as it
    // would stand after the claim: an exposed pung can shut this hand out of every
    // run pattern the round allows, and only the analysis knows that.
    const baseAway = target?.away ?? Number.POSITIVE_INFINITY;
    let best: { option: ClaimOption; away: number; after: HandAnalysis } | null = null;
    for (const option of options) {
      const hand = handAfterClaim(handOf(view), option, discard.kind, discard.from);
      if (!hand) continue;
      const after = analyseHand(hand, spec.patterns, ctx, ruleset.guards, { claims: ruleset.claims });
      const away = after.candidates[0]?.away ?? Number.POSITIVE_INFINITY;
      if (!best || away < best.away) best = { option, away, after };
    }
    if (best && best.away < baseAway) {
      // The hand as it would stand after the claim, with the claimed set laid face up.
      const leader = best.after.candidates[0];
      const from: Part[] = leader ? [' from ', named(yoursRef(leader, spec.patterns, ruleset, ctx, 'ifClaimed'))] : [];
      const tail = best.option.type === 'kong' ? ', with a replacement tile to come.' : '.';
      return {
        ...base,
        moment: 'claim',
        action: { kind: 'claim', option: best.option, tile: discard.kind },
        say: line(act(CLAIM_VERB[best.option.type]), ` it: you'll be ${tilesWord(Math.max(1, best.away))}`, ...from, tail),
        reason: 'the claim moves the hand closer than leaving it',
        highlight: [],
      };
    }
    const say: CoachSegment[] = !target
      ? [seg("Nothing here's worth breaking your hand for. "), act('Pass'), seg('.')]
      : runNoteApplies(target, goal, spec.patterns, view.concealed, discard.kind)
        ? line(named(target.hand), " wants that tile in a run, and you can't claim for a run here. ", act('Pass'), '.')
        : line('That does nothing for ', named(target.hand), '. ', act('Pass'), '.');
    return { ...base, moment: 'claim', action: { kind: 'pass', tile: discard.kind }, say, reason: 'no claim on this tile shortens the hand', highlight: [] };
  }

  // --- your turn -------------------------------------------------------------
  const myTurn = view.phase === 'turn' && view.turn === view.me;
  // The round's aim is for a hand nobody has played yet: until the player has
  // discarded once, not until anyone has, or three hands in four it flashed up
  // for as long as the dealer took to throw.
  const beforeMyFirst = myDiscardCount(view) === 0 && view.players[view.me].melds.length === 0;

  if (myTurn && view.legal.win) {
    const ref = myWinRef(input, handOf(view), 'yours');
    return {
      ...base,
      moment: 'turn',
      action: { kind: 'win' },
      say: ref ? line("That's ", named(ref), ', complete. Call ', act('Mahjong!')) : [seg("That's a complete hand. Call "), act('Mahjong!')],
      reason: 'the hand is complete',
      highlight: [],
    };
  }

  const discardTile = analysis.bestDiscard;
  const action: CoachAction = myTurn && discardTile ? { kind: 'discard', tile: discardTile } : { kind: 'wait' };
  const highlight = action.kind === 'discard' ? [action.tile] : [];

  if (!myTurn) {
    if (beforeMyFirst && !quiet) {
      // Someone else is dealing: the goal gets the bubble, and a plan for a hand not yet played would say nothing.
      const withWatch = goal.watchOut ? [seg(goal.aim), seg(` ${goal.watchOut}`)] : [seg(goal.aim)];
      return { ...base, moment: 'handStart', plan: null, action, say: fitting([withWatch, [seg(goal.aim)]]), reason: goal.watchOut, highlight };
    }
    return { ...base, moment: 'waiting', action, say: [], reason: null, highlight: [] };
  }

  const moment = beforeMyFirst ? 'handStart' : 'turn';
  if (quiet || !target) {
    return { ...base, moment, action, say: [], reason: null, highlight };
  }

  if (action.kind !== 'discard') {
    return { ...base, moment, action, say: [seg("Every tile's pulling its weight. Pick the one you'd miss least.")], reason: null, highlight };
  }
  const reason = discardReason(analysis, goal, target, view.concealed, action.tile, myDiscardCount(view));
  const lead = act(`Discard ${tileName(action.tile)}`);
  const progress = progressAfter(input, spec, target, action.tile);
  const say = fitting([line(lead, ': ', ...reason.full, `.${progress}`), line(lead, ': ', ...reason.short, `.${progress}`), line(lead, ': ', ...reason.short, '.')]);
  return { ...base, moment, action, say, reason: textOf(line(...reason.full)), highlight };
}

/** The tile that was just thrown, from the river, for the debrief. */
function lastDiscardName(view: PrivatePlayerView): string | null {
  const won = [...view.events].reverse().find((e) => e.type === 'discarded');
  return won?.tile ? tileName(won.tile) : null;
}
