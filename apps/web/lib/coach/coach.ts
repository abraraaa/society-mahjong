import {
  analyseHand,
  countOf,
  handAfterClaim,
  handAfterKong,
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
  type Wind,
} from '@society/engine';
import { exchangeStep } from './exchange';
import { GLOSSARY } from './glossary';
import { goalFor, roundNote } from './goal';
import { exampleRef, handsThisRound, winnerRef, yoursRef } from './hand-card';
import { isTurnView, type PlanMark } from './plan-mark';
import { noteShapeOf, shapeOf, titleOf } from './shape';
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
  /**
   * Someone who has just taken this seat over in a hand under way, and hasn't moved since (`firstLookFor`,
   * first-look.ts). Until they do, the tutor gives them what the start of a hand gives: the round's aim, and the plan.
   */
  readonly firstLook?: boolean;
  /**
   * The plan the tutor is holding the player to (plan-mark.ts), after this view. On the turn view that tells a
   * switch (`switched.toldAt` is its seq), the bubble says what the tutor switched from, and why.
   */
  readonly mark?: PlanMark | null;
}

export function handOf(view: PrivatePlayerView): HandInput {
  return { concealed: view.concealed, melds: view.players[view.me].melds };
}

function ctxOf(view: PrivatePlayerView): MatchCtx {
  return { seatWind: view.players[view.me].seatWind, roundWind: view.progress.roundWind };
}

/**
 * The analysis the coach runs on. Separate so a component can memoise it by `seq`. `prefer` is the plan the
 * player is already on (`preferFor`, plan-mark.ts), kept in front of hands only as close, so the strip, the
 * tutor's words and its discards all stay with it.
 */
export function analyseFor(view: PrivatePlayerView, ruleset: Ruleset, prefer?: string): HandAnalysis {
  const spec = ruleset.handSpec(view.progress);
  return analyseHand(handOf(view), spec.patterns, ctxOf(view), ruleset.guards, { claims: ruleset.claims, ...(prefer ? { prefer } : {}) });
}

/**
 * Whether a hand of this pattern can hold a run: a set that may be a run (Any Damn Hand's "any set" included), or
 * a run of its own. Once a pung is laid face up, a hand that needs its runs may be out of reach, and only the
 * analysis of the hand after the claim knows.
 */
export function admitsRun(p: Pattern): boolean {
  return p.components.some((c) => (c.c === 'set' && (c.of === 'chow' || c.of === 'any')) || c.c === 'seq' || c.c === 'run' || c.c === 'mixedSeq' || c.c === 'mixedRun');
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
/** A claim as a noun, for the lines that say why not to make it. */
const CLAIM_NOUN: Readonly<Record<ClaimOption['type'], string>> = { pung: 'pung', kong: 'kong', chow: 'chow', win: 'claim' };

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
export type Part = CoachSegment | string;

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

export interface Reason {
  readonly full: readonly Part[];
  readonly short: readonly Part[];
}

const WIND_WORD: Readonly<Record<Wind, string>> = { E: 'East', S: 'South', W: 'West', N: 'North' };

/**
 * The goulash's honour rule for this seat, exactly (the engine's
 * karachi.goulashHonours guard): a hand with any wind or dragon pung needs two
 * points, one for each dragon pung, one for a pung of the round's wind and one
 * for a pung of the player's own wind. So where the two winds are the same,
 * that one pung is enough on its own.
 */
export function honourGateReason(ctx: MatchCtx): Reason {
  const round = WIND_WORD[ctx.roundWind];
  if (ctx.seatWind === ctx.roundWind) {
    const one = `${ctx.roundWind === 'E' ? 'an' : 'a'} ${round} pung`;
    return {
      full: [`winds and dragons only count with ${one} or two dragon pungs`],
      short: [`honours need ${one} or two dragon pungs`],
    };
  }
  const seat = WIND_WORD[ctx.seatWind];
  return {
    full: [`winds and dragons only count with two pungs among dragons, ${round} and ${seat}`],
    short: [`honours need two pungs among dragons, ${round} and ${seat}`],
  };
}

/**
 * Why this tile is the one to let go: the clause after the bold action, in a
 * full and a short form so a long hand name can't push the action out of the
 * bubble. The commonest reason rotates with the player's own discards, since
 * the same words every turn stop being read.
 */
function discardReason(analysis: HandAnalysis, goal: CoachGoal, target: CoachTarget | null, concealed: readonly TileKind[], tile: TileKind, r: number, ctx: MatchCtx): Reason {
  const same = (full: string): Reason => ({ full: [full], short: [full] });
  if (goal.honours === 'forbidden' && isHonourTile(tile)) return { full: ['no wind or dragon fits a hand this round'], short: ['this round has no use for it'] };
  const rating = analysis.ratings.find((x) => x.kind === tile);
  const serves = rating?.serves ?? [];
  if (goal.honours === 'gated' && isHonourTile(tile) && serves.length === 0) return honourGateReason(ctx);
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

/**
 * C2, the claim sheet's line for a claim worth making: how close it leaves the hand, and which hand (`hand`,
 * when there is one). With `endsRuns` (C2x), it also says the claim rules out every run hand, while that fits.
 * A kong's replacement tile is the first thing to go when the line runs long, and C2x never keeps it: with it,
 * the line is over the bubble's budget for almost every hand's name.
 */
export function claimLine(type: ClaimOption['type'], away: number, hand: Part | null, endsRuns: boolean): CoachSegment[] {
  const claim = (tail: string) => line(act(CLAIM_VERB[type]), ` it: you'll be ${tilesWord(Math.max(1, away))}`, ...(hand ? [' from ', hand] : []), tail);
  const plain = type === 'kong' ? [claim(', with a replacement tile to come.'), claim('.')] : [claim('.')];
  return fitting(endsRuns ? [claim(', but it rules out every run hand.'), ...plain] : plain);
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

/** The tile the Discard button offers when the player hasn't picked one: a discard tip's tile, or a kong tip's fallback. */
export function suggestedDiscard(action: CoachAction): TileKind | null {
  if (action.kind === 'discard') return action.tile;
  if (action.kind === 'kong') return action.discard;
  return null;
}

/**
 * The first kong on offer that leaves the hand no further from its nearest hand than it is now, or null: the
 * bots' own rule (bots/analysis.ts). Such a kong costs nothing and draws an extra tile. With no hand in reach,
 * nothing a kong does can cost it one.
 */
function freeKong(input: Pick<CoachInput, 'view' | 'ruleset' | 'analysis'>): TileKind | null {
  const { view, ruleset, analysis } = input;
  const spec = ruleset.handSpec(view.progress);
  const before = analysis.candidates[0]?.away ?? Number.POSITIVE_INFINITY;
  const awayAfter = (k: TileKind) =>
    analyseHand(handAfterKong(handOf(view), k), spec.patterns, ctxOf(view), ruleset.guards, { claims: ruleset.claims }).candidates[0]?.away ?? Number.POSITIVE_INFINITY;
  return view.legal.kong?.find((k) => awayAfter(k) <= before) ?? null;
}

/**
 * The kong the tutor advises on this view (K1), or null: the player's own turn, with no win, a kong on offer that
 * costs nothing, and not a first look, whose bubble is the round's aim (except for a regular, who has no aim bubble).
 */
export function kongTip(input: Pick<CoachInput, 'view' | 'ruleset' | 'analysis' | 'stage' | 'firstLook'>): TileKind | null {
  const { view } = input;
  if (view.phase !== 'turn' || view.turn !== view.me || view.legal.win || !view.legal.kong?.length) return null;
  if (input.firstLook && input.stage !== 'solid') return null;
  return freeKong(input);
}

/**
 * Whether the tutor's bubble on this view can tell a plan switch (plan-mark.ts): a turn view (`isTurnView`) whose
 * tip is a discard. A turn whose tip is a kong says K1 and nothing else, so a switch due then waits for the next
 * turn view, the replacement draw's if the player takes the kong. It waits no longer than that: if that view's tip is
 * a kong too (she turned it down, and it's still free), the switch line takes K1's place there. The hook passes this
 * to `nextPlanMark`.
 */
export function tellsSwitch(input: Pick<CoachInput, 'view' | 'ruleset' | 'analysis' | 'stage' | 'firstLook'>): boolean {
  return isTurnView(input.view) && kongTip(input) === null;
}

/** K2, after a discard's reason on a turn whose only kongs would set the hand back: the Kong button is there, so say why not. */
const KONG_SETS_BACK = " Don't press Kong: it would set your hand back.";

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

/**
 * The footnote for someone who has just taken a seat over: the tiles aren't
 * ones they chose, and the plan strip, which sits between the bubble and the
 * tiles, is where to look. The person has just tapped to take over from the
 * bot, so "the bot's" needs no name.
 */
export const FIRST_LOOK_NOTE: CoachTeach = {
  key: 'firstLook',
  place: 'note',
  label: 'taking over',
  text: "these were the bot's tiles; the row above them is the hand to aim for",
};

export function coachFor(input: CoachInput): CoachState {
  const state = adviceFor(input);
  // Through a first look, every view offers the take-over footnote first, for the first bubble to show: while there's
  // a plan, which is what the strip it points at shows. Not under a Mahjong: that row is a hand already complete, not
  // one to aim for.
  const first = input.firstLook && state.action.kind !== 'win' && state.target?.layout ? [FIRST_LOOK_NOTE] : [];
  // Wherever the tutor has something to say, a flower drawn since the player's last move can be explained under it.
  const flowers = state.say.length > 0 && flowerSinceMyLastMove(input.view) ? [FLOWERS_NOTE] : [];
  if (first.length === 0 && flowers.length === 0) return state;
  return { ...state, teach: [...first, ...state.teach, ...flowers] };
}

/** The round's aim, with the one thing beginners get wrong in it when there's room: the bubble at the start of a hand. */
function aimLine(goal: CoachGoal): CoachSegment[] {
  return fitting([goal.watchOut ? [seg(goal.aim), seg(` ${goal.watchOut}`)] : [seg(goal.aim)], [seg(goal.aim)]]);
}

function adviceFor(input: CoachInput): CoachState {
  const { view, ruleset, analysis, stage, names } = input;
  const firstLook = input.firstLook === true;
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
    planSwitch: null,
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
    const action: CoachAction = { kind: 'exchange', tiles: loose, step: exchangeStep(spec, view.preplayStep) };
    const n = countWord(count);
    const say = !target
      ? [seg(`I've lit up ${n} you can spare.`)]
      : spare
        ? line(`I've lit up ${n} you can spare: none of them helps `, named(target.hand), '.')
        : line(`I've lit up the ${n} doing the least for `, named(target.hand), '.');
    return { ...base, moment: 'exchange', action, say, reason: 'the exchange is a chance to shed dead tiles', highlight: loose };
  }
  // Passed, and waiting for the others: still the exchange, whose sheet stays up, so there's nothing to say under it.
  // The round's aim comes on the first bubble of play, as it does after any deal.
  if (view.phase === 'preplay') {
    return { ...base, moment: 'exchange', action: { kind: 'wait' }, say: [], reason: null, highlight: [] };
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
    // run pattern the round allows, and only the analysis knows that. Every hand
    // still reachable after it counts, not only the nearest few, so "no run hand
    // is left" is true when it's said.
    const baseAway = target?.away ?? Number.POSITIVE_INFINITY;
    const patternOf = (id: string) => spec.patterns.find((p) => p.id === id);
    const takesRuns = (c: PatternCandidate) => {
      const p = patternOf(c.patternId);
      return p ? admitsRun(p) : false;
    };
    let best: { option: ClaimOption; away: number; after: HandAnalysis } | null = null;
    for (const option of options) {
      const hand = handAfterClaim(handOf(view), option, discard.kind, discard.from);
      if (!hand) continue;
      const after = analyseHand(hand, spec.patterns, ctx, ruleset.guards, { claims: ruleset.claims, limit: Number.POSITIVE_INFINITY });
      const away = after.candidates[0]?.away ?? Number.POSITIVE_INFINITY;
      if (!best || away < best.away) best = { option, away, after };
    }
    // The player was building towards a hand with runs, among their nearest few, and after the claim no hand that
    // takes runs is left. In South, Any Damn Hand takes runs and takes a pung too, so a pung there never ends them.
    const endsRuns = !!best && analysis.candidates.slice(0, 3).some(takesRuns) && !best.after.candidates.some(takesRuns);
    if (best && best.away < baseAway) {
      // The hand as it would stand after the claim, with the claimed set laid face up.
      const leader = best.after.candidates[0];
      const hand = leader ? named(yoursRef(leader, spec.patterns, ruleset, ctx, 'ifClaimed')) : null;
      return {
        ...base,
        moment: 'claim',
        action: { kind: 'claim', option: best.option, tile: discard.kind },
        say: claimLine(best.option.type, best.away, hand, endsRuns),
        reason: 'the claim moves the hand closer than leaving it',
        highlight: [],
      };
    }
    // Why not, most telling first: a claim that leaves no hand at all, one that ends every run hand, then the run
    // this tile would have made, which can't be claimed.
    const noun = best ? CLAIM_NOUN[best.option.type] : 'claim';
    const noHand = !!best && best.after.candidates.length === 0;
    const runs = !noHand && !endsRuns && runNoteApplies(target, goal, spec.patterns, view.concealed, discard.kind);
    const say: CoachSegment[] = !target
      ? [seg("Nothing here's worth breaking your hand for. "), act('Pass'), seg('.')]
      : noHand
        ? line(`A ${noun} here would leave no winning hand you could still make. `, act('Pass'), '.')
        : endsRuns
          ? best!.away > baseAway
            ? line(`A ${noun} here would set you back and rule out every run hand. `, act('Pass'), '.')
            : line(`A ${noun} here gets you no closer and rules out every run hand. `, act('Pass'), '.')
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
  // for as long as the dealer took to throw. Someone who has just taken the
  // seat over hasn't played this hand either, whatever the bot did with it.
  const beforeMyFirst = firstLook || (myDiscardCount(view) === 0 && view.players[view.me].melds.length === 0);
  const firstTurn = myTurn && beforeMyFirst ? roundTeach('note') : [];

  if (myTurn && view.legal.win) {
    const ref = myWinRef(input, handOf(view), 'yours');
    // Someone who has just taken the seat over and can call Mahjong at once hears about the win, and nothing else: the
    // round's footnote would come under a line that doesn't give the aim, and marking it said would claim a line that
    // was never said, so it's left for a later hand.
    const teach = firstLook ? [] : firstTurn;
    return {
      ...base,
      moment: 'turn',
      action: { kind: 'win' },
      say: ref ? line("That's ", named(ref), ', complete. Call ', act('Mahjong!')) : [seg("That's a complete hand. Call "), act('Mahjong!')],
      reason: 'the hand is complete',
      highlight: [],
      teach,
    };
  }

  const discardTile = analysis.bestDiscard;
  // A first look's bubble is the round's aim, and a lit Kong button with nothing said about it would only puzzle; the
  // tile to let go is the tip there, as on any first look.
  const aimFirst = firstLook && !quiet;
  const kongs = myTurn && !aimFirst ? (view.legal.kong ?? []) : [];
  const kong = kongs.length > 0 ? kongTip(input) : null;
  const action: CoachAction = kong ? { kind: 'kong', tile: kong, discard: discardTile } : myTurn && discardTile ? { kind: 'discard', tile: discardTile } : { kind: 'wait' };
  const highlight = action.kind === 'discard' || action.kind === 'kong' ? [action.tile] : [];

  if (!myTurn) {
    if (beforeMyFirst && !quiet) {
      // Someone else is dealing: the goal gets the bubble, and a plan for a hand not yet played would say nothing. A
      // hand taken over is under way, so its plan stays.
      return { ...base, moment: 'handStart', plan: firstLook ? plan : null, action, say: aimLine(goal), reason: goal.watchOut, highlight, teach: roundTeach('said') };
    }
    return { ...base, moment: 'waiting', action, say: [], reason: null, highlight: [] };
  }

  const moment = beforeMyFirst ? 'handStart' : 'turn';
  if (aimFirst) {
    // Taken over on their own turn: the bubble is the round's aim, as it is on whichever view they see first, and the
    // tile to let go is still lit and offered on the Discard button. After that discard, the tutor says why as usual.
    const teach = [...roundTeach('said'), ...(target ? missedRun(view, target, goal, names) : [])];
    return { ...base, moment, action, say: aimLine(goal), reason: goal.watchOut, highlight, teach };
  }
  if (quiet) {
    return { ...base, moment, action, say: [], reason: null, highlight, teach: firstTurn };
  }
  if (action.kind === 'kong') {
    // K1: a kong that costs the hand nothing. Its button is lit, and the Discard button still offers a tile for
    // someone who'd rather not. The round, then a run tile gone past, as on any turn.
    const lead = act(`Kong ${tileName(action.tile)}`);
    const teach = [...firstTurn, ...(target ? missedRun(view, target, goal, names) : [])];
    const reason = 'a kong that costs the hand nothing draws an extra tile';
    // A switch that waited through her last turn, whose bubble was K1, is told here though the tip is a kong again:
    // K1 has had its turn, so the switch line takes its place, led by the kong.
    const planSwitch = target ? switchFor(input, spec, target) : null;
    if (target && planSwitch) {
      const say = switchLine(lead, target, planSwitch, goal, '', false);
      return { ...base, moment, action, say, reason, highlight, teach, planSwitch: { from: planSwitch.from, closerBy: planSwitch.closerBy } };
    }
    const say = line(lead, ': with four of a kind you draw an extra tile, and it costs your hand nothing.');
    return { ...base, moment, action, say, reason, highlight, teach };
  }
  if (!target) {
    return { ...base, moment, action, say: [], reason: null, highlight, teach: firstTurn };
  }
  // The round comes first, then a run tile that went past since the player last moved.
  const teach = [...firstTurn, ...missedRun(view, target, goal, names)];
  // Every kong on offer would set the hand back (a free one would be the tip), and its button is there all the same.
  const k2 = kongs.length > 0 ? [KONG_SETS_BACK] : [];

  if (action.kind !== 'discard') {
    return { ...base, moment, action, say: [seg("Every tile's pulling its weight. Pick the one you'd miss least.")], reason: null, highlight, teach };
  }
  const reason = discardReason(analysis, goal, target, view.concealed, action.tile, myDiscardCount(view), ctxOf(view));
  const lead = act(`Discard ${tileName(action.tile)}`);
  const progress = progressAfter(input, spec, target, action.tile);
  const planSwitch = switchFor(input, spec, target);
  if (planSwitch) {
    // The turn that tells a switch: which hand the tutor moved to, and why, in place of the discard's reason.
    const say = switchLine(lead, target, planSwitch, goal, progress, k2.length > 0);
    return {
      ...base,
      moment,
      action,
      say,
      reason: textOf(line(...reason.full)),
      highlight,
      teach,
      planSwitch: { from: planSwitch.from, closerBy: planSwitch.closerBy },
    };
  }
  const say = discardLine(action.tile, reason, progress, k2.length > 0);
  return { ...base, moment, action, say, reason: textOf(line(...reason.full)), highlight, teach };
}

/**
 * S1, S1t or S1g after `lead`, the first that fits of: why with `progress` (a discard's one-tile-to-go clause), why
 * alone, then S2 with and without `progress`. `lead` is the discard, or the kong when a switch that waited through a
 * kong turn meets another. With `warnKong`, each is tried with K2 first, before K2 itself is dropped, as after a
 * discard's reason.
 */
function switchLine(
  lead: CoachSegment,
  target: CoachTarget,
  planSwitch: { readonly from: CoachHandRef; readonly closerBy: number | null; readonly approximate: boolean },
  goal: CoachGoal,
  progress: string,
  warnKong: boolean,
): CoachSegment[] {
  const to = named(target.hand);
  const from = named(planSwitch.from);
  const approximate = target.approximate || planSwitch.approximate;
  const why: Part[] | null =
    planSwitch.closerBy === null
      ? [': ', from, " can't be made now"]
      : approximate
        ? null
        : planSwitch.closerBy > 0
          ? [`: it's ${planSwitch.closerBy === 1 ? 'a tile' : tilesWord(planSwitch.closerBy)} closer than `, from]
          : planSwitch.closerBy === 0 && goal.generalTitles.includes(target.title)
            ? [": it's as close as ", from, ', and easier']
            : null;
  const said = (...rest: Part[]) => line(lead, '. Switching to ', to, ...rest);
  const tails = progress ? [`.${progress}`, '.'] : ['.'];
  const attempts = [...(why ? tails.map((tail) => said(...why, tail)) : []), ...tails.map((tail) => said(tail))];
  return fitting(warnKong ? [...attempts.map((a) => line(...a, KONG_SETS_BACK)), ...attempts] : attempts);
}

/**
 * The discard tip's line, the first that fits of: the full reason with `progress` (the one-tile-to-go clause), then
 * the short reason with it, then the short reason alone. With `warnKong`, K2 goes after the first two of those, and
 * both are tried with it before K2 itself is dropped.
 */
export function discardLine(tile: TileKind, reason: Reason, progress: string, warnKong: boolean): CoachSegment[] {
  const lead = act(`Discard ${tileName(tile)}`);
  return fitting([
    ...(warnKong ? [line(lead, ': ', ...reason.full, `.${progress}`, KONG_SETS_BACK), line(lead, ': ', ...reason.short, `.${progress}`, KONG_SETS_BACK)] : []),
    line(lead, ': ', ...reason.full, `.${progress}`),
    line(lead, ': ', ...reason.short, `.${progress}`),
    line(lead, ': ', ...reason.short, '.'),
  ]);
}

/**
 * On the turn view that tells a plan switch (plan-mark.ts), the hand the tutor switched from and how much
 * closer the new plan is: its nearest candidate of that title, from this view's analysis, or from one over
 * every hand when the analysis's short list has none. None at all means it can't be made now (`closerBy`
 * null), and its card shows the example. Null on any other view.
 */
function switchFor(
  input: CoachInput,
  spec: ReturnType<Ruleset['handSpec']>,
  target: CoachTarget,
): { readonly from: CoachHandRef; readonly closerBy: number | null; readonly approximate: boolean } | null {
  const { view, ruleset, analysis, mark } = input;
  const switched = mark?.switched;
  if (!switched || switched.toldAt !== view.seq || mark.hand !== view.progress.handIndex || switched.fromTitle === target.title || !isTurnView(view)) return null;
  const ctx = ctxOf(view);
  const nearest = (candidates: readonly PatternCandidate[]) =>
    candidates.filter((c) => titleOf(c) === switched.fromTitle).reduce<PatternCandidate | undefined>((a, c) => (a && a.away <= c.away ? a : c), undefined);
  const old =
    nearest(analysis.candidates) ?? nearest(analyseHand(handOf(view), spec.patterns, ctx, ruleset.guards, { claims: ruleset.claims, limit: Number.POSITIVE_INFINITY }).candidates);
  if (old) return { from: yoursRef(old, spec.patterns, ruleset, ctx), closerBy: old.away - target.away, approximate: old.approximate };
  const pattern = spec.patterns.find((p) => p.id === switched.fromId) ?? spec.patterns.find((p) => titleOf(p) === switched.fromTitle);
  const from: CoachHandRef = (pattern && exampleRef(pattern, ruleset, ctx)) ?? {
    patternId: pattern?.id ?? switched.fromId,
    title: switched.fromTitle,
    shape: pattern ? shapeOf(pattern.id, spec.patterns) : '',
    whose: 'example',
    layout: [],
    note: noteShapeOf(switched.fromTitle, spec.patterns),
  };
  return { from, closerBy: null, approximate: false };
}

/** The tile that was just thrown, from the river, for the debrief. */
function lastDiscardName(view: PrivatePlayerView): string | null {
  const won = [...view.events].reverse().find((e) => e.type === 'discarded');
  return won?.tile ? tileName(won.tile) : null;
}
