import {
  analyseHand,
  countOf,
  handAfterClaim,
  isHonourTile,
  isSuitTile,
  matchPatterns,
  numOf,
  sortTiles,
  suitOf,
  tileName,
  type ClaimOption,
  type HandAnalysis,
  type HandInput,
  type LayoutGroup,
  type MatchCtx,
  type Pattern,
  type PatternCandidate,
  type PrivatePlayerView,
  type Ruleset,
  type Seat,
  type SuitTile,
  type TileKind,
} from '@society/engine';
import { GLOSSARY } from './glossary';
import { goalFor, roundNote } from './goal';
import { handsThisRound, winnerRef, yoursRef } from './hand-card';
import { shapeOf, titleOf } from './shape';
import {
  SAY_BUDGET,
  countWord,
  drawnSince,
  flowerSinceMyLastMove,
  isLoner,
  isolate,
  liveCopies,
  missedRunNote,
  myDiscardCount,
  passedSince,
  planCount,
  textOf,
  tilesWord,
  visibleLength,
  waitList,
} from './words';
import type { CoachAction, CoachGoal, CoachHandRef, CoachOutcome, CoachSegment, CoachStage, CoachState, CoachTarget, CoachTeach } from './types';

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

/**
 * Whether `kind` would have made this group of the plan's lay-out a run: it's
 * a run still to be laid down, one tile short. A run of three in one suit takes
 * either tile that finishes it with the two held (the lay-out follows one way
 * of making the hand, while the tiles wanted are every way's); any other run,
 * a long one or one across the suits, takes only the tile it's missing.
 */
function makesRun(group: LayoutGroup, kind: SuitTile): boolean {
  if (group.shape !== 'run' || group.exposed) return false;
  const missing = group.tiles.filter((t) => !t.held);
  if (missing.length !== 1) return false;
  const suited = group.tiles.map((t) => t.kind).filter(isSuitTile);
  const suit = suited.length > 0 ? suitOf(suited[0]!) : null;
  if (group.tiles.length === 3 && suited.length === 3 && suited.every((k) => suitOf(k) === suit)) {
    const held = group.tiles.flatMap((t) => (t.held && isSuitTile(t.kind) ? [numOf(t.kind)] : []));
    const [a = 0, b = 0, c = 0] = [...held, numOf(kind)].sort((x, y) => x - y);
    return suitOf(kind) === suit && b === a + 1 && c === b + 1;
  }
  return missing[0]!.kind === kind;
}

/**
 * A group of the plan's lay-out that `kind` would have made into a run, or
 * null. Only when runs can't be claimed, the plan is at least two tiles off
 * (at one tile to go it would be the winning tile, and a win can be claimed),
 * and the tile is one the plan wants from the wall. A goulash has no runs, and
 * Khalida's 1 to 9 is single tiles, so neither ever has one.
 */
export function runTileFor(target: CoachTarget | null, goal: Pick<CoachGoal, 'chowsClaimable'>, kind: TileKind): LayoutGroup | null {
  return runGroupsFor(target, goal, kind)[0] ?? null;
}

/** Every group `runTileFor` could name, in lay-out order. */
function runGroupsFor(target: CoachTarget | null, goal: Pick<CoachGoal, 'chowsClaimable'>, kind: TileKind): LayoutGroup[] {
  if (goal.chowsClaimable || !target || target.away < 2 || !isSuitTile(kind) || !target.wantsFromWall.includes(kind)) return [];
  return (target.layout ?? []).filter((g) => makesRun(g, kind));
}

/**
 * True when the discard is a tile the plan wants for a run, which this ruleset
 * never lets anyone claim: the claim sheet says so. The hand's patterns and
 * tiles are no longer read (the plan's lay-out says it all), and stay in the
 * signature for its callers.
 */
export function runNoteApplies(
  target: CoachTarget | null,
  goal: Pick<CoachGoal, 'chowsClaimable'>,
  _patterns: readonly Pattern[],
  _concealed: readonly TileKind[],
  kind: TileKind,
): boolean {
  return runTileFor(target, goal, kind) !== null;
}

/**
 * The newest run tile that went past since the player last moved, told on
 * their turn: who threw it, and why they couldn't take it. The run is judged
 * on the plan as it stands now, but only with tiles the player held when the
 * tile went by: every discard since their last move came before their draw,
 * and a run that the drawn tile has only just begun wasn't one the discard
 * would have finished. Copies of a tile can't be told apart, so a run's tile
 * counts as held then only if every copy of it the lay-out holds was: when the
 * draw brought a second copy, the one held then may have been sitting in
 * another set. Whether the visit's been taught it already is for `lessonFor`
 * to decide.
 */
function missedRun(view: PrivatePlayerView, target: CoachTarget, goal: CoachGoal, names: Readonly<Record<Seat, string>>): CoachTeach[] {
  // The concealed copies the lay-out holds, kind by kind: a set laid face up isn't in the hand.
  const inLayout = (target.layout ?? []).flatMap((g) => (g.exposed ? [] : g.tiles.filter((t) => t.held).map((t) => t.kind)));
  for (const passed of passedSince(view)) {
    const drawn = drawnSince(view, passed.seq);
    const heldThen = (kind: TileKind) => countOf(inLayout, kind) <= countOf(view.concealed, kind) - countOf(drawn, kind);
    const group = runGroupsFor(target, goal, passed.tile).find((g) => g.tiles.every((t) => !t.held || heldThen(t.kind)));
    if (group) return [{ key: 'rule:runs', place: 'note', text: missedRunNote(names[passed.seat], passed.tile, group) }];
  }
  return [];
}

/** The claim sheet's run line says the rule itself, so a footnote about a run tile going past would only say it again. */
const RUNS_SAID: CoachTeach = { key: 'rule:runs', place: 'said', text: 'runs only come from the wall' };

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
  return { patternId: ref.patternId, title: ref.title, shape: ref.shape, whose, away: 0, layout: ref.layout, note: ref.note };
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

/**
 * E4: the wall ran dry. `brief` keeps only the first sentence, so that E5 still
 * fits after it: with the whole line, E5 fits only for the shortest hand name at
 * one tile short. The sheet's heading and standings already show that nothing
 * changed hands.
 */
export function washoutLine(brief = false): CoachSegment[] {
  return line(`Washed out: the wall's run dry and nobody won.${brief ? '' : ' No points change hands.'}`);
}

/** The first of `attempts` that fits the bubble, or the last one: the action is never cut, only the words after it. */
function fitting(attempts: readonly CoachSegment[][]): CoachSegment[] {
  return attempts.find((say) => visibleLength(textOf(say)) <= SAY_BUDGET) ?? attempts[attempts.length - 1]!;
}

/**
 * The footnote for a flower drawn since the player last moved: what it is, and
 * why they drew again. The glossary's own footnote for "flowers" is these
 * words, so it's taught with it.
 */
const FLOWERS_NOTE: CoachTeach = { key: 'rule:flowers', place: 'note', label: 'flowers', text: GLOSSARY.bonus.short, also: ['term:bonus'] };

export function coachFor(input: CoachInput): CoachState {
  const state = adviceFor(input);
  // Wherever the tutor has something to say, a flower drawn since the player's last move can be explained under it.
  if (state.say.length === 0 || !flowerSinceMyLastMove(input.view)) return state;
  return { ...state, teach: [...state.teach, FLOWERS_NOTE] };
}

function adviceFor(input: CoachInput): CoachState {
  const { view, ruleset, analysis, stage, names } = input;
  const spec = ruleset.handSpec(view.progress);
  const ctx = ctxOf(view);
  const goal: CoachGoal = { ...goalFor(spec, view.progress.roundWind, ruleset), hands: handsThisRound(spec, analysis, ruleset, ctx) };
  const target = targetOf(analysis.candidates[0], spec.patterns, ruleset, ctx);
  const runnerUp = targetOf(analysis.candidates[1], spec.patterns, ruleset, ctx);
  const plan = planLine(target);
  const quiet = stage === 'solid';
  // The round's footnote: a note on the player's first turn of the hand, or said on the bubble that gives the aim
  // while someone else deals. It says what the round's everyday hand is, so that hand's own footnote goes with it.
  const round = roundNote(spec.kind);
  const roundTeach = (place: CoachTeach['place']): CoachTeach[] =>
    round ? [{ key: `round:${spec.kind}`, place, label: round.label, text: round.text, also: goal.generalTitles.map((t) => `hand:${t}`) }] : [];

  const base = {
    stage,
    goal,
    target,
    runnerUp,
    plan,
    outcome: null,
    teach: [] as readonly CoachTeach[],
    at: { hand: view.progress.handIndex, seq: view.seq },
  } as const;

  // --- hand end: the debrief, where a beginner learns most -------------------
  if (view.phase === 'finished') {
    const outcome = outcomeOf(input, target, spec.patterns);
    // How close the player got, after the line that says how the hand ended: its full words when they
    // leave room, then its shorter ones, and only when neither fits, the full words alone.
    const withShort = (ended: CoachSegment[], ...shorter: CoachSegment[][]) =>
      fitting(target && target.away > 0 ? [...[ended, ...shorter].map((words) => line(...words, ...shortOfLine(target.away, named(target.hand)))), ended] : [ended]);
    let say: CoachSegment[];
    let reason: string | null = null;
    let teach: readonly CoachTeach[] = [];
    if (outcome?.type === 'win' && outcome.winnerIsMe) {
      say = outcome.hand ? line("Mahjong! That's ", named(outcome.hand.ref), `: ${outcome.hand.shape}.`) : [seg("Mahjong! That's a complete hand.")];
      reason = 'you completed the hand';
      // E1 says the hand's shape itself, so its footnote would only say it again.
      if (outcome.hand) teach = [{ key: `hand:${outcome.hand.title}`, place: 'said', hand: outcome.hand.ref, text: outcome.hand.ref.note }];
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
      say = withShort(washoutLine(), washoutLine(true));
      reason = 'the wall ran dry';
    }
    return { ...base, moment: 'handEnd', action: { kind: 'wait' }, say, reason, highlight: [], outcome, teach };
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
    const runs = runNoteApplies(target, goal, spec.patterns, view.concealed, discard.kind);
    const say: CoachSegment[] = !target
      ? [seg("Nothing here's worth breaking your hand for. "), act('Pass'), seg('.')]
      : runs
        ? line(named(target.hand), " wants that tile in a run, and you can't claim for a run here. ", act('Pass'), '.')
        : line('That does nothing for ', named(target.hand), '. ', act('Pass'), '.');
    const teach = runs ? [RUNS_SAID] : [];
    return { ...base, moment: 'claim', action: { kind: 'pass', tile: discard.kind }, say, reason: 'no claim on this tile shortens the hand', highlight: [], teach };
  }

  // --- your turn -------------------------------------------------------------
  const myTurn = view.phase === 'turn' && view.turn === view.me;
  // The round's aim is for a hand nobody has played yet: until the player has
  // discarded once, not until anyone has, or three hands in four it flashed up
  // for as long as the dealer took to throw.
  const beforeMyFirst = myDiscardCount(view) === 0 && view.players[view.me].melds.length === 0;
  const firstTurn = myTurn && beforeMyFirst ? roundTeach('note') : [];

  if (myTurn && view.legal.win) {
    const ref = myWinRef(input, handOf(view), 'yours');
    return {
      ...base,
      moment: 'turn',
      action: { kind: 'win' },
      say: ref ? line("That's ", named(ref), ', complete. Call ', act('Mahjong!')) : [seg("That's a complete hand. Call "), act('Mahjong!')],
      reason: 'the hand is complete',
      highlight: [],
      teach: firstTurn,
    };
  }

  const discardTile = analysis.bestDiscard;
  const action: CoachAction = myTurn && discardTile ? { kind: 'discard', tile: discardTile } : { kind: 'wait' };
  const highlight = action.kind === 'discard' ? [action.tile] : [];

  if (!myTurn) {
    if (beforeMyFirst && !quiet) {
      // Someone else is dealing: the goal gets the bubble, and a plan for a hand not yet played would say nothing.
      const withWatch = goal.watchOut ? [seg(goal.aim), seg(` ${goal.watchOut}`)] : [seg(goal.aim)];
      return { ...base, moment: 'handStart', plan: null, action, say: fitting([withWatch, [seg(goal.aim)]]), reason: goal.watchOut, highlight, teach: roundTeach('said') };
    }
    return { ...base, moment: 'waiting', action, say: [], reason: null, highlight: [] };
  }

  const moment = beforeMyFirst ? 'handStart' : 'turn';
  if (quiet || !target) {
    return { ...base, moment, action, say: [], reason: null, highlight, teach: firstTurn };
  }
  // The round comes first, then a run tile that went past since the player last moved.
  const teach = [...firstTurn, ...missedRun(view, target, goal, names)];

  if (action.kind !== 'discard') {
    return { ...base, moment, action, say: [seg("Every tile's pulling its weight. Pick the one you'd miss least.")], reason: null, highlight, teach };
  }
  const reason = discardReason(analysis, goal, target, view.concealed, action.tile, myDiscardCount(view));
  const lead = act(`Discard ${tileName(action.tile)}`);
  const progress = progressAfter(input, spec, target, action.tile);
  const say = fitting([line(lead, ': ', ...reason.full, `.${progress}`), line(lead, ': ', ...reason.short, `.${progress}`), line(lead, ': ', ...reason.short, '.')]);
  return { ...base, moment, action, say, reason: textOf(line(...reason.full)), highlight, teach };
}

/** The tile that was just thrown, from the river, for the debrief. */
function lastDiscardName(view: PrivatePlayerView): string | null {
  const won = [...view.events].reverse().find((e) => e.type === 'discarded');
  return won?.tile ? tileName(won.tile) : null;
}
