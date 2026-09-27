/** Coach regressions: `pnpm --filter @society/web test`. */
import { describe, expect, it } from 'vitest';
import {
  ROUND_WINDS,
  countOf,
  isDragonTile,
  isWindTile,
  karachi,
  tileName,
  type GameProgress,
  type PrivatePlayerView,
  type TileKind,
  type Wind,
} from '@society/engine';
import { analyseFor, coachFor, runNoteApplies } from './coach';
import { goalFor } from './goal';
import { hasWrittenShape } from './shape';

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
    players: [{ seat: 0, seatWind: 'E', melds: [], concealed: tiles, discards: [] }],
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

  it('keeps quiet while someone else is on the move', () => {
    const tiles: TileKind[] = ['s4', 's5', 'p2', 'p3', 'p4', 'm6', 'm7', 'WE', 'WS', 'WW', 'WN', 'WN', 'm1'];
    const view = waitingView('E', 1, tiles, 's6');
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    expect(coach.moment).toBe('waiting');
    expect(coach.say).toEqual([]);
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
