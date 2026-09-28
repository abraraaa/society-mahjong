import { describe, expect, it } from 'vitest';
import {
  ROUND_WINDS,
  guideTiles,
  karachi,
  type GameProgress,
  type HandAnalysis,
  type HandState,
  type LayoutGroup,
  type MatchCtx,
  type Pattern,
  type PatternCandidate,
  type PrivatePlayerView,
  type Ruleset,
  type TileKind,
  type Wind,
} from '@society/engine';
import { analyseFor, coachFor } from './coach';
import { cardCaption, cardTileSize, exampleRef, handsThisRound, resolveHandRef, winnerRef, yoursRef } from './hand-card';
import { noteShapeOf } from './shape';
import { heldOf, stripGroups } from './strip';
import { NAMES, ROUNDS, playHand } from './test-games';
import type { CoachHandRef, CoachSegment, CoachState } from './types';

const EAST: GameProgress = ROUNDS.E1;
const eastSpec = karachi.handSpec(EAST);
const goulash = karachi.handSpec(ROUNDS.E0).patterns[0]!;
const ctx = (seatWind: Wind = 'E', roundWind: Wind = 'E'): MatchCtx => ({ seatWind, roundWind });

/** Every tile of a lay-out, in its sets. */
const tilesOf = (layout: readonly LayoutGroup[]) => layout.flatMap((g) => g.tiles);

/** Every spec the ruleset deals: the opening goulash, East's honour hands, South, West and North. */
const DEALT = Object.values(ROUNDS).map((p) => ({ progress: p, spec: karachi.handSpec(p) }));

/** Karachi without its examples or aliases, as another ruleset might be. A ruleset of its own id, so the memo of Karachi's examples can't answer for it. */
function without(...keys: ('examples' | 'aliases')[]): Ruleset {
  const out = Object.fromEntries(Object.entries(karachi).filter(([k]) => !keys.includes(k as 'examples'))) as unknown as Ruleset;
  return keys.includes('examples') ? { ...out, id: 'hongkong' } : out;
}

describe('yoursRef', () => {
  const candidate = (layout: readonly LayoutGroup[] | null): PatternCandidate => ({
    patternId: goulash.id,
    name: goulash.name,
    away: 3,
    needs: [],
    needsClaimable: [],
    needsFromWall: [],
    using: [],
    usingConcealed: [],
    approximate: true,
    layout,
  });

  it("is the player's own lay-out, with how far they have to go", () => {
    const layout = exampleRef(goulash, karachi, ctx())!.layout;
    const ref = yoursRef(candidate(layout), [goulash], karachi, ctx());
    expect(ref).toMatchObject({ patternId: goulash.id, title: 'Goulash', whose: 'yours', away: 3, approximate: true });
    expect(ref.layout).toBe(layout);
    expect(yoursRef(candidate(layout), [goulash], karachi, ctx(), 'ifClaimed').whose).toBe('ifClaimed');
  });

  it('falls back to the example when the search found no lay-out', () => {
    const ref = yoursRef(candidate(null), [goulash], karachi, ctx());
    expect(ref).toBe(exampleRef(goulash, karachi, ctx()));
    expect(ref.whose).toBe('example');
    expect(tilesOf(ref.layout)).toHaveLength(14);
  });

  it('keeps the title and shape alone for a ruleset with no examples', () => {
    const ref = yoursRef(candidate(null), [goulash], without('examples'), ctx());
    expect(ref).toMatchObject({ title: 'Goulash', whose: 'yours', layout: [] });
    expect(ref.shape).not.toBe('');
  });
});

describe('exampleRef', () => {
  it('lays out a complete hand, every tile held, for every pattern the ruleset deals, whatever the seat wind', () => {
    for (const { progress, spec } of DEALT) {
      for (const seatWind of ROUND_WINDS) {
        for (const p of spec.patterns) {
          const ref = exampleRef(p, karachi, ctx(seatWind, progress.roundWind));
          expect(ref, p.id).not.toBeNull();
          expect(ref!.whose).toBe('example');
          const tiles = tilesOf(ref!.layout);
          expect(tiles, `${p.id} for ${seatWind}`).toHaveLength(14);
          expect(tiles.every((t) => t.held)).toBe(true);
        }
      }
    }
  });

  it('is worked out once', () => {
    expect(exampleRef(goulash, karachi, ctx('S'))).toBe(exampleRef(goulash, karachi, ctx('S')));
  });

  it('shows an alias the example of the hand it is announced under', () => {
    for (const [alias, named] of Object.entries(karachi.aliases!)) {
      const p = eastSpec.patterns.find((x) => x.id === alias)!;
      const ref = exampleRef(p, karachi, ctx())!;
      expect(ref.patternId).toBe(alias);
      expect(
        tilesOf(ref.layout)
          .map((t) => t.kind)
          .sort(),
      ).toEqual([...karachi.examples![named]!].sort());
    }
  });

  it('is null for a ruleset with no examples', () => {
    expect(exampleRef(goulash, without('examples'), ctx())).toBeNull();
  });
});

describe('winnerRef', () => {
  it('lays out a winner’s hand: every tile held, 14 plus one per kong, sets laid face up first', { timeout: 120_000 }, () => {
    // Finished hands from seeded play: goulashes, which are quick to play and often won, and South.
    const wins: HandState[] = [];
    for (const [name, progress] of Object.entries({ E0: ROUNDS.E0, W: ROUNDS.W, S: ROUNDS.S })) {
      for (let h = 0; h < (name === 'S' ? 3 : 10); h++) {
        const s = playHand({ seed: `winner-${name}-${h}`, progress, dealer: (h % 4) as 0 | 1 | 2 | 3 });
        if (s.result?.type === 'win') wins.push(s);
      }
    }
    expect(wins.length).toBeGreaterThan(3);
    // The seeds include sets laid face up, a kong among them, so "face up first" and "one more per kong" are really tried.
    expect(wins.some((s) => s.result?.type === 'win' && s.players[s.result.winner].melds.some((m) => m.type === 'kong'))).toBe(true);
    for (const s of wins) {
      if (s.result?.type !== 'win') continue;
      const { winner, patternId } = s.result;
      const p = s.players[winner];
      const pattern = karachi.handSpec(s.progress).patterns.find((x) => x.id === patternId)!;
      const ref = winnerRef({ concealed: p.concealed, melds: p.melds }, pattern, { seatWind: p.seatWind, roundWind: s.progress.roundWind }, karachi, 'Bilal');
      expect(ref).toMatchObject({ patternId, whose: 'winner', owner: 'Bilal', away: 0 });
      const kongs = p.melds.filter((m) => m.type === 'kong').length;
      const tiles = tilesOf(ref.layout);
      expect(tiles).toHaveLength(14 + kongs);
      expect(tiles.every((t) => t.held)).toBe(true);
      const groups = stripGroups(ref.layout);
      expect(groups.filter((g) => g.exposed)).toHaveLength(p.melds.length);
      expect(groups.slice(0, p.melds.length).every((g) => g.exposed)).toBe(true);
    }
  });

  // A goulash pung of an honour needs two of: a dragon pung, the round's wind, your own wind.
  const seatWindPung = guideTiles('S S S | R R R | 1c 1c 1c | 2d 2d 2d | 5b 5b');

  it("reads the winner's own seat wind, so their hand isn't swapped for the example", () => {
    const ref = winnerRef({ concealed: seatWindPung, melds: [] }, goulash, ctx('S', 'E'), karachi, 'Bilal');
    expect(ref.whose).toBe('winner');
    // The same tiles under someone else's seat wind aren't a goulash: the card falls back to the example, keeping whose it is.
    const other = winnerRef({ concealed: seatWindPung, melds: [] }, goulash, ctx('E', 'E'), karachi, 'Bilal');
    expect(other).toMatchObject({ whose: 'example', owner: 'Bilal' });
  });

  it("gives the result sheet the winner's hand, read with the winner's winds", () => {
    const tiles: TileKind[] = guideTiles('1b 2b 3b | 4d 5d 6d | 7c 7c | E E | N N W');
    const view = {
      ...finishedView(ROUNDS.E0, tiles),
      revealed: { 1: seatWindPung },
      result: { type: 'win', winner: 1, patternId: goulash.id, selfDrawn: true, settlement: {} },
    } as unknown as PrivatePlayerView;
    const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
    const ref = coach.outcome?.hand?.ref;
    expect(ref).toMatchObject({ whose: 'winner', owner: 'Bilal' });
    expect(coach.say.find((s) => s.hand)?.hand).toBe(ref);
  });
});

/** A finished hand seen by seat 0 (East); seat 1 is South. */
function finishedView(progress: GameProgress, concealed: readonly TileKind[]): PrivatePlayerView {
  const winds: Wind[] = ['E', 'S', 'W', 'N'];
  return {
    progress,
    me: 0,
    concealed,
    players: winds.map((seatWind, seat) => ({ seat, seatWind, melds: [], discards: [], bonus: [] })),
    phase: 'finished',
    turn: 0,
    legal: {},
    lastDiscard: null,
    result: { type: 'draw' },
    revealed: {},
    events: [],
  } as unknown as PrivatePlayerView;
}

describe('handsThisRound', () => {
  const empty: HandAnalysis = { candidates: [], keep: [], spare: [], bestDiscard: null, ratings: [] };

  it('has one chip per title, the general hands first, and never shows an alias its own example', () => {
    const hands = handsThisRound(eastSpec, empty, karachi, ctx());
    const titles = hands.map((h) => h.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.slice(0, 2)).toEqual(['Chow + 5 Honours', 'Pung + 5 Honours']);
    expect(titles.filter((t) => t === 'Apple Blossom')).toHaveLength(1);
    expect(hands.every((h) => h.whose === 'example')).toBe(true);
    for (const h of hands) expect(Object.keys(karachi.aliases!)).not.toContain(h.patternId);
    // One chip for each distinct title the round deals.
    expect(new Set(eastSpec.patterns.map((p) => p.localName ?? p.name)).size).toBe(hands.length);
  });

  it("shows the player's own lay-out for a hand among their nearest", () => {
    const view = { ...finishedView(EAST, guideTiles('4b 5b 6b | 2d 3d 4d | 6c 7c | E S W N N')), phase: 'turn' } as unknown as PrivatePlayerView;
    const analysis = analyseFor(view, karachi);
    const hands = handsThisRound(eastSpec, analysis, karachi, ctx());
    const lead = analysis.candidates.find((c) => c.layout)!;
    const chip = hands.find((h) => h.title === (lead.localName ?? lead.name))!;
    expect(chip).toMatchObject({ whose: 'yours', patternId: lead.patternId, away: lead.away });
  });

  it('works for a ruleset with no aliases or no examples', () => {
    expect(handsThisRound(eastSpec, empty, without('aliases'), ctx()).length).toBeGreaterThan(0);
    const bare = handsThisRound(eastSpec, empty, without('aliases', 'examples'), ctx());
    expect(bare.every((h) => h.layout.length === 0 && h.whose === 'example')).toBe(true);
  });

  it('is the one goulash in a goulash round', () => {
    expect(handsThisRound(karachi.handSpec(ROUNDS.W), empty, karachi, ctx('E', 'W')).map((h) => h.title)).toEqual(['Goulash']);
  });
});

describe('resolveHandRef', () => {
  const ref = (patternId: string, whose: CoachHandRef['whose'], away: number, title = 'Goulash'): CoachHandRef => ({
    patternId,
    title,
    shape: '',
    whose,
    away,
    layout: [],
    note: '',
  });
  /** Enough of the tutor's state for the card: where its `yours` refs live. */
  const coach = (refs: { target?: CoachHandRef; runnerUp?: CoachHandRef; hands?: CoachHandRef[]; say?: CoachSegment[] }): CoachState =>
    ({
      target: refs.target ? { hand: refs.target } : null,
      runnerUp: refs.runnerUp ? { hand: refs.runnerUp } : null,
      goal: { hands: refs.hands ?? [] },
      say: refs.say ?? [],
    }) as unknown as CoachState;

  it("leaves a winner's card alone, even for the pattern the player was building", () => {
    const won = ref(goulash.id, 'winner', 0);
    expect(resolveHandRef(coach({ target: ref(goulash.id, 'yours', 2) }), won)).toBe(won);
  });

  it('leaves the hand after a claim alone', () => {
    const claimed = ref(goulash.id, 'ifClaimed', 1);
    expect(resolveHandRef(coach({ target: ref(goulash.id, 'yours', 4) }), claimed)).toBe(claimed);
  });

  it("follows the player's hand as it changes", () => {
    const now = ref('karachi.east.windyChows', 'yours', 2, 'Windy Chows');
    const opened = ref('karachi.east.windyChows', 'yours', 4, 'Windy Chows');
    expect(resolveHandRef(coach({ runnerUp: now }), opened)).toBe(now);
    expect(resolveHandRef(coach({ say: [{ text: 'Windy Chows', hand: now }] }), opened)).toBe(now);
  });

  it('follows the title when that pattern has gone, and stays as opened when the title has too', () => {
    const opened = ref('karachi.east.chows.each.news', 'yours', 3, 'Chow + 5 Honours');
    const sameTitle = ref('karachi.east.chows.clean.news', 'yours', 2, 'Chow + 5 Honours');
    expect(resolveHandRef(coach({ hands: [sameTitle] }), opened)).toBe(sameTitle);
    expect(resolveHandRef(coach({ target: ref('karachi.east.monty', 'yours', 5, 'Monty') }), opened)).toBe(opened);
  });

  it('never follows an example', () => {
    const opened = ref(goulash.id, 'yours', 3);
    expect(resolveHandRef(coach({ target: ref(goulash.id, 'example', 0) }), opened)).toBe(opened);
  });
});

describe('the card', () => {
  const north = karachi.handSpec(ROUNDS.N);
  const byId = (id: string): Pattern => north.patterns.find((p) => p.id === id)!;

  it('uses smaller tiles when a set is longer than seven', () => {
    expect(cardTileSize(exampleRef(byId('karachi.north.runPungPair'), karachi, ctx('E', 'N'))!)).toBe('xs');
    expect(cardTileSize(exampleRef(byId('karachi.north.fourBlessings'), karachi, ctx('E', 'N'))!)).toBe('sm');
  });

  it('says whose tiles they are, and what is still to find', () => {
    const layout = exampleRef(goulash, karachi, ctx())!.layout;
    const card = (whose: CoachHandRef['whose'], extra: Partial<CoachHandRef> = {}): CoachHandRef => ({
      patternId: goulash.id,
      title: 'Goulash',
      shape: '',
      whose,
      layout,
      note: '',
      ...extra,
    });
    expect(cardCaption(card('yours', { away: 4 }))?.text).toBe('The bright tiles are yours; the faded ones you still need. Four tiles to go.');
    expect(cardCaption(card('yours', { away: 4, approximate: true }))?.text).toBe('The bright tiles are yours; the faded ones you still need. About four tiles to go.');
    expect(cardCaption(card('yours', { away: 0 }))?.text).toBe("Every tile's yours. That's the hand, complete.");
    expect(cardCaption(card('ifClaimed', { away: 1 }))?.text).toBe('If you take it, the bright tiles are yours: one tile to go.');
    expect(cardCaption(card('ifClaimed', { away: 0 }))?.text).toBe("Take it and every tile's yours: that's the hand, complete.");
    expect(cardCaption(card('winner', { owner: 'Sana' }))).toEqual({ name: 'Sana', text: "'s winning hand." });
    expect(cardCaption(card('winner', { owner: 'You' }))).toEqual({ text: 'Your winning hand.' });
    expect(cardCaption(card('example', { owner: 'Sana' }))?.text).toBe('One way it can look.');
    expect(cardCaption(card('example', { layout: [] }))).toBeNull();
    expect(heldOf(stripGroups(layout))).toEqual({ held: 14, total: 14 });
  });
});

describe("every hand's footnote", () => {
  it('rides on every card the tutor can open, the same line wherever the hand is named', { timeout: 120_000 }, () => {
    const empty: HandAnalysis = { candidates: [], keep: [], spare: [], bestDiscard: null, ratings: [] };
    let seen = 0;
    const check = (ref: CoachHandRef, patterns: readonly Pattern[], where: string) => {
      expect(ref.note, `${where}: ${ref.title}`).toBe(noteShapeOf(ref.title, patterns));
      expect(ref.note, `${where}: ${ref.title}`).not.toBe('');
      seen++;
    };
    for (const { progress, spec } of DEALT) {
      const c = ctx('S', progress.roundWind);
      for (const p of spec.patterns) check(exampleRef(p, karachi, c)!, spec.patterns, 'example');
      for (const ref of handsThisRound(spec, empty, karachi, c)) check(ref, spec.patterns, 'hands this round');
      // The player's own lay-outs, the hand after a claim, and winners, over seeded play.
      playHand({
        seed: `notes-${progress.roundWind}-${progress.handInRound}`,
        progress,
        onView: (view) => {
          const coach = coachFor({ view, ruleset: karachi, analysis: analyseFor(view, karachi), stage: 'new', names: NAMES });
          for (const ref of [coach.target?.hand, coach.runnerUp?.hand, ...coach.goal.hands, ...coach.say.map((x) => x.hand), coach.outcome?.hand?.ref]) {
            if (ref) check(ref, spec.patterns, `seq ${view.seq} ${coach.moment}`);
          }
        },
      });
    }
    expect(seen).toBeGreaterThan(1000);
  });
});
