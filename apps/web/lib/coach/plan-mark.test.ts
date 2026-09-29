import { describe, expect, it } from 'vitest';
import type { PatternCandidate, PrivatePlayerView } from '@society/engine';
import { isTurnView, nextPlanMark, preferFor, samePlanMark, type PlanMark } from './plan-mark';

/** Enough of a view for the mark: which hand, which view, and whether it's the player's turn to discard. */
function view(seq: number, over: { hand?: number; turn?: boolean; win?: boolean } = {}): PrivatePlayerView {
  const turn = over.turn ?? false;
  return {
    progress: { roundWind: 'E', roundIndex: 0, handInRound: 1, handIndex: over.hand ?? 1 },
    me: 0,
    seq,
    phase: turn ? 'turn' : 'claim',
    turn: turn ? 0 : 1,
    legal: turn ? { discard: ['s1'], ...(over.win ? { win: true } : {}) } : {},
  } as unknown as PrivatePlayerView;
}

/** A leading candidate: only its id and its title matter here. */
const lead = (patternId: string, name: string): PatternCandidate => ({ patternId, name }) as unknown as PatternCandidate;
const A = lead('karachi.east.appleBlossom', 'Apple Blossom');
const A2 = lead('karachi.east.appleBlossom.chows', 'Apple Blossom');
const B = lead('karachi.east.chows.each.pungPair', 'Chow + 5 Honours');
const C = lead('karachi.east.windyChows', 'Windy Chows');

/** Plays a run of views through the mark, as the hook would see them, and returns each mark. */
function play(steps: readonly [PrivatePlayerView, PatternCandidate | undefined][], game: string | number = 'g1', start: PlanMark | null = null): (PlanMark | null)[] {
  let mark = start;
  return steps.map(([v, leader]) => (mark = nextPlanMark(mark, game, v, leader)));
}

describe('the plan the tutor holds the player to', () => {
  it('starts afresh with a new hand or a new game', () => {
    const [first] = play([[view(3), A]]);
    expect(first).toEqual({ game: 'g1', hand: 1, patternId: A.patternId, title: 'Apple Blossom', switched: null });
    const switched = { ...first!, switched: { fromId: C.patternId, fromTitle: 'Windy Chows', toldAt: null } };
    expect(nextPlanMark(switched, 'g1', view(1, { hand: 2 }), B)).toEqual({ game: 'g1', hand: 2, patternId: B.patternId, title: 'Chow + 5 Honours', switched: null });
    expect(nextPlanMark(switched, 'g2', view(4), B)).toEqual({ game: 'g2', hand: 1, patternId: B.patternId, title: 'Chow + 5 Honours', switched: null });
    // A new hand with nothing to plan has no mark, rather than the last hand's.
    expect(nextPlanMark(switched, 'g1', view(1, { hand: 2 }), undefined)).toBeNull();
  });

  it('keeps the mark, as the same object, when there is no leader or nothing changed', () => {
    const [mark] = play([[view(3), A]]);
    expect(nextPlanMark(mark!, 'g1', view(4), undefined)).toBe(mark);
    expect(nextPlanMark(mark!, 'g1', view(4, { turn: true }), A)).toBe(mark);
  });

  it('keeps the plan in front only within its own game and hand', () => {
    const [mark] = play([[view(3), A]]);
    expect(preferFor(mark!, 'g1', view(9))).toBe(A.patternId);
    expect(preferFor(mark!, 'g2', view(9))).toBeUndefined();
    expect(preferFor(mark!, 'g1', view(1, { hand: 2 }))).toBeUndefined();
    expect(preferFor(null, 'g1', view(9))).toBeUndefined();
  });

  it('follows another pattern of the same title, and keeps what it has to tell', () => {
    const marks = play([
      [view(3, { turn: true }), C],
      [view(4), A],
      [view(5), A2],
    ]);
    expect(marks[2]).toMatchObject({ patternId: A2.patternId, title: 'Apple Blossom', switched: { fromId: C.patternId, fromTitle: 'Windy Chows', toldAt: null } });
  });

  it('records a switch off the turn, tells it on the next turn view, and keeps that turn as the one that told it', () => {
    const marks = play([
      [view(3, { turn: true }), A],
      [view(4), B],
      [view(8, { turn: true }), B],
      [view(9), B],
      [view(12, { turn: true }), B],
    ]);
    expect(marks[1]!.switched).toEqual({ fromId: A.patternId, fromTitle: 'Apple Blossom', toldAt: null });
    expect(marks[2]!.switched).toEqual({ fromId: A.patternId, fromTitle: 'Apple Blossom', toldAt: 8 });
    expect(marks[3]!.switched?.toldAt).toBe(8);
    expect(marks[4]!.switched?.toldAt).toBe(8);
    // The same turn fetched again (a poll, a retry) is the same view, so it still tells it.
    expect(nextPlanMark(marks[2]!, 'g1', view(8, { turn: true }), B)).toBe(marks[2]);
  });

  it('tells a change on the turn view it happens on', () => {
    const marks = play([
      [view(3, { turn: true }), A],
      [view(7, { turn: true }), B],
    ]);
    expect(marks[1]!.switched).toEqual({ fromId: A.patternId, fromTitle: 'Apple Blossom', toldAt: 7 });
  });

  it("doesn't count a winning turn, which has no discard to make, as the turn that tells it", () => {
    const marks = play([
      [view(3, { turn: true }), A],
      [view(7, { turn: true, win: true }), B],
    ]);
    expect(marks[1]!.switched?.toldAt).toBeNull();
    expect(isTurnView(view(7, { turn: true, win: true }))).toBe(false);
    expect(isTurnView(view(7, { turn: true }))).toBe(true);
    expect(isTurnView(view(7))).toBe(false);
  });

  it("leaves a switch untold on a turn view whose bubble can't say it (a kong tip), for the next turn view to tell", () => {
    const [before] = play([[view(3, { turn: true }), A]]);
    const onKong = nextPlanMark(before!, 'g1', view(7, { turn: true }), B, false);
    expect(onKong!.switched).toEqual({ fromId: A.patternId, fromTitle: 'Apple Blossom', toldAt: null });
    expect(nextPlanMark(onKong!, 'g1', view(8, { turn: true }), B, true)!.switched?.toldAt).toBe(8);
    // Told already, a turn that can't say it changes nothing.
    const told = nextPlanMark(before!, 'g1', view(7, { turn: true }), B);
    expect(nextPlanMark(told!, 'g1', view(8, { turn: true }), B, false)).toBe(told);
  });

  it('says a switch from A to B to C before a turn as from A, and nothing when it comes back to A', () => {
    const twice = play([
      [view(3, { turn: true }), A],
      [view(4), B],
      [view(5), C],
      [view(8, { turn: true }), C],
    ]);
    expect(twice[3]!.switched).toEqual({ fromId: A.patternId, fromTitle: 'Apple Blossom', toldAt: 8 });
    const back = play([
      [view(3, { turn: true }), A],
      [view(4), B],
      [view(5), A2],
      [view(8, { turn: true }), A2],
    ]);
    expect(back[2]!.switched).toBeNull();
    expect(back[3]).toMatchObject({ patternId: A2.patternId, switched: null });
  });

  it('starts a new switch from the plan already told', () => {
    const marks = play([
      [view(3, { turn: true }), A],
      [view(7, { turn: true }), B],
      [view(8), C],
    ]);
    expect(marks[2]!.switched).toEqual({ fromId: B.patternId, fromTitle: 'Chow + 5 Honours', toldAt: null });
  });

  it('compares marks by what they say', () => {
    const [mark] = play([[view(3), A]]);
    expect(samePlanMark(mark!, { ...mark! })).toBe(true);
    expect(samePlanMark(mark!, null)).toBe(false);
    expect(samePlanMark(null, null)).toBe(true);
    expect(samePlanMark(mark!, { ...mark!, patternId: A2.patternId })).toBe(false);
    expect(samePlanMark(mark!, { ...mark!, hand: 2 })).toBe(false);
    const told = { ...mark!, switched: { fromId: C.patternId, fromTitle: 'Windy Chows', toldAt: null } };
    expect(samePlanMark(mark!, told)).toBe(false);
    expect(samePlanMark(told, { ...told, switched: { ...told.switched, toldAt: 5 } })).toBe(false);
  });
});
