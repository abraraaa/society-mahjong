/** Coach regressions: `pnpm --filter @society/web test`. */
import { describe, expect, it } from 'vitest';
import {
  ROUND_WINDS,
  countOf,
  isDragonTile,
  isWindTile,
  karachi,
  startHand,
  tileName,
  viewFor,
  type GameProgress,
  type PrivatePlayerView,
  type TileKind,
  type Wind,
} from '@society/engine';
import { analyseFor, coachFor, runNoteApplies, runTileFor, shortOfLine, washoutLine } from './coach';
import { GLOSSARY } from './glossary';
import { goalFor } from './goal';
import { hasWrittenShape, titleOf } from './shape';
import { stripGroups } from './strip';
import { firstLookFor } from './first-look';
import { NOTE_BUDGET, createLessons, createTaughtStore, lessonFor, lineKey, noteText } from './teach';
import { NAMES as LONG_NAMES, ROUNDS, coachOf, playHand } from './test-games';
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

  it('says so at a claim when the tile would make a run the plan wants, and marks the rule said', () => {
    // Chow + 5 Honours two tiles off, both 6 Bamboo in its runs: a pung of the third is legal, and does the hand no good.
    const tiles: TileKind[] = ['s4', 's5', 's6', 's6', 's7', 's7', 's8', 's8', 'WE', 'WS', 'WW', 'WN', 'm1'];
    const view = { ...waitingView('E', 1, tiles, 's6'), legal: { claims: [{ type: 'pung', tiles: ['s6', 's6'] }], pass: true } } as unknown as PrivatePlayerView;
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    expect(coach.action.kind).toBe('pass');
    expect(textOf(coach.say)).toBe("Chow + 5 Honours wants that tile in a run, and you can't claim for a run here. Pass.");
    expect(coach.teach).toContainEqual(expect.objectContaining({ key: 'rule:runs', place: 'said' }));
    // So the sheet teaches the rule, and no footnote says it again this visit.
    expect(lessonFor(coach, new Set()).marks).toContain('rule:runs');
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
    const seen = { exchange: 0, claimed: 0, otherWins: 0, washouts: 0, runs: 0 };
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
    expect(seen.claimed).toBeGreaterThan(0);
    expect(seen.otherWins).toBeGreaterThan(0);
    expect(seen.washouts).toBeGreaterThan(0);
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

  it("doesn't hide a Mahjong", () => {
    const won: TileKind[] = ['m1', 'm1', 'm1', 'p7', 'p7', 'p7', 'm4', 'm4', 'm4', 's2', 's2', 's2', 's9', 's9'];
    const view = { ...turnView('E', 0, won), legal: { discard: won, win: true } } as unknown as PrivatePlayerView;
    const coach = coachAt(view, true);
    expect(coach.action.kind).toBe('win');
    expect(textOf(coach.say)).toBe("That's Goulash, complete. Call Mahjong!");
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
