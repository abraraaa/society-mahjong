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
import { analyseFor, coachFor, runNoteApplies, shortOfLine, washoutLine } from './coach';
import { GLOSSARY } from './glossary';
import { goalFor } from './goal';
import { hasWrittenShape, titleOf } from './shape';
import { stripGroups } from './strip';
import { NOTE_BUDGET, lessonFor, noteText } from './teach';
import { NAMES as LONG_NAMES, ROUNDS, coachOf, playHand } from './test-games';
import type { CoachSegment, CoachState } from './types';
import { SAY_BUDGET, textOf, visibleLength } from './words';

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

/** The words the tutor never says: engineering words, and the stiff forms of words it contracts. */
const BANNED = [/\baway\b/, /coach/i, /\b(is not|cannot|do not|does not|it is|that is)\b/];

describe('hand names, wherever the tutor says them', () => {
  it('names every hand as a tappable hand, keeps within the bubble, and speaks plainly, at every moment of seeded play', { timeout: 120_000 }, () => {
    const seen = { exchange: 0, claimed: 0, otherWins: 0, washouts: 0 };
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
    // The corpus has to reach the lines it's checking: X1 and X2 in West, a claim, someone else's win, a washout.
    expect(seen.exchange).toBeGreaterThan(0);
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
