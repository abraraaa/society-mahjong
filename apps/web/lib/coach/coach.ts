import {
  analyseHand,
  isHonourTile,
  isSuitTile,
  numOf,
  sortTiles,
  suitOf,
  suitTile,
  tileName,
  type ClaimOption,
  type HandAnalysis,
  type HandInput,
  type MatchCtx,
  type Meld,
  type Pattern,
  type PatternCandidate,
  type PrivatePlayerView,
  type Ruleset,
  type Seat,
  type TileKind,
} from '@society/engine';
import { goalFor } from './goal';
import { shapeOf, titleOf } from './shape';
import type { CoachAction, CoachGoal, CoachOutcome, CoachSegment, CoachStage, CoachState, CoachTarget } from './types';

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
/** Naming more waits than this is a list, not advice. */
const MAX_NAMED_NEEDS = 3;

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

function targetOf(candidate: PatternCandidate | undefined, patterns: readonly Pattern[]): CoachTarget | null {
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
  };
}

function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

function nameList(kinds: readonly TileKind[]): string | null {
  if (kinds.length === 0 || kinds.length > MAX_NAMED_NEEDS) return null;
  return andList(sortTiles(kinds).map(tileName));
}

/** True when `kind` would finish a run with two tiles already in hand. */
function completesRun(concealed: readonly TileKind[], kind: TileKind): boolean {
  if (!isSuitTile(kind)) return false;
  const suit = suitOf(kind);
  const num = numOf(kind);
  const has = (n: number) => n >= 1 && n <= 9 && concealed.includes(suitTile(suit, n));
  return (has(num - 2) && has(num - 1)) || (has(num - 1) && has(num + 1)) || (has(num + 1) && has(num + 2));
}

/** The hand as it would stand after taking this discard, for a like-for-like re-analysis. */
function afterClaim(view: PrivatePlayerView, option: ClaimOption, kind: TileKind, from: Seat): HandInput | null {
  if (option.type === 'win') return null;
  const taken = option.tiles ?? [];
  const concealed = [...view.concealed];
  for (const t of taken) {
    const i = concealed.indexOf(t);
    if (i < 0) return null;
    concealed.splice(i, 1);
  }
  const meld: Meld = { type: option.type, tiles: [...taken, kind], concealed: false, from };
  return { concealed, melds: [...view.players[view.me].melds, meld] };
}

const CLAIM_VERB: Readonly<Record<ClaimOption['type'], string>> = { pung: 'Pung it', kong: 'Kong it', chow: 'Chow it', win: 'Take it' };

function seg(text: string): CoachSegment {
  return { text };
}
function act(text: string): CoachSegment {
  return { text, action: true };
}

/** Why this tile is the one to let go — the clause after the bold action. */
function discardReason(analysis: HandAnalysis, goal: CoachGoal, tile: TileKind): string {
  if (goal.honours === 'forbidden' && isHonourTile(tile)) return 'no honour fits a hand this round';
  const rating = analysis.ratings.find((r) => r.kind === tile);
  if (rating && rating.serves.length === 0) return 'no hand of yours wants it';
  if (rating && rating.held > 1) return 'you have a spare';
  return 'it is your loosest tile';
}

function planLine(target: CoachTarget | null): string | null {
  if (!target) return null;
  const away = target.away === 0 ? 'complete' : `${target.approximate ? 'about ' : ''}${target.away} away`;
  return `${target.title} · ${away}`;
}

/**
 * Where the hand stands, said after the action rather than before it: the bubble
 * is clamped to three lines, so the sentence that can afford to be cut goes last.
 */
function progressClause(target: CoachTarget, verbose: boolean): string {
  const off = target.away === 1 ? `One tile from ${target.title}` : `${target.away} away from ${target.title}`;
  if (target.confidence === 'searching') return `Nothing has shape yet; ${target.title} is nearest, ${target.away} away.`;
  if (target.confidence === 'close') {
    // A named wait beats a description of the hand: it is the thing to watch for.
    const needs = nameList([...target.wantsFromDiscard, ...target.wantsFromWall]);
    if (needs) return `${off}, waiting on ${needs}.`;
  }
  return `${off}${verbose ? ` — ${target.shape}` : ''}.`;
}

function outcomeOf(input: CoachInput, target: CoachTarget | null, patterns: readonly Pattern[]): CoachOutcome | null {
  const { view, names } = input;
  const result = view.result;
  if (!result) return null;
  if (result.type === 'draw') return { type: 'draw', ...(target ? { myTarget: target } : {}) };
  const pattern = patterns.find((p) => p.id === result.patternId);
  const tiles = view.revealed[result.winner];
  const meldTiles = view.players[result.winner].melds.flatMap((m) => m.tiles);
  return {
    type: 'win',
    winner: result.winner,
    winnerName: names[result.winner],
    winnerIsMe: result.winner === view.me,
    selfDrawn: result.selfDrawn,
    ...(pattern ? { hand: { title: titleOf(pattern), shape: shapeOf(pattern.id, patterns) } } : {}),
    tiles: sortTiles([...meldTiles, ...(tiles ?? [])]),
    ...(target ? { myTarget: target } : {}),
  };
}

export function coachFor(input: CoachInput): CoachState {
  const { view, ruleset, analysis, stage } = input;
  const spec = ruleset.handSpec(view.progress);
  const goal = goalFor(spec, view.progress.roundWind, ruleset);
  const target = targetOf(analysis.candidates[0], spec.patterns);
  const runnerUp = targetOf(analysis.candidates[1], spec.patterns);
  const plan = planLine(target);
  const verbose = stage === 'new' || stage === 'first_hand';
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
    const say: CoachSegment[] = [];
    let reason: string | null = null;
    if (outcome?.type === 'win' && outcome.winnerIsMe) {
      say.push(seg(`Mahjong. That is ${outcome.hand?.title ?? 'a hand'}${outcome.hand ? ` — ${outcome.hand.shape}` : ''}.`));
      reason = 'you completed the hand';
    } else if (outcome?.type === 'win') {
      const how = outcome.selfDrawn ? 'off the wall' : 'off a discard';
      say.push(seg(`${outcome.winnerName} takes it ${how} with ${outcome.hand?.title ?? 'a legal hand'}${outcome.hand ? `: ${outcome.hand.shape}` : ''}.`));
      if (target) say.push(seg(` You finished ${target.away} off ${target.title}.`));
      reason = 'the hand is over';
    } else {
      say.push(seg('Wall out, nobody home.'));
      if (target) say.push(seg(` You finished ${target.away} off ${target.title}.`));
      reason = 'the wall ran dry';
    }
    return { ...base, moment: 'handEnd', action: { kind: 'wait' }, say, reason, highlight: [], outcome };
  }

  // --- the West exchange -----------------------------------------------------
  if (view.legal.exchange) {
    const count = view.legal.exchange.count;
    const loose = analysis.spare.length >= count ? analysis.spare.slice(0, count) : analysis.ratings.slice(0, count).map((r) => r.kind);
    const action: CoachAction = { kind: 'exchange', tiles: loose };
    const say: CoachSegment[] = [act('Pass the glowing ones'), seg(` — no pung of yours is using them. ${goal.aim}`)];
    return { ...base, moment: 'exchange', action, say, reason: 'the exchange is a chance to shed dead tiles', highlight: loose };
  }

  // --- a claim window --------------------------------------------------------
  const discard = view.lastDiscard;
  if (view.phase === 'claim' && discard && view.legal.claims && view.legal.claims.length > 0) {
    const options = view.legal.claims;
    const win = options.find((o) => o.type === 'win');
    if (win) {
      return {
        ...base,
        moment: 'claim',
        action: { kind: 'claim', option: win, tile: discard.kind },
        say: [seg('That completes your hand. '), act('Take it'), seg('.')],
        reason: 'the discard is your winning tile',
        highlight: [],
      };
    }
    // The only honest answer to "does this help" is to re-analyse the hand as it
    // would stand after the claim: an exposed pung can shut this hand out of every
    // chow pattern the round allows, and only the analysis knows that.
    const baseAway = target?.away ?? Number.POSITIVE_INFINITY;
    let best: { option: ClaimOption; away: number; leader: CoachTarget | null } | null = null;
    for (const option of options) {
      const hand = afterClaim(view, option, discard.kind, discard.from);
      if (!hand) continue;
      const after = analyseHand(hand, spec.patterns, ctxOf(view), ruleset.guards, { claims: ruleset.claims });
      const away = after.candidates[0]?.away ?? Number.POSITIVE_INFINITY;
      if (!best || away < best.away) best = { option, away, leader: targetOf(after.candidates[0], spec.patterns) };
    }
    if (best && best.away < baseAway) {
      const towards = best.leader ? ` from ${best.leader.title}` : '';
      return {
        ...base,
        moment: 'claim',
        action: { kind: 'claim', option: best.option, tile: discard.kind },
        say: [act(CLAIM_VERB[best.option.type]), seg(` — that leaves you ${best.away} away${towards}.`)],
        reason: 'the claim moves the hand closer than leaving it',
        highlight: [],
      };
    }
    const runNote = !goal.chowsClaimable && completesRun(view.concealed, discard.kind) ? ' A run never comes off the table here, so that one has to be drawn.' : '';
    return {
      ...base,
      moment: 'claim',
      action: { kind: 'pass', tile: discard.kind },
      say: [seg(target ? `Claiming that does nothing for ${target.title}.${runNote} ` : `Nothing here is worth breaking your hand for.${runNote} `), act('Pass'), seg('.')],
      reason: 'no claim on this tile shortens the hand',
      highlight: [],
    };
  }

  // --- your turn -------------------------------------------------------------
  const myTurn = view.phase === 'turn' && view.turn === view.me;
  const handStart = view.discardCount === 0 && view.players[view.me].melds.length === 0;

  if (myTurn && view.legal.win) {
    return {
      ...base,
      moment: 'turn',
      action: { kind: 'win' },
      say: [act('Declare mahjong'), seg(target ? ` — that is ${target.title}.` : '.')],
      reason: 'the hand is complete',
      highlight: [],
    };
  }

  const discardTile = analysis.bestDiscard;
  const action: CoachAction = myTurn && discardTile ? { kind: 'discard', tile: discardTile } : { kind: 'wait' };
  const highlight = action.kind === 'discard' ? [action.tile] : [];

  if (handStart) {
    const say: CoachSegment[] = quiet ? [] : [seg(goal.aim)];
    if (verbose && goal.watchOut) say.push(seg(` ${goal.watchOut}`));
    // No plan line here: a hand nobody has played yet has no plan worth reporting,
    // and dropping it hands the goal all three lines of the bubble.
    return { ...base, moment: 'handStart', plan: quiet ? plan : null, action, say, reason: goal.watchOut, highlight };
  }

  if (!myTurn) {
    // Waiting is where the chow rule bites: the tile you wanted goes past and no
    // window opens, because in this ruleset it never can.
    if (verbose && view.phase === 'claim' && discard && !goal.chowsClaimable && completesRun(view.concealed, discard.kind)) {
      return {
        ...base,
        moment: 'waiting',
        action: { kind: 'wait' },
        say: [seg(`That ${tileName(discard.kind)} would have finished a run — but runs are never claimed here, so you can only draw it.`)],
        reason: 'chows cannot be claimed in this ruleset',
        highlight: [],
      };
    }
    return { ...base, moment: 'waiting', action, say: [], reason: null, highlight: [] };
  }

  if (quiet || !target) {
    return { ...base, moment: 'turn', action, say: [], reason: null, highlight };
  }

  if (action.kind !== 'discard') {
    return { ...base, moment: 'turn', action, say: [seg('Every tile here is doing a job — take your pick.')], reason: null, highlight };
  }
  const reason = discardReason(analysis, goal, action.tile);
  const say: CoachSegment[] = [act(`Discard ${tileName(action.tile)}`), seg(` — ${reason}. ${progressClause(target, verbose)}`)];
  return { ...base, moment: 'turn', action, say, reason, highlight };
}
