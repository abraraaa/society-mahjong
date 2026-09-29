/** Coach regressions: `pnpm --filter @society/web test`. */
import { describe, expect, it } from 'vitest';
import {
  ALL_TILE_KINDS,
  ROUND_WINDS,
  analysisBot,
  countOf,
  isDragonTile,
  isHonourTile,
  isWindTile,
  karachi,
  reduce,
  startHand,
  tileName,
  viewFor,
  type GameProgress,
  type HandState,
  type PrivatePlayerView,
  type TileKind,
  type Wind,
} from '@society/engine';
import {
  admitsRun,
  analyseFor,
  claimLine,
  coachFor,
  discardLine,
  HONOUR_GATE_NOTE,
  kongTip,
  runNoteApplies,
  runTileFor,
  shortOfLine,
  suggestedDiscard,
  tellsSwitch,
  washoutLine,
  type Reason,
} from './coach';
import { GLOSSARY } from './glossary';
import { goalFor } from './goal';
import { hasWrittenShape, titleOf } from './shape';
import { stripGroups } from './strip';
import { firstLookFor } from './first-look';
import { NOTE_BUDGET, createLessons, createTaughtStore, lessonFor, lineKey, noteText } from './teach';
import { NAMES as LONG_NAMES, ROUNDS, coachOf, playHand, stickyCoach } from './test-games';
import { nextPlanMark, type PlanMark } from './plan-mark';
import type { CoachSegment, CoachState } from './types';
import { SAY_BUDGET, isolate, myDiscardCount, textOf, visibleLength } from './words';

const progressFor = (roundWind: Wind, handInRound: number): GameProgress => ({
  roundWind,
  roundIndex: ROUND_WINDS.indexOf(roundWind),
  handInRound,
  handIndex: 0,
});

/**
 * The heuristic the coach replaced: find an honour held exactly once, tell the
 * player to bin it. Kept here as the thing every case below has to beat.
 */
function oldTutorPick(hand: readonly TileKind[]): TileKind | undefined {
  return hand.find((k) => (isWindTile(k) || isDragonTile(k)) && countOf(hand, k) === 1);
}

/** Enough of a seat's view for the coach; the parts it never reads are left out. */
function turnView(round: Wind, handInRound: number, tiles: readonly TileKind[]): PrivatePlayerView {
  return {
    progress: progressFor(round, handInRound),
    me: 0,
    concealed: tiles,
    players: (['E', 'S', 'W', 'N'] as const).map((seatWind, seat) => ({ seat, seatWind, melds: [], discards: [], bonus: [] })),
    phase: 'turn',
    turn: 0,
    discardCount: 4,
    legal: { discard: tiles },
    lastDiscard: null,
    result: null,
    revealed: {},
    events: [{ seq: 1, type: 'discarded', seat: 0, tile: 'p9' }],
  } as unknown as PrivatePlayerView;
}

describe('shape descriptions', () => {
  it('cover every pattern the ruleset can deal', () => {
    const missing: string[] = [];
    for (const wind of ROUND_WINDS) {
      // Hand 0 and hand 1 differ in East, where the first hand is the goulash.
      for (const handInRound of [0, 1]) {
        for (const p of karachi.handSpec(progressFor(wind, handInRound)).patterns) {
          if (!hasWrittenShape(p.id)) missing.push(p.id);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('rounds that want honours', () => {
  // Every one of these is a hand the old heuristic told the player to break up:
  // in East and North the five honours ARE the hand, and three of the winds are
  // meant to sit there as singletons.
  const cases: { name: string; round: Wind; handInRound: number; tiles: TileKind[] }[] = [
    {
      name: 'East honour hand with NEWS, one paired',
      round: 'E',
      handInRound: 1,
      tiles: ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'p9'],
    },
    {
      name: 'East honour hand, three chows down, winds still single',
      round: 'E',
      handInRound: 1,
      tiles: ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'm8', 'WE', 'WS', 'WW', 'WN', 'm1'],
    },
    {
      name: "North, Laila's Hand in the making",
      round: 'N',
      handInRound: 0,
      tiles: ['p1', 'p1', 'p1', 's9', 's9', 'DR', 'DG', 'DW', 'WE', 'WS', 'WW', 'WN', 'WN', 'm4'],
    },
    {
      name: 'North, 1-9 plus 5 Honours in the making',
      round: 'N',
      handInRound: 0,
      tiles: ['s1', 's2', 's3', 's4', 's5', 's6', 'WE', 'WS', 'WW', 'WN', 'DR', 'm2', 'p8', 'm5'],
    },
  ];

  for (const { name, round, handInRound, tiles } of cases) {
    it(`${name}: keeps the honours the round is asking for`, () => {
      expect(oldTutorPick(tiles), 'the case has to be one the old tutor got wrong').toBeDefined();

      const view = turnView(round, handInRound, tiles);
      const coach = coachFor({
        view,
        ruleset: karachi,
        analysis: analyseFor(view, karachi),
        stage: 'new',
        names: { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' },
      });

      expect(coach.action.kind).toBe('discard');
      if (coach.action.kind !== 'discard') return;
      expect(isWindTile(coach.action.tile), `binned ${tileName(coach.action.tile)}`).toBe(false);
      // And it names the hand the winds are serving rather than a pattern id.
      expect(coach.target?.title ?? '').not.toContain('karachi.');
      expect(coach.plan).toBeTruthy();
    });
  }
});

/** A claim window on someone else's discard that the player cannot claim. */
function waitingView(round: Wind, handInRound: number, tiles: readonly TileKind[], discard: TileKind): PrivatePlayerView {
  return {
    ...turnView(round, handInRound, tiles),
    phase: 'claim',
    turn: 1,
    legal: { claims: [], pass: true },
    lastDiscard: { kind: discard, from: 1 },
  } as unknown as PrivatePlayerView;
}

const NAMES = { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' } as const;

/** A sentence's parts as segments, the way the tutor joins them: words as they are, a hand's name as itself. */
const partsText = (parts: readonly (CoachSegment | string)[]): CoachSegment[] => parts.map((p) => (typeof p === 'string' ? { text: p } : p));

describe('the run rule, explained only when it bites', () => {
  const noteFor = (round: Wind, handInRound: number, tiles: TileKind[], discard: TileKind) => {
    const view = turnView(round, handInRound, tiles);
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    const spec = karachi.handSpec(view.progress);
    return runNoteApplies(coach.target, goalFor(spec, round, karachi), spec.patterns, tiles, discard);
  };

  it('applies to a run tile a same-suit run hand wants', () => {
    // Chow + 5 Honours two away, wanting s6 (or s3) for s4-s5: runs never come off the table.
    expect(noteFor('E', 1, ['s4', 's5', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'm1'], 's6')).toBe(true);
  });

  it('never applies in a goulash, where runs are no use', () => {
    const tiles: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'DR', 'DR', 'DR', 'WW', 'WW', 's4', 's5'];
    expect(noteFor('W', 0, tiles, 's6')).toBe(false);
    expect(noteFor('E', 0, tiles, 's6')).toBe(false);
  });

  it('applies to either tile that finishes a run of three: the other side of a two-sided wait too', () => {
    expect(noteFor('E', 1, ['s4', 's5', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'm1'], 's3')).toBe(true);
    expect(noteFor('E', 1, ['s4', 's5', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'm1'], 's7')).toBe(false);
  });

  it("never applies to Khalida's Hand, whose 1 to 9 takes its tiles one at a time across the suits", () => {
    const view = turnView('E', 1, ['p1', 'm2', 'p3', 's4', 's5', 'm6', 'p7', 'WE', 'WS', 'WW', 'WN', 'WN', 'DR', 'DG']);
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    expect(coach.target?.title).toBe("Khalida's Hand");
    // It wants the 8s and 9s it's missing, and only the wall can give them, but none of them makes a run.
    expect(coach.target!.wantsFromWall.length).toBeGreaterThan(0);
    for (const kind of coach.target!.wantsFromWall) expect(runTileFor(coach.target, coach.goal, kind), kind).toBeNull();
  });

  it('says at a claim what a pung of a run tile would cost, and leaves the run rule for its footnote', () => {
    // Chow + 5 Honours two tiles off, both 6 Bamboo in its runs: a pung of the third is legal, and does the hand no good.
    // What it costs is the telling part: every run hand. So the claim sheet says that, and the run line ("you can't
    // claim for a run here") gives way to it. In East a pung of a suit tile always ends every run hand, so the run
    // line stays for a round where a pung leaves one in reach.
    const tiles: TileKind[] = ['s4', 's5', 's6', 's6', 's7', 's7', 's8', 's8', 'WE', 'WS', 'WW', 'WN', 'm1'];
    const view = { ...waitingView('E', 1, tiles, 's6'), legal: { claims: [{ type: 'pung', tiles: ['s6', 's6'] }], pass: true } } as unknown as PrivatePlayerView;
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    expect(coach.action.kind).toBe('pass');
    expect(runNoteApplies(coach.target, coach.goal, [], tiles, 's6')).toBe(true);
    expect(textOf(coach.say)).toBe('A pung here would set you back and rule out every run hand. Pass.');
    // The sheet hasn't said the rule, so the footnote about a run tile going past is still to come this visit.
    expect(coach.teach).toEqual([]);
    expect(lessonFor(coach, new Set()).marks).not.toContain('rule:runs');
  });

  it('keeps quiet while someone else is on the move', () => {
    const tiles: TileKind[] = ['s4', 's5', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'm1'];
    const view = waitingView('E', 1, tiles, 's6');
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    expect(coach.moment).toBe('waiting');
    expect(coach.say).toEqual([]);
  });
});

describe('the run tile that went past, told on the next turn', () => {
  // Chow + 5 Honours two tiles off, wanting 3 or 6 Bamboo for its 4-5 and 5 or 8 Characters for its 6-7.
  const tiles: TileKind[] = ['s4', 's5', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'DR', 'DG'];
  type Move = readonly [type: 'drew' | 'discarded' | 'claimed', seat: 0 | 1 | 2 | 3, tile?: TileKind];
  /** Seat 0's turn after these moves, which follow their own last discard (unless `first`) and end with their draw, holding `hand` (the draw included). */
  const turnAfter = (moves: readonly Move[], first = false, hand: readonly TileKind[] = tiles) => {
    const all: Move[] = [...(first ? [] : [['discarded', 0, 'p1'] as const]), ...moves];
    const events = all.map(([type, seat, tile], i) => ({ seq: i + 1, type, seat, ...(tile ? { tile } : {}), ...(type === 'drew' ? { secret: true } : {}) }));
    return { ...turnView('E', 1, hand), events } as unknown as PrivatePlayerView;
  };
  /** The plan's lay-out in short: each group's shape, then its tiles, a '?' on each still to find. */
  const layoutOf = (view: PrivatePlayerView) => (coachAt(view).target?.layout ?? []).map((g) => `${g.shape}:${g.tiles.map((t) => `${t.kind}${t.held ? '' : '?'}`).join(' ')}`);
  /** A round of discards since seat 0's own: each seat draws and throws, then seat 0 draws `drew`. */
  const round = (s1: TileKind, s2: TileKind, s3: TileKind, drew: TileKind = 'DG'): Move[] => [
    ['drew', 1],
    ['discarded', 1, s1],
    ['drew', 2],
    ['discarded', 2, s2],
    ['drew', 3],
    ['discarded', 3, s3],
    ['drew', 0, drew],
  ];
  const coachAt = (view: PrivatePlayerView, stage: 'new' | 'learning' | 'solid' = 'new') =>
    coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage, names: NAMES });
  const runsNote = (view: PrivatePlayerView, stage?: 'new' | 'learning' | 'solid') => coachAt(view, stage).teach.find((x) => x.key === 'rule:runs');

  it("names who threw it and the run it would have finished, and why it couldn't be taken", () => {
    const view = turnAfter(round('s6', 'DR', 'WE'));
    expect(coachAt(view).target?.title).toBe('Chow + 5 Honours');
    expect(runsNote(view)).toEqual({ key: 'rule:runs', place: 'note', text: `${isolate('Bilal')}'s 6 Bamboo would have finished your 4-5 run, but runs only come from the wall.` });
    // It's there whatever the stage, for `lessonFor` to show once a visit, but a regular hears nothing to put it under.
    expect(runsNote(view, 'learning')).toBeDefined();
    expect(runsNote(view, 'solid')).toBeUndefined();
  });

  it('tells the newest when two went past', () => {
    expect(runsNote(turnAfter(round('s6', 'DR', 's3')))?.text).toBe(`${isolate('Ayesha')}'s 3 Bamboo would have finished your 4-5 run: runs only come from the wall.`);
  });

  it('leaves out a tile somebody took', () => {
    const view = turnAfter([
      ['drew', 1],
      ['discarded', 1, 's6'],
      ['claimed', 2, 's6'],
      ['discarded', 2, 'DR'],
      ['drew', 3],
      ['discarded', 3, 'WE'],
      ['drew', 0, 'DG'],
    ]);
    expect(runsNote(view)).toBeUndefined();
  });

  it("says nothing of a run the player's own draw has only just begun", () => {
    // The same hand, but its 5 Bamboo came in the draw after Bilal's 6 Bamboo went by: then, it would have finished nothing.
    expect(runsNote(turnAfter(round('s6', 'DR', 'WE', 's5')))).toBeUndefined();
  });

  it('says nothing of a run held with a second copy the draw brought, while the first sat in another set', () => {
    // Chow + 5 Honours in one suit, two tiles off: 4-5-6 held, 5-7 wanting a 6, 8-9 wanting a 7. Both 5 Bamboo are in
    // the lay-out, and the second came in the draw after Bilal's 6 Bamboo went by, when the one 5 there sat in 4-5-6.
    const hand: TileKind[] = ['s4', 's5', 's5', 's6', 's7', 's8', 's9', 'WE', 'WS', 'WW', 'WN', 'WN', 'DR', 'DG'];
    const drewTheFive = turnAfter(round('s6', 'DR', 'WE', 's5'), false, hand);
    expect(coachAt(drewTheFive).target?.title).toBe('Chow + 5 Honours');
    expect(layoutOf(drewTheFive)).toEqual(expect.arrayContaining(['run:s4 s5 s6', 'run:s5 s6? s7']));
    expect(runsNote(drewTheFive)).toBeUndefined();
    // With both 5s in hand when it went by (the draw was something else), it would have filled the 5-7.
    expect(runsNote(turnAfter(round('s6', 'DR', 'WE', 'DG'), false, hand))?.text).toBe(
      `${isolate('Bilal')}'s 6 Bamboo would have filled your 5-7 run, but runs only come from the wall.`,
    );
  });

  it('tells only a tile the plan wants from the wall, never the far side of a run that has to start where it does', () => {
    // Naila's Hand two tiles off: its 1-2-3 of Bamboo is held as 2-3 and wants the 1. A 4 Bamboo would make 2-3-4 of
    // those two, which no way of making Naila's Hand has, so it would have finished nothing the plan can use.
    const hand: TileKind[] = ['s2', 's3', 's3', 's4', 's5', 'p1', 'p2', 'm3', 'm4', 'm5', 'WN', 'WN', 'WE', 'DG'];
    const four = turnAfter(round('s4', 'DR', 'WE'), false, hand);
    const coach = coachAt(four);
    expect(coach.target?.title).toBe("Naila's Hand");
    expect(layoutOf(four)).toContain('run:s1? s2 s3');
    expect(coach.target!.wantsFromWall).toContain('s1');
    expect(coach.target!.wantsFromWall).not.toContain('s4');
    expect(runTileFor(coach.target, coach.goal, 's4')).toBeNull();
    expect(runsNote(four)).toBeUndefined();
    // The 1 it does want is told.
    expect(runsNote(turnAfter(round('s1', 'DR', 'WE'), false, hand))?.text).toBe(
      `${isolate('Bilal')}'s 1 Bamboo would have finished your 2-3 run, but runs only come from the wall.`,
    );
  });

  it("comes after the round's footnote on the player's first turn", () => {
    const view = turnAfter(
      [
        ['drew', 3],
        ['discarded', 3, 's6'],
        ['drew', 0, 'DG'],
      ],
      true,
    );
    expect(coachAt(view).teach.map((x) => x.key)).toEqual(['round:honour', 'rule:runs']);
  });
});

describe('plain words', () => {
  it('counts in tiles, never "away"', () => {
    const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'p9'];
    const view = turnView('E', 1, tiles);
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'learning', names: NAMES });
    expect(coach.plan).toMatch(/ · (complete|\d+ tiles? to go|about \d+ tiles to go)$/);
    const text = coach.say.map((s) => s.text).join('');
    expect(text).not.toMatch(/\baway\b| off /);
    expect(text.length).toBeLessThanOrEqual(105);
  });
});

describe('South, where honours are dead', () => {
  it('lets a lone wind go, and says why', () => {
    const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'm8', 'm1', 'm1', 's2', 'WN', 'p9'];
    const view = turnView('S', 0, tiles);
    const coach = coachFor({
      view,
      ruleset: karachi,
      analysis: analyseFor(view, karachi),
      stage: 'new',
      names: { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' },
    });
    expect(coach.action).toEqual({ kind: 'discard', tile: 'WN' });
    expect(coach.reason).toBe('no wind or dragon fits a hand this round');
  });
});

/**
 * The discards other seats made since seat 0's own last discard, claim or kong
 * that nobody took, by the event after each: worked out here from the events
 * afresh, rather than with the helper the tutor uses.
 */
function wentPast(view: PrivatePlayerView): { seat: 0 | 1 | 2 | 3; tile: TileKind }[] {
  const out: { seat: 0 | 1 | 2 | 3; tile: TileKind }[] = [];
  for (let i = view.events.length - 1; i >= 0; i--) {
    const e = view.events[i]!;
    if (e.seat === view.me && ['discarded', 'claimed', 'kong'].includes(e.type)) break;
    const next = view.events[i + 1];
    if (e.type === 'discarded' && e.seat !== undefined && e.tile && next && next.type !== 'claimed' && next.type !== 'won') out.push({ seat: e.seat, tile: e.tile });
  }
  return out;
}

/** The words the tutor never says: engineering words, and the stiff forms of words it contracts. */
const BANNED = [/\baway\b/, /coach/i, /\b(is not|cannot|do not|does not|it is|that is)\b/];

describe('hand names, wherever the tutor says them', () => {
  it('names every hand as a tappable hand, keeps within the bubble, and speaks plainly, at every moment of seeded play', { timeout: 120_000 }, () => {
    const seen = { exchange: 0, claimed: 0, otherWins: 0, washouts: 0, runs: 0, gate: 0 };
    for (const [round, progress] of Object.entries(ROUNDS)) {
      const spec = karachi.handSpec(progress);
      const ids = new Set(spec.patterns.map((p) => p.id));
      const titles = [...new Set(spec.patterns.map(titleOf))];
      for (let h = 0; h < 3; h++) {
        playHand({
          seed: `names-${round}-${h}`,
          progress,
          dealer: h as 0 | 1 | 2,
          onView: (view) => {
            const analysis = analyseFor(view, karachi);
            for (const stage of ['new', 'learning'] as const) {
              const coach: CoachState = coachOf(view, stage, analysis);
              const where = `${round} ${h} seq ${view.seq} ${coach.moment} ${stage}: ${textOf(coach.say)}`;
              expect(visibleLength(textOf(coach.say)), where).toBeLessThanOrEqual(SAY_BUDGET);
              // A first visit's footnotes, the most any line gets, keep to their two lines.
              const notes = lessonFor(coach, new Set()).notes.map(noteText).join(' · ');
              expect(visibleLength(notes), `${where} | ${notes}`).toBeLessThanOrEqual(NOTE_BUDGET);
              for (const re of BANNED) {
                expect(textOf(coach.say), where).not.toMatch(re);
                expect(coach.plan ?? '', where).not.toMatch(re);
              }
              for (const segment of coach.say) {
                if (segment.hand) {
                  expect(ids.has(segment.hand.patternId), where).toBe(true);
                  expect(segment.text, where).toBe(segment.hand.title);
                } else {
                  for (const t of titles) expect(segment.text, where).not.toContain(t);
                }
              }
              const named = coach.say.find((x) => x.hand)?.hand;
              if (coach.moment === 'exchange' && named) seen.exchange++;
              if (coach.moment === 'claim' && coach.action.kind === 'claim' && coach.action.option.type !== 'win' && named) {
                // The hand as it would stand after the claim, with the claimed set laid face up first.
                expect(named.whose, where).toBe('ifClaimed');
                expect(stripGroups(named.layout)[0]?.exposed, where).toBe(true);
                seen.claimed++;
              }
              for (const runs of coach.teach.filter((x) => x.key === 'rule:runs')) {
                if (runs.place === 'said') {
                  // Only the claim sheet's run line says the rule itself.
                  expect(textOf(coach.say), where).toContain("you can't claim for a run here");
                  continue;
                }
                // The run tile that went past: never in a goulash, where runs don't count, and only on the player's own turn.
                expect(['E0', 'W'], where).not.toContain(round);
                expect(coach.goal.chowsClaimable, where).toBe(false);
                expect(view.phase === 'turn' && view.turn === view.me, where).toBe(true);
                // It names a tile another seat threw since the player last moved, that nobody took and that would have made a run of the plan's.
                const named = wentPast(view).filter(
                  (p) =>
                    runTileFor(coach.target, coach.goal, p.tile) &&
                    [`${isolate(LONG_NAMES[p.seat])}'s `, 'A thrown '].some((who) => runs.text.startsWith(`${who}${tileName(p.tile)} `)),
                );
                expect(named.length, `${where} | ${runs.text}`).toBeGreaterThan(0);
                // Its words are plain: no hand's name (a footnote's words can't be a button), and no "That" pointing at nothing on screen.
                expect(runs.text, where).not.toMatch(/^That\b/);
                for (const t of titles) expect(runs.text, where).not.toContain(t);
                expect(visibleLength(runs.text), where).toBeLessThanOrEqual(NOTE_BUDGET);
                seen.runs++;
              }
              if (textOf(coach.say).includes("you can't claim for a run here"))
                expect(
                  coach.teach.map((x) => `${x.key}:${x.place}`),
                  where,
                ).toContain('rule:runs:said');
              // The goulash's honour rule: said plainly on the line, and exactly in a footnote the line leans on.
              expect(textOf(coach.say), where).not.toMatch(/fussy/i);
              const gate = coach.teach.filter((x) => x.key === 'rule:honourGate');
              if (coach.reason === 'winds and dragons only count this hand if you pung two of them') {
                expect(coach.goal.honours, where).toBe('gated');
                expect(coach.action.kind === 'discard' && isHonourTile(coach.action.tile), where).toBe(true);
                expect(gate, where).toEqual([HONOUR_GATE_NOTE]);
                seen.gate++;
              } else expect(gate, where).toEqual([]);
              const result = view.result;
              if (result?.type === 'win' && result.winner !== view.me) {
                expect(named, where).toBe(coach.outcome?.hand?.ref);
                expect(['winner', 'example']).toContain(named?.whose);
                expect(named?.owner).toBe(LONG_NAMES[result.winner]);
                seen.otherWins++;
              }
              if (result?.type === 'draw') {
                // After a washout the line always goes on to say how close the player got, naming their hand.
                if (coach.target && coach.target.away > 0) expect(named, where).toBe(coach.target.hand);
                seen.washouts++;
              }
            }
          },
        });
      }
    }
    // The corpus has to reach the lines it's checking: X1 and X2 in West, a claim, someone else's win, a washout, a run tile gone past.
    expect(seen.exchange).toBeGreaterThan(0);
    expect(seen.runs).toBeGreaterThan(0);
    expect(seen.gate).toBeGreaterThan(0);
    expect(seen.claimed).toBeGreaterThan(0);
    expect(seen.otherWins).toBeGreaterThan(0);
    expect(seen.washouts).toBeGreaterThan(0);
  });

  it("words the goulash's honour rule exactly, in a footnote that fits beside another", () => {
    expect(visibleLength(noteText(HONOUR_GATE_NOTE))).toBeLessThanOrEqual(NOTE_BUDGET);
    // The engine's guard: two conditions, a dragon pung counting once and a wind pung once each for the round's wind and the player's own.
    expect(HONOUR_GATE_NOTE.text).toBe("you need two pungs of dragons, the round's wind or your own wind");
  });

  it('shows the hand a pung would make, with the pung laid face up', () => {
    // East hand 2: a pung of 2 Dots is the tutor's call here (verdict 6's first hand).
    const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p2', 'm8', 'm8', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG'];
    const view = { ...waitingView('E', 1, tiles, 'p2'), legal: { claims: [{ type: 'pung', tiles: ['p2', 'p2'] }], pass: true } } as unknown as PrivatePlayerView;
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    expect(coach.action.kind).toBe('claim');
    const named = coach.say.find((x) => x.hand)!;
    expect(named.hand).toMatchObject({ whose: 'ifClaimed' });
    const first = stripGroups(named.hand!.layout)[0]!;
    expect(first.exposed).toBe(true);
    expect(first.tiles.map((t) => t.kind)).toEqual(['p2', 'p2', 'p2']);
  });

  it('names the plan in a discard reason as a hand, the same one the strip shows', () => {
    const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'p9'];
    const seen = new Set<string>();
    // The reasons rotate with the player's own discards; try each place in the rotation.
    for (let n = 1; n <= 6; n++) {
      const view = {
        ...turnView('E', 1, tiles),
        events: Array.from({ length: n }, (_, i) => ({ seq: i + 1, type: 'discarded', seat: 0, tile: 'p9' })),
      } as unknown as PrivatePlayerView;
      const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'learning', names: NAMES });
      for (const x of coach.say.filter((y) => y.hand)) {
        expect(x.hand).toBe(coach.target?.hand);
        seen.add(x.text);
      }
      expect(coach.reason).not.toBeNull();
      expect(textOf(coach.say)).toContain(coach.reason!);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('keeps how close the player got after a washout, shortening the washout line to make room', () => {
    const tiles: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'DR', 'DR', 'WW', 'WW', 's4', 's5', 's9'];
    const finished = { ...turnView('E', 0, tiles), phase: 'finished', result: { type: 'draw' } } as unknown as PrivatePlayerView;
    const coach = coachFor({ view: finished, ruleset: karachi, analysis: analyseFor(finished, karachi), stage: 'new', names: NAMES });
    const target = coach.target!;
    expect(target.away).toBeGreaterThan(0);
    // The whole washout line and E5 together are over the budget, so the washout line loses its second sentence, not E5.
    const whole = [...washoutLine(), ...partsText(shortOfLine(target.away, target.title))];
    expect(visibleLength(textOf(whole))).toBeGreaterThan(SAY_BUDGET);
    expect(textOf(coach.say)).toBe(textOf([...washoutLine(true), ...partsText(shortOfLine(target.away, target.title))]));
    expect(coach.say.filter((x) => x.hand).map((x) => x.hand)).toEqual([target.hand]);
    expect(visibleLength(textOf(coach.say))).toBeLessThanOrEqual(SAY_BUDGET);
  });

  it('has room for how close the player got after a washout, for every hand the ruleset deals and every count', () => {
    const titles = new Set<string>();
    for (const wind of ROUND_WINDS) for (const handInRound of [0, 1]) for (const p of karachi.handSpec(progressFor(wind, handInRound)).patterns) titles.add(titleOf(p));
    for (const title of titles)
      for (let away = 1; away <= 14; away++) {
        const say = textOf([...washoutLine(true), ...partsText(shortOfLine(away, title))]);
        expect(visibleLength(say), say).toBeLessThanOrEqual(SAY_BUDGET);
      }
  });

  it("says the whole washout line when there's nothing to add", () => {
    // Nothing to be short of: an analysis that found no hand the player could still make.
    const tiles: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'DR', 'DR', 'WW', 'WW', 's4', 's5', 's9'];
    const finished = { ...turnView('E', 0, tiles), phase: 'finished', result: { type: 'draw' } } as unknown as PrivatePlayerView;
    const analysis = { ...analyseFor(finished, karachi), candidates: [] };
    const coach = coachFor({ view: finished, ruleset: karachi, analysis, stage: 'new', names: NAMES });
    expect(textOf(coach.say)).toBe("Washed out: the wall's run dry and nobody won. No points change hands.");
  });
});

describe('what the tutor could teach a first-timer', () => {
  const dealt = (progress: GameProgress, dealer: 0 | 1, seed = 'teach') => viewFor(startHand(karachi, { seed, progress, dealer }), karachi, 0);

  it("gives the round's footnote on the player's first turn, and marks it said while someone else deals, whose bubble gives the aim", () => {
    const mine = coachOf(dealt(ROUNDS.E0, 0), 'new');
    expect(mine.moment).toBe('handStart');
    expect(mine.teach[0]).toEqual({ key: 'round:goulash', place: 'note', label: 'this hand', text: "four pungs and a pair, and runs don't count", also: ['hand:Goulash'] });
    const theirs = coachOf(dealt(ROUNDS.E0, 1), 'new');
    expect(theirs.moment).toBe('handStart');
    expect(theirs.teach[0]).toMatchObject({ key: 'round:goulash', place: 'said', also: ['hand:Goulash'] });
    expect(coachOf(dealt(ROUNDS.E1, 1), 'new').teach[0]).toMatchObject({ key: 'round:honour', place: 'said', also: ['hand:Chow + 5 Honours', 'hand:Pung + 5 Honours'] });
    expect(coachOf(dealt(ROUNDS.N, 0), 'new').teach[0]).toMatchObject({ key: 'round:big', place: 'note', also: [] });
  });

  it("gives it only before the player's own first discard", () => {
    expect(coachOf(turnView('E', 0, ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'DR', 'DR', 'WW', 'WW', 's4', 's5', 's9', 's9']), 'new').teach).toEqual([]);
  });

  it('explains a flower drawn since the player last moved, and marks the word for it taught', () => {
    const tiles: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'DR', 'DR', 'WW', 'WW', 's4', 's5', 's9', 's9'];
    const withEvents = (events: readonly object[]) => ({ ...turnView('E', 0, tiles), events }) as unknown as PrivatePlayerView;
    const flower = coachOf(
      withEvents([
        { seq: 1, type: 'discarded', seat: 0, tile: 'p9' },
        { seq: 2, type: 'bonus', seat: 0, tile: 'F1' },
      ]),
      'new',
    );
    expect(flower.teach).toContainEqual({ key: 'rule:flowers', place: 'note', label: 'flowers', text: GLOSSARY.bonus.short, also: ['term:bonus'] });
    const old = coachOf(
      withEvents([
        { seq: 1, type: 'bonus', seat: 0, tile: 'F1' },
        { seq: 2, type: 'discarded', seat: 0, tile: 'p9' },
      ]),
      'new',
    );
    expect(old.teach.map((t) => t.key)).not.toContain('rule:flowers');
    // A regular hears nothing, so there's nothing to put a footnote under.
    const solid = coachOf(
      withEvents([
        { seq: 1, type: 'discarded', seat: 0, tile: 'p9' },
        { seq: 2, type: 'bonus', seat: 0, tile: 'F1' },
      ]),
      'solid',
    );
    expect(solid.teach).toEqual([]);
  });

  it("marks the player's own winning hand said: the line gives its shape already", () => {
    const won: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'm4', 'm4', 'm4', 's2', 's2', 's2', 's9', 's9'];
    const view = {
      ...turnView('E', 0, won),
      phase: 'finished',
      revealed: { 0: won },
      result: { type: 'win', winner: 0, patternId: 'karachi.goulash', selfDrawn: true, settlement: {} },
    } as unknown as PrivatePlayerView;
    const coach = coachOf(view, 'new');
    expect(coach.say.find((x) => x.hand)?.text).toBe('Goulash');
    expect(coach.teach).toEqual([{ key: 'hand:Goulash', place: 'said', hand: coach.outcome?.hand?.ref, text: coach.outcome?.hand?.ref.note }]);
  });

  it("knows each round's everyday hands, and which view it is", () => {
    const titles = (progress: GameProgress) => coachOf(dealt(progress, 0)).goal.generalTitles;
    expect(titles(ROUNDS.E0)).toEqual(['Goulash']);
    expect(titles(ROUNDS.E1)).toEqual(['Chow + 5 Honours', 'Pung + 5 Honours']);
    expect(titles(ROUNDS.S)).toEqual(['Any Damn Hand']);
    expect(titles(ROUNDS.N)).toEqual([]);
    const view = dealt(ROUNDS.S, 0);
    expect(coachOf(view).at).toEqual({ hand: ROUNDS.S.handIndex, seq: view.seq });
  });
});

describe('someone who takes a seat over part-way through a hand', () => {
  // East hand 2, after the bot's first discard for the seat: Chow + 5 Honours two tiles off.
  const tiles: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'p9'];
  const mine = turnView('E', 1, tiles);
  /** The same hand on Bilal's turn, the tile after the seat's own discard gone. */
  const theirs = { ...turnView('E', 1, tiles.slice(0, 13)), turn: 1, legal: {} } as unknown as PrivatePlayerView;
  const coachAt = (view: PrivatePlayerView, firstLook?: boolean, stage: 'new' | 'learning' | 'solid' = 'learning', analysis = analyseFor(view, karachi)) =>
    coachFor({ view, ruleset: karachi, analysis, stage, names: NAMES, ...(firstLook === undefined ? {} : { firstLook }) });
  const aim = (coach: CoachState) => textOf(coach.say).startsWith(coach.goal.aim);
  const teachOf = (coach: CoachState) => coach.teach.map((x) => `${x.key}:${x.place}`);

  it("gives the round's aim while someone else is on the move, with the plan still showing, and the take-over footnote first", () => {
    const coach = coachAt(theirs, true);
    expect(coach.moment).toBe('handStart');
    expect(aim(coach)).toBe(true);
    // The hand's under way, so the plan the strip lays out stays.
    expect(coach.plan).not.toBeNull();
    expect(coach.plan).toBe(coachAt(mine).plan);
    expect(coach.action.kind).toBe('wait');
    expect(coach.teach[0]).toEqual({ key: 'firstLook', place: 'note', label: 'taking over', text: "these were the bot's tiles; the row above them is the hand to aim for" });
    // The bubble says the aim, so the round's footnote would only say it again.
    expect(teachOf(coach)).toEqual(['firstLook:note', 'round:honour:said']);
    expect(coach.teach[1]).toMatchObject({ also: ['hand:Chow + 5 Honours', 'hand:Pung + 5 Honours'] });
  });

  it("gives the aim on their own turn too, rather than the discard's reason, and still offers the tutor's tile", () => {
    const usual = coachAt(mine);
    const coach = coachAt(mine, true);
    expect(aim(coach)).toBe(true);
    expect(textOf(coach.say)).toBe(textOf(coachAt(theirs, true).say));
    expect(textOf(coach.say)).not.toMatch(/^Discard /);
    expect(usual.action.kind).toBe('discard');
    expect(coach.action).toEqual(usual.action);
    expect(coach.highlight).toEqual(usual.highlight);
    expect(coach.plan).toBe(usual.plan);
    expect(teachOf(coach).slice(0, 2)).toEqual(['firstLook:note', 'round:honour:said']);
    expect(visibleLength(textOf(coach.say))).toBeLessThanOrEqual(SAY_BUDGET);
  });

  it('changes nothing without it', () => {
    for (const view of [mine, theirs]) {
      expect(coachAt(view, false)).toEqual(coachAt(view));
      expect(teachOf(coachAt(view))).not.toContain('firstLook:note');
    }
    // After the seat's first discard, someone else's move is quiet, and the player's own turn gives the discard's reason.
    expect(coachAt(theirs)).toMatchObject({ moment: 'waiting', say: [] });
    expect(textOf(coachAt(mine).say)).toMatch(/^Discard /);
  });

  it('keeps quiet for a regular, and leaves out the footnote when there is no plan for it to point at', () => {
    expect(coachAt(theirs, true, 'solid').say).toEqual([]);
    expect(coachAt(mine, true, 'solid').say).toEqual([]);
    expect(lessonFor(coachAt(theirs, true, 'solid'), new Set()).notes).toEqual([]);
    // "The row above them" is the plan strip: with no hand to lay out, it's empty.
    const nothing = { ...analyseFor(theirs, karachi), candidates: [] };
    const coach = coachAt(theirs, true, 'learning', nothing);
    expect(aim(coach)).toBe(true);
    expect(teachOf(coach)).toEqual(['round:honour:said']);
  });

  it("doesn't hide a Mahjong, or put a footnote about the hand to aim for under it", () => {
    const won: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'm4', 'm4', 'm4', 's2', 's2', 's2', 's9', 's9'];
    const view = { ...turnView('E', 0, won), legal: { discard: won, win: true } } as unknown as PrivatePlayerView;
    const coach = coachAt(view, true);
    expect(coach.action.kind).toBe('win');
    expect(textOf(coach.say)).toBe("That's Goulash, complete. Call Mahjong!");
    // The row above her tiles is a complete hand now, and the line doesn't give the round's aim: neither footnote, and
    // the round isn't marked said by a line that never said it. The winning hand's own footnote can show.
    expect(coach.target?.layout).not.toBeNull();
    expect(teachOf(coach)).toEqual([]);
    for (const stage of ['new', 'learning'] as const) {
      const { notes, marks } = lessonFor(coachAt(view, true, stage), new Set());
      const keys = notes.map((n) => n.key);
      expect(keys, stage).toEqual(['hand:Goulash']);
      expect(marks, stage).not.toContain('firstLook');
    }
  });

  it("brings the take-over footnote with a new line, never under a bubble whose words haven't changed", () => {
    // A first look whose plan has no lay-out yet: nothing for the footnote to point at, so it isn't offered.
    const analysis = analyseFor(theirs, karachi);
    const unlaid = { ...analysis, candidates: analysis.candidates.map((c) => ({ ...c, layout: null })) };
    const store = createTaughtStore(null);
    const lessons = createLessons(() => store);
    const bare = coachAt({ ...theirs, seq: 10 }, true, 'learning', unlaid);
    expect(teachOf(bare)).toEqual(['round:honour:said']);
    expect(lessons.next(bare).notes).toEqual([]);
    // The next view has one, under the same words: the same line, so it keeps the footnotes it came with.
    const laid = coachAt({ ...theirs, seq: 11 }, true, 'learning', analysis);
    expect(textOf(laid.say)).toBe(textOf(bare.say));
    expect(teachOf(laid)[0]).toBe('firstLook:note');
    expect(lessons.next(laid).notes).toEqual([]);
    // Her own turn is a new line, still a first look: the footnote comes with it.
    const turn = coachAt({ ...mine, seq: 12 }, true);
    expect(lessons.next(turn).notes.map((n) => n.key)).toEqual(['firstLook']);
    expect(store.all().has('firstLook')).toBe(true);
  });

  it('shows the take-over footnote under the first bubble, and teaches it for the visit', { timeout: 120_000 }, () => {
    // A reducer-played hand, taken over on someone else's turn once the seat has moved: every view from there until the
    // person's own first move is a first look, as a live table would pass it.
    const store = createTaughtStore(null);
    const lessons = createLessons(() => store);
    let took: { hand: number; seq: number } | null = null;
    /** Each line the person sees from the take-over on, and whether the take-over footnote is under it. */
    const lines: { seq: number; line: string; note: boolean }[] = [];
    let looks = 0;
    playHand({
      seed: 'take-over',
      progress: ROUNDS.E1,
      onView: (view) => {
        if (!took && myDiscardCount(view) >= 1 && view.phase === 'turn' && view.turn !== 0) took = { hand: view.progress.handIndex, seq: view.seq };
        if (!took) return;
        const firstLook = firstLookFor(view, took);
        const coach = coachOf(view, 'learning', analyseFor(view, karachi), firstLook);
        const lesson = lessons.next(coach);
        if (firstLook) {
          looks++;
          if (coach.moment !== 'claim') expect(aim(coach), `seq ${view.seq}`).toBe(true);
          expect(coach.teach[0]?.key, `seq ${view.seq}`).toBe('firstLook');
        } else expect(coach.teach.map((x) => x.key)).not.toContain('firstLook');
        lines.push({ seq: view.seq, line: lineKey(coach), note: lesson.notes.some((n) => n.key === 'firstLook') });
      },
    });
    expect(took).not.toBeNull();
    expect(looks).toBeGreaterThan(1);
    // On the take-over's own view, whose bubble is the first with something to say. It stays with that line while the
    // others move, and no later line has it.
    expect(lines[0]).toMatchObject({ seq: took!.seq, note: true });
    const later = lines.findIndex((x) => x.line !== lines[0]!.line);
    expect(later).toBeGreaterThan(0);
    expect(lines.slice(0, later).every((x) => x.note)).toBe(true);
    expect(lines.slice(later).filter((x) => x.note)).toEqual([]);
    expect(store.all().has('firstLook')).toBe(true);
  });
});

describe('claims that tell the truth about run hands', () => {
  /** A claim window on Bilal's discard, with the claims the player is offered. */
  const claimView = (round: Wind, handInRound: number, tiles: TileKind[], discard: TileKind, claims: readonly { type: 'pung' | 'kong'; tiles: TileKind[] }[]) =>
    ({ ...waitingView(round, handInRound, tiles, discard), legal: { claims, pass: true } }) as unknown as PrivatePlayerView;
  const pung = (k: TileKind) => [{ type: 'pung' as const, tiles: [k, k] }];
  const sayOf = (view: PrivatePlayerView) => {
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    return { coach, text: textOf(coach.say) };
  };

  it('knows which hands take runs: Any Damn Hand, whose sets can be runs, included', () => {
    const find = (round: Wind, handInRound: number, id: string) => karachi.handSpec(progressFor(round, handInRound)).patterns.find((p) => p.id === id)!;
    expect(admitsRun(find('S', 0, 'karachi.south.anyDamnHand'))).toBe(true);
    expect(admitsRun(find('S', 0, 'karachi.south.crazyChows'))).toBe(true);
    expect(admitsRun(find('E', 1, 'karachi.east.chows.each.news'))).toBe(true);
    expect(admitsRun(find('E', 1, 'karachi.east.pungs.each.news'))).toBe(false);
    expect(admitsRun(find('E', 0, 'karachi.goulash'))).toBe(false);
    expect(admitsRun(find('S', 0, 'karachi.south.dirtyPairs'))).toBe(false);
  });

  it('says a pung that gets the hand closer rules out every run hand, when it does', () => {
    // Before the pung, every nearest hand is a run hand or Windyfly; after it, no run hand is left.
    const { coach, text } = sayOf(claimView('E', 1, ['s4', 's5', 's6', 'p2', 'p2', 'm8', 'm8', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG'], 'p2', pung('p2')));
    expect(coach.action.kind).toBe('claim');
    expect(text).toBe("Pung it: you'll be four tiles from Pung + 5 Honours, but it rules out every run hand.");
    expect(coach.say.find((x) => x.hand)?.hand).toMatchObject({ whose: 'ifClaimed', title: 'Pung + 5 Honours' });
  });

  it('says a pung that would set the hand back, and end every run hand, does both, instead of "does nothing"', () => {
    const { coach, text } = sayOf(claimView('E', 1, ['s4', 's5', 's6', 'p2', 'p2', 'm7', 'm8', 'WE', 'WS', 'WW', 'WN', 'WN', 'DR'], 'p2', pung('p2')));
    expect(coach.action.kind).toBe('pass');
    expect(text).toBe('A pung here would set you back and rule out every run hand. Pass.');
    expect(text).not.toContain('does nothing');
    // It's not the run rule the claim sheet says, so the run tile's footnote is still to come.
    expect(coach.teach).toEqual([]);
  });

  it('says a pung that gets the hand no closer, and ends every run hand, does that', () => {
    const { coach, text } = sayOf(
      claimView('E', 1, ['s4', 's5', 's6', 'p2', 'p2', 'p2', 'm8', 'm8', 'WE', 'WS', 'WW', 'WN', 'DR'], 'p2', [
        { type: 'pung', tiles: ['p2', 'p2'] },
        { type: 'kong', tiles: ['p2', 'p2', 'p2'] },
      ]),
    );
    expect(coach.action.kind).toBe('pass');
    expect(text).toBe('A pung here gets you no closer and rules out every run hand. Pass.');
    const kong = sayOf(claimView('E', 1, ['s4', 's5', 's6', 'p2', 'p2', 'p2', 'm7', 'm8', 'WE', 'WS', 'WW', 'WN', 'WN'], 'p2', [{ type: 'kong', tiles: ['p2', 'p2', 'p2'] }]));
    expect(kong.text).toBe('A kong here would set you back and rule out every run hand. Pass.');
  });

  it('says a pung of a wind in South would leave no hand at all', () => {
    const { coach, text } = sayOf(claimView('S', 0, ['m2', 'm4', 'm8', 'm8', 'm9', 'm9', 'm9', 'p5', 'p5', 's8', 's9', 'WW', 'WW'], 'WW', pung('WW')));
    expect(coach.action.kind).toBe('pass');
    expect(text).toBe('A pung here would leave no winning hand you could still make. Pass.');
  });

  it('never says a pung in South rules out every run hand: Any Damn Hand takes runs, and a pung too', () => {
    const { coach, text } = sayOf(claimView('S', 0, ['m2', 'm3', 'm4', 'm6', 'p2', 'p3', 'p6', 's3', 's3', 's5', 's6', 's9', 's9'], 's9', pung('s9')));
    expect(coach.target?.title).toBe('Any Damn Hand');
    expect(coach.action.kind).toBe('claim');
    expect(text).toBe("Pung it: you'll be two tiles from Any Damn Hand.");
  });

  it('never says so in South over seeded play either', { timeout: 240_000 }, () => {
    let windows = 0;
    for (let h = 0; h < 30; h++) {
      playHand({
        seed: `v2sim-S-${h}`,
        progress: ROUNDS.S,
        dealer: (h % 4) as 0 | 1 | 2 | 3,
        onView: (view) => {
          if (view.phase !== 'claim' || !view.legal.claims?.some((c) => c.type === 'pung')) return;
          windows++;
          const text = textOf(coachOf(view).say);
          expect(text, `v2sim-S-${h} seq ${view.seq}`).not.toContain('rules out every run hand');
          expect(text, `v2sim-S-${h} seq ${view.seq}`).not.toContain('rule out every run hand');
        },
      });
    }
    expect(windows).toBeGreaterThan(10);
  });

  it("drops a kong's replacement tile first when the line runs long, and never keeps it while saying the kong ends every run hand", () => {
    const hand = (title: string): CoachSegment => ({ text: title, hand: { patternId: 'x', title, shape: '', whose: 'ifClaimed', layout: [], note: '' } });
    for (const title of ['Monty Wriggly Snake v2', 'Pung + 5 Honours', 'Goulash'])
      for (let away = 1; away <= 13; away++) {
        const ends = textOf(claimLine('kong', away, hand(title), true));
        expect(ends, ends).not.toContain('replacement');
        expect(visibleLength(ends), ends).toBeLessThanOrEqual(SAY_BUDGET);
        const pungLine = textOf(claimLine('pung', away, hand(title), true));
        expect(visibleLength(pungLine), pungLine).toBeLessThanOrEqual(SAY_BUDGET);
      }
    expect(textOf(claimLine('kong', 3, hand('Monty Wriggly Snake v2'), true))).toBe("Kong it: you'll be three tiles from Monty Wriggly Snake v2, but it rules out every run hand.");
    expect(textOf(claimLine('kong', 2, hand('Goulash'), false))).toBe("Kong it: you'll be two tiles from Goulash, with a replacement tile to come.");
    expect(textOf(claimLine('pung', 2, null, false))).toBe("Pung it: you'll be two tiles.");
  });
});

describe('a plan that holds steady, and says when it switches', () => {
  // East hand 2: Chow + 5 Honours and Apple Blossom both two tiles off, Hovering Angel three.
  const tiles: TileKind[] = ['s1', 's2', 's3', 'p1', 'p2', 'p3', 'm1', 'm2', 'DW', 'DW', 'DW', 'DG', 'WE', 'WS'];
  const at = (seq: number, t: readonly TileKind[] = tiles) => ({ ...turnView('E', 1, t), seq }) as unknown as PrivatePlayerView;
  const markFor = (view: PrivatePlayerView, from: { id: string; title: string }, toldAt: number | null): PlanMark => {
    const lead = analyseFor(view, karachi).candidates[0]!;
    return { game: 'g', hand: view.progress.handIndex, patternId: lead.patternId, title: titleOf(lead), switched: { fromId: from.id, fromTitle: from.title, toldAt } };
  };
  const coachWith = (view: PrivatePlayerView, mark: PlanMark | null, analysis = analyseFor(view, karachi)) =>
    coachFor({ view, ruleset: karachi, analysis, stage: 'learning', names: NAMES, mark });

  it('says the new plan is a tile closer, with the old one a hand you can tap', () => {
    const view = at(7);
    const coach = coachWith(view, markFor(view, { id: 'karachi.east.hoveringAngel', title: 'Hovering Angel' }, 7));
    const tile = tileName((coach.action as { tile: TileKind }).tile);
    expect(textOf(coach.say)).toBe(`Discard ${tile}. Switching to Chow + 5 Honours: it's a tile closer than Hovering Angel.`);
    expect(coach.planSwitch).toMatchObject({ closerBy: 1, from: { title: 'Hovering Angel', whose: 'yours', away: 3 } });
    expect(coach.say.filter((x) => x.hand).map((x) => x.hand)).toEqual([coach.target!.hand, coach.planSwitch!.from]);
    // So a first visit gets both hands' footnotes, the old one included.
    expect(lessonFor(coach, new Set(['rule:runs'])).notes.map((n) => n.key)).toContain('hand:Chow + 5 Honours');
  });

  it("says the round's general hand has caught up, when that's why", () => {
    const view = at(7);
    const coach = coachWith(view, markFor(view, { id: 'karachi.east.appleBlossom', title: 'Apple Blossom' }, 7));
    expect(textOf(coach.say)).toMatch(/^Discard .+\. Switching to Chow \+ 5 Honours: it's as close as Apple Blossom, and easier\.$/);
    expect(coach.planSwitch?.closerBy).toBe(0);
  });

  it("says the old hand can't be made now, and shows its example", () => {
    // A pung of 2 Dots laid face up: no run hand is left.
    const view = {
      ...at(9, ['s4', 's5', 's6', 'm8', 'm8', 'WE', 'WS', 'WW', 'WN', 'DR', 'DG']),
      players: (['E', 'S', 'W', 'N'] as const).map((seatWind, seat) => ({
        seat,
        seatWind,
        melds: seat === 0 ? [{ type: 'pung', tiles: ['p2', 'p2', 'p2'], from: 1 }] : [],
        discards: [],
        bonus: [],
      })),
    } as unknown as PrivatePlayerView;
    const coach = coachWith(view, markFor(view, { id: 'karachi.east.windyChows', title: 'Windy Chows' }, 9));
    expect(textOf(coach.say)).toMatch(/^Discard .+\. Switching to .+: Windy Chows can't be made now\.$/);
    expect(coach.planSwitch).toMatchObject({ closerBy: null, from: { title: 'Windy Chows', whose: 'example' } });
  });

  it("says only that it's switching when neither reason holds", () => {
    // Two named hands as close, and nothing to say the new one is easier.
    const view = at(7);
    const plain = analyseFor(view, karachi);
    const blossom = plain.candidates.find((c) => c.patternId === 'karachi.east.appleBlossom')!;
    const analysis = { ...plain, candidates: [blossom, ...plain.candidates.filter((c) => c !== blossom)] };
    const mark: PlanMark = {
      game: 'g',
      hand: view.progress.handIndex,
      patternId: blossom.patternId,
      title: 'Apple Blossom',
      switched: { fromId: 'karachi.east.chows.each.pungPair', fromTitle: 'Chow + 5 Honours', toldAt: 7 },
    };
    const coach = coachWith(view, mark, analysis);
    expect(textOf(coach.say)).toMatch(/^Discard .+\. Switching to Apple Blossom\.$/);
    expect(coach.planSwitch?.closerBy).toBe(0);
  });

  it('says nothing of it on any other view, or on the turn after the one that told it', () => {
    const view = at(12);
    const usual = coachWith(view, null);
    for (const mark of [
      markFor(view, { id: 'karachi.east.hoveringAngel', title: 'Hovering Angel' }, 7),
      markFor(view, { id: 'karachi.east.hoveringAngel', title: 'Hovering Angel' }, null),
    ]) {
      const coach = coachWith(view, mark);
      expect(textOf(coach.say)).toBe(textOf(usual.say));
      expect(textOf(coach.say)).not.toContain('Switching');
      expect(coach.planSwitch).toBeNull();
    }
    // Nor while someone else is on the move, even with a switch told on this seq.
    const theirs = { ...at(12, tiles.slice(0, 13)), turn: 1, legal: {} } as unknown as PrivatePlayerView;
    expect(coachWith(theirs, markFor(theirs, { id: 'karachi.east.hoveringAngel', title: 'Hovering Angel' }, 12)).planSwitch).toBeNull();
  });

  it('names the same hand in the strip as in the bubble on a winning turn, whatever plan the player was on', () => {
    // Complete as Hovering Angel, which is how the win is announced; one tile earlier Chow + 5 Honours led.
    const done: TileKind[] = ['s4', 's5', 's6', 'p2', 'p3', 'p4', 'm1', 'm2', 'm3', 'WN', 'WN', 'WN', 'DR', 'DR'];
    const view = { ...at(20, done), legal: { discard: done, win: true } } as unknown as PrivatePlayerView;
    const mark: PlanMark = { game: 'g', hand: view.progress.handIndex, patternId: 'karachi.east.chows.each.pungPair', title: 'Chow + 5 Honours', switched: null };
    const coach = coachWith(view, mark, analyseFor(view, karachi, mark.patternId));
    expect(textOf(coach.say)).toBe("That's Hovering Angel, complete. Call Mahjong!");
    expect(coach.target?.title).toBe('Hovering Angel');
    expect(coach.planSwitch).toBeNull();
  });

  it('keeps each switch line within the bubble and names both hands, over seeded play with the plan held', { timeout: 120_000 }, () => {
    const seen = { switches: 0, closer: 0, caughtUp: 0, gone: 0, wins: 0 };
    for (const [round, progress] of Object.entries(ROUNDS)) {
      if (round === 'E0' || round === 'W') continue;
      const spec = karachi.handSpec(progress);
      for (let h = 0; h < 4; h++) {
        const tutor = stickyCoach(`${round}-${h}`);
        playHand({
          seed: `switch-${round}-${h}`,
          progress,
          dealer: h as 0 | 1 | 2 | 3,
          onView: (view) => {
            const coach = tutor(view);
            const where = `${round} ${h} seq ${view.seq}: ${textOf(coach.say)}`;
            // A self-drawn win: the strip names the hand the bubble announces, not the plan the player was on.
            if (view.phase === 'turn' && view.turn === view.me && view.legal.win && coach.action.kind === 'win') {
              seen.wins++;
              expect(textOf(coach.say), where).toContain(`That's ${coach.target!.title}, complete`);
            }
            if (!coach.planSwitch) {
              expect(textOf(coach.say), where).not.toContain('Switching');
              return;
            }
            seen.switches++;
            expect(view.phase === 'turn' && view.turn === view.me, where).toBe(true);
            expect(textOf(coach.say), where).toMatch(new RegExp(`^Discard [^.]+\\. Switching to ${coach.target!.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
            expect(visibleLength(textOf(coach.say)), where).toBeLessThanOrEqual(SAY_BUDGET);
            expect(coach.planSwitch.from.title, where).not.toBe(coach.target!.title);
            expect(
              spec.patterns.some((p) => p.id === coach.planSwitch!.from.patternId),
              where,
            ).toBe(true);
            const { closerBy } = coach.planSwitch;
            if (closerBy === null) seen.gone++;
            else if (closerBy > 0) seen.closer++;
            else seen.caughtUp++;
            // Every closer-by count is honest: never negative, and never two tiles or more in this corpus's play.
            if (closerBy !== null) expect(closerBy, where).toBeGreaterThanOrEqual(0);
          },
        });
      }
    }
    expect(seen.switches).toBeGreaterThan(0);
    expect(seen.closer + seen.caughtUp).toBeGreaterThan(0);
    expect(seen.wins).toBeGreaterThan(0);
  });
});

describe('kongs: advised when they cost the hand nothing, and warned off when they would set it back', () => {
  const K2 = " Don't press Kong: it would set your hand back.";
  /** The player's turn with these kongs on offer. */
  const kongView = (round: Wind, handInRound: number, tiles: readonly TileKind[], kong: readonly TileKind[]) =>
    ({ ...turnView(round, handInRound, tiles), seq: 5, legal: { discard: tiles, kong } }) as unknown as PrivatePlayerView;
  const coachAt = (view: PrivatePlayerView, opts: { stage?: 'learning' | 'solid'; firstLook?: boolean; mark?: PlanMark; analysis?: ReturnType<typeof analyseFor> } = {}) =>
    coachFor({
      view,
      ruleset: karachi,
      analysis: opts.analysis ?? analyseFor(view, karachi),
      stage: opts.stage ?? 'learning',
      names: NAMES,
      firstLook: opts.firstLook ?? false,
      mark: opts.mark ?? null,
    });
  // The goulash: four 2 Bamboo, pungs of 5 Dots and 7 Characters, the East wind paired. Two tiles off, with the kong or without.
  const free: TileKind[] = ['s2', 's2', 's2', 's2', 'p5', 'p5', 'p5', 'm7', 'm7', 'm7', 'WE', 'WE', 'DR', 'DG'];
  // East hand 2: the four 3 Bamboo make three runs of Chow + 5 Honours, and a kong of them would break those up.
  const costly: TileKind[] = ['s1', 's2', 's3', 's3', 's3', 's3', 's4', 's5', 'WE', 'WS', 'WW', 'WN', 'DR', 'm9'];

  it('advises a kong that costs nothing, lights its tile, and keeps a tile to let go for someone who would rather not', () => {
    const view = kongView('E', 0, free, ['s2']);
    const analysis = analyseFor(view, karachi);
    const coach = coachAt(view);
    expect(analysis.bestDiscard).not.toBeNull();
    expect(coach.action).toEqual({ kind: 'kong', tile: 's2', discard: analysis.bestDiscard });
    expect(suggestedDiscard(coach.action)).toBe(analysis.bestDiscard);
    expect(coach.highlight).toEqual(['s2']);
    expect(textOf(coach.say)).toBe('Kong 2 Bamboo: with four of a kind you draw an extra tile, and it costs your hand nothing.');
    expect(coach.say[0]).toEqual({ text: 'Kong 2 Bamboo', action: true });
    // The bots' own rule says the same.
    expect(analysisBot(view, karachi)).toEqual({ type: 'declareKong', seat: 0, tile: 's2' });
    // On the dealer's first turn, before any discard, the round's footnote still comes with it.
    const first = coachAt({ ...view, events: [] } as unknown as PrivatePlayerView);
    expect(first.action.kind).toBe('kong');
    expect(first.teach.map((x) => `${x.key}:${x.place}`)).toEqual(['round:goulash:note']);
  });

  it('keeps K1 within the bubble for every tile, with no hand in reach to cost', () => {
    for (const k of ALL_TILE_KINDS) {
      const tiles: TileKind[] = [k, k, k, k, ...ALL_TILE_KINDS.filter((x) => x !== k).slice(0, 10)];
      const view = kongView('S', 0, tiles, [k]);
      const coach = coachAt(view, { analysis: { ...analyseFor(view, karachi), candidates: [] } });
      expect(coach.action.kind, k).toBe('kong');
      expect(textOf(coach.say), k).toBe(`Kong ${tileName(k)}: with four of a kind you draw an extra tile, and it costs your hand nothing.`);
      expect(visibleLength(textOf(coach.say)), k).toBeLessThanOrEqual(SAY_BUDGET);
    }
  });

  it('keeps the kong as the tip, lit, for a regular, with nothing said', () => {
    const coach = coachAt(kongView('E', 0, free, ['s2']), { stage: 'solid' });
    expect(coach.action.kind).toBe('kong');
    expect(coach.highlight).toEqual(['s2']);
    expect(coach.say).toEqual([]);
  });

  it('says not to press Kong when it would set the hand back, and offers the discard as usual', () => {
    const view = kongView('E', 1, costly, ['s3']);
    const analysis = analyseFor(view, karachi);
    const coach = coachAt(view);
    expect(analysisBot(view, karachi)?.type).toBe('discard');
    expect(coach.action).toEqual({ kind: 'discard', tile: analysis.bestDiscard });
    expect(suggestedDiscard(coach.action)).toBe(analysis.bestDiscard);
    expect(coach.highlight).toEqual([analysis.bestDiscard]);
    // The usual words, with K2 after them.
    const without = coachAt({ ...view, legal: { discard: costly } } as unknown as PrivatePlayerView);
    expect(textOf(coach.say)).toBe(`${textOf(without.say)}${K2}`);
    expect(visibleLength(textOf(coach.say))).toBeLessThanOrEqual(SAY_BUDGET);
  });

  it('fits K2 in this order: full reason, then short reason, each with the one-tile-to-go clause, before K2 is dropped', () => {
    // 'Discard 3 Characters: ' is 22 characters, K2 47, and the bubble takes 105.
    const long: Reason = { full: ['Monty Wriggly Snake v2 only needs two of them'], short: ["you've got a spare"] };
    const mid: Reason = { full: ['Goulash has no use for it'], short: ['your hand has no use for it'] };
    const wait = ' One tile to go: you need 3 Dots or 6 Dots.';
    const out = ' One tile to go, but every tile that finishes it is already out.';
    const said = (reason: Reason, progress: string) => textOf(discardLine('m3', reason, progress, true));
    // 1. The full reason and K2 fit.
    expect(said(mid, '')).toBe(`Discard 3 Characters: Goulash has no use for it.${K2}`);
    // 2. The full reason with K2 is too long, the short one with K2 isn't: K2 stays, rather than the full reason without it.
    expect(visibleLength(`Discard 3 Characters: ${long.full[0]}.${K2}`)).toBeGreaterThan(SAY_BUDGET);
    expect(said(long, '')).toBe(`Discard 3 Characters: you've got a spare.${K2}`);
    // 3. Neither fits with K2 and the clause: the full reason and the clause.
    expect(said(mid, wait)).toBe(`Discard 3 Characters: Goulash has no use for it.${wait}`);
    // 4. Then the short reason and the clause.
    expect(said(long, wait)).toBe(`Discard 3 Characters: you've got a spare.${wait}`);
    // 5. Then the short reason alone.
    expect(said(mid, out)).toBe('Discard 3 Characters: your hand has no use for it.');
    for (const [reason, progress] of [
      [long, ''],
      [mid, ''],
      [long, wait],
      [mid, wait],
    ] as const)
      expect(visibleLength(said(reason, progress))).toBeLessThanOrEqual(SAY_BUDGET);
    // With no kong to warn off, K2 is never tried.
    expect(textOf(discardLine('m3', long, '', false))).toBe(`Discard 3 Characters: ${long.full[0]}.`);
  });

  it('says it after a switch line too', () => {
    const view = kongView('E', 1, costly, ['s3']);
    const lead = analyseFor(view, karachi).candidates[0]!;
    const mark: PlanMark = {
      game: 'g',
      hand: view.progress.handIndex,
      patternId: lead.patternId,
      title: titleOf(lead),
      switched: { fromId: 'karachi.east.hoveringAngel', fromTitle: 'Hovering Angel', toldAt: 5 },
    };
    const coach = coachAt(view, { mark });
    expect(coach.planSwitch).not.toBeNull();
    expect(textOf(coach.say)).toMatch(/^Discard .+\. Switching to .+ Don't press Kong: it would set your hand back\.$/);
    expect(visibleLength(textOf(coach.say))).toBeLessThanOrEqual(SAY_BUDGET);
  });

  it('holds a plan switch due on a turn it advises a free kong back for the next turn, which says it', () => {
    // East hand 2: the goulash tiles make Pung + 5 Honours, and their four 2 Bamboo cost nothing to kong. The view
    // before was on another plan, and nothing has told the switch yet.
    const view = kongView('E', 1, free, ['s2']);
    const analysis = analyseFor(view, karachi);
    const lead = analysis.candidates[0]!;
    const other = karachi.handSpec(view.progress).patterns.find((p) => titleOf(p) !== titleOf(lead))!;
    const before: PlanMark = { game: 'g', hand: view.progress.handIndex, patternId: other.id, title: titleOf(other), switched: null };
    expect(kongTip({ view, ruleset: karachi, analysis, stage: 'learning', firstLook: false })).toBe('s2');
    expect(tellsSwitch({ view, ruleset: karachi, analysis, stage: 'learning', firstLook: false })).toBe(false);
    // The hook's order: the mark after the view, then the tutor's words on it.
    const onKong = nextPlanMark(before, 'g', view, lead, tellsSwitch({ view, ruleset: karachi, analysis, stage: 'learning', firstLook: false }));
    expect(onKong?.switched).toEqual({ fromId: other.id, fromTitle: titleOf(other), toldAt: null });
    const kong = coachAt(view, { mark: onKong!, analysis });
    expect(kong.action.kind).toBe('kong');
    expect(kong.planSwitch).toBeNull();
    expect(textOf(kong.say)).toMatch(/^Kong 2 Bamboo: /);
    // The replacement draw: her turn again, with no kong on offer. The switch is told there.
    const drawn = { ...view, seq: 6, legal: { discard: free } } as unknown as PrivatePlayerView;
    const drawnAnalysis = analyseFor(drawn, karachi, lead.patternId);
    const told = nextPlanMark(
      onKong,
      'g',
      drawn,
      drawnAnalysis.candidates[0],
      tellsSwitch({ view: drawn, ruleset: karachi, analysis: drawnAnalysis, stage: 'learning', firstLook: false }),
    );
    expect(told?.switched?.toldAt).toBe(6);
    const next = coachAt(drawn, { mark: told!, analysis: drawnAnalysis });
    expect(next.planSwitch?.from.title).toBe(titleOf(other));
    expect(textOf(next.say)).toMatch(/^Discard [^.]+\. Switching to /);
  });

  it("keeps a first look's aim, and its tile to let go, with a free kong on offer: a lit Kong with nothing said would only puzzle", () => {
    const view = kongView('E', 0, free, ['s2']);
    const coach = coachAt(view, { firstLook: true });
    expect(coach.action).toEqual({ kind: 'discard', tile: analyseFor(view, karachi).bestDiscard });
    expect(textOf(coach.say).startsWith(coach.goal.aim)).toBe(true);
    expect(textOf(coach.say)).not.toContain('Kong');
  });

  it('gives no tile for the Discard button when the tip is to wait, claim, pass or win', () => {
    expect(suggestedDiscard({ kind: 'discard', tile: 'p1' })).toBe('p1');
    expect(suggestedDiscard({ kind: 'kong', tile: 's2', discard: 'DG' })).toBe('DG');
    expect(suggestedDiscard({ kind: 'kong', tile: 's2', discard: null })).toBeNull();
    for (const action of [{ kind: 'wait' }, { kind: 'win' }, { kind: 'pass', tile: 'p1' }, { kind: 'exchange', tiles: ['p1', 'p2', 'p3'] }] as const) {
      expect(suggestedDiscard(action)).toBeNull();
    }
  });

  it('advises exactly the kongs the bots would make, and warns off the rest, over seeded play following the tutor', { timeout: 120_000 }, () => {
    const seen = { advised: 0, warned: 0 };
    // Kong turns are rare: these three hands give six kongs that would cost and four that don't.
    for (const [round, h] of [
      ['N', 0],
      ['W', 6],
      ['E0', 6],
    ] as const) {
      playHand({
        seed: `kong-${round}-${h}`,
        progress: ROUNDS[round],
        dealer: (h % 4) as 0 | 1 | 2 | 3,
        onView: (view) => {
          if (view.phase !== 'turn' || view.turn !== view.me || !view.legal.kong?.length || view.legal.win) return;
          const coach = coachOf(view);
          const where = `${round} ${h} seq ${view.seq} ${view.concealed.join(' ')}: ${textOf(coach.say)}`;
          const bot = analysisBot(view, karachi);
          expect(visibleLength(textOf(coach.say)), where).toBeLessThanOrEqual(SAY_BUDGET);
          if (bot?.type === 'declareKong') {
            expect(coach.action, where).toMatchObject({ kind: 'kong', tile: bot.tile });
            expect(textOf(coach.say), where).toMatch(/^Kong .+: with four of a kind you draw an extra tile, and it costs your hand nothing\.$/);
            seen.advised++;
          } else {
            expect(coach.action.kind, where).toBe('discard');
            expect(textOf(coach.say).endsWith(K2), where).toBe(true);
            seen.warned++;
          }
        },
      });
    }
    // The corpus has to reach both.
    expect(seen.advised).toBeGreaterThan(0);
    expect(seen.warned).toBeGreaterThan(0);
  });
});

describe('the West exchange', () => {
  /** Seat 0 passes the tutor's tiles, then (with `others`) each other seat passes what the bot would. */
  const pass = (state: HandState, tiles: readonly TileKind[], others: boolean): HandState => {
    let s = reduce(state, { type: 'exchange', seat: 0, tiles: [...tiles] }, karachi);
    if (!others) return s;
    for (const seat of [1, 2, 3] as const) {
      const move = analysisBot(viewFor(s, karachi, seat), karachi);
      if (move?.type !== 'exchange') throw new Error('a bot with no exchange');
      s = reduce(s, move, karachi);
    }
    return s;
  };

  it('says which way the pass goes and which pass it is, and the wait after the pass is still the exchange, with nothing said', () => {
    for (let h = 0; h < 3; h++) {
      let state = startHand(karachi, { seed: `west-${h}`, progress: ROUNDS.W, dealer: h as 0 | 1 | 2 });
      for (const expected of [
        { direction: 'right', count: 3, step: 1, of: 3 },
        { direction: 'across', count: 3, step: 2, of: 3 },
        { direction: 'left', count: 3, step: 3, of: 3 },
      ] as const) {
        const coach = coachOf(viewFor(state, karachi, 0), 'new');
        expect(coach.moment).toBe('exchange');
        if (coach.action.kind !== 'exchange') throw new Error('an exchange view with no exchange tip');
        expect(coach.action.step).toEqual(expected);
        expect(coach.action.tiles).toHaveLength(3);
        // Passed, and the others haven't: not the hand-start bubble, whose footnotes would be spent under the sheet.
        const waiting = pass(state, coach.action.tiles, false);
        const view = viewFor(waiting, karachi, 0);
        expect(view.phase).toBe('preplay');
        expect(view.legal.exchange).toBeUndefined();
        for (const stage of ['new', 'learning', 'solid'] as const) {
          const wait = coachOf(view, stage);
          expect(wait.moment).toBe('exchange');
          expect(wait.action).toEqual({ kind: 'wait' });
          expect(wait.say).toEqual([]);
          expect(wait.highlight).toEqual([]);
          expect(lessonFor(wait, new Set()).notes).toEqual([]);
        }
        state = pass(state, coach.action.tiles, true);
      }
      // Play starts after the third pass: the dealer's first turn, and the round's aim comes then.
      expect(state.phase).toBe('turn');
    }
  });
});
