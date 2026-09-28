import { describe, expect, it } from 'vitest';
import {
  SEATS,
  createRng,
  karachi,
  reduce,
  startHand,
  suitTile,
  viewFor,
  type Action,
  type LayoutGroup,
  type Num,
  type PrivatePlayerView,
  type Suit,
  type SuitTile,
  type TileKind,
} from '@society/engine';
import { LONG_NAME, ROUNDS } from './test-games';
import {
  NOTE_BUDGET,
  countWord,
  drawnSince,
  flowerSinceMyLastMove,
  isLoner,
  isolate,
  missedRunNote,
  myDiscardCount,
  orList,
  passedSince,
  planCount,
  tilesWord,
  visibleLength,
  waitList,
} from './words';

describe('the words the tutor counts in', () => {
  it('spells out small numbers and counts tiles, never "away"', () => {
    expect(countWord(1)).toBe('one');
    expect(countWord(10)).toBe('ten');
    expect(countWord(11)).toBe('11');
    expect(tilesWord(1)).toBe('one tile');
    expect(tilesWord(3)).toBe('three tiles');
  });

  it('writes the plan line short, with digits', () => {
    expect(planCount(0, false)).toBe('complete');
    expect(planCount(1, false)).toBe('1 tile to go');
    expect(planCount(7, false)).toBe('7 tiles to go');
    expect(planCount(7, true)).toBe('about 7 tiles to go');
  });

  it('lists what would finish a hand the way a player says it', () => {
    expect(orList(['a'])).toBe('a');
    expect(orList(['a', 'b', 'c'])).toBe('a, b or c');
    expect(waitList(['m9', 'm3', 'm6'])).toBe('3, 6 or 9 Characters');
    expect(waitList(['s2', 'WE'])).toBe('2 Bamboo or East Wind');
    expect(waitList(['p1'])).toBe('1 Dot');
  });

  it('knows a tile on its own from one with neighbours', () => {
    expect(isLoner(['m1', 's5', 'WE'], 'WE')).toBe(true);
    expect(isLoner(['m1', 's5', 's7'], 's5')).toBe(false);
    expect(isLoner(['m1', 's5', 's9'], 's5')).toBe(true);
    expect(isLoner(['s5', 's5'], 's5')).toBe(false);
  });

  it('counts only the player’s own discards this hand', () => {
    const events = [
      { seq: 1, type: 'discarded', seat: 1 as const, tile: 'm1' as const },
      { seq: 2, type: 'discarded', seat: 0 as const, tile: 'm2' as const },
    ];
    expect(myDiscardCount({ me: 0, events })).toBe(1);
    expect(myDiscardCount({ me: 2, events })).toBe(0);
  });
});

describe('visible length', () => {
  it('counts what a reader sees: the isolates round a name take no room', () => {
    expect(visibleLength('Sana wins')).toBe(9);
    expect(visibleLength(`${isolate('Sana')} wins`)).toBe(9);
    expect(`${isolate('Sana')} wins`.length).toBe(11);
    expect(visibleLength('')).toBe(0);
  });
});

describe('a flower since the player last moved', () => {
  const ev = (seq: number, type: string, seat: 0 | 1, tile = 'm1' as const) => ({ seq, type, seat, tile });
  const flower = (...events: ReturnType<typeof ev>[]) => flowerSinceMyLastMove({ me: 0, events });

  it('counts a flower drawn after the last discard, claim or kong', () => {
    expect(flower(ev(1, 'discarded', 0), ev(2, 'bonus', 0))).toBe(true);
    expect(flower(ev(1, 'claimed', 0), ev(2, 'bonus', 0), ev(3, 'replacement', 0))).toBe(true);
    expect(flower(ev(1, 'kong', 0), ev(2, 'bonus', 0))).toBe(true);
  });

  it('counts a flower from the deal until the first move', () => {
    expect(flower(ev(1, 'handStarted', 0), ev(2, 'bonus', 0), ev(3, 'discarded', 1))).toBe(true);
    expect(flower(ev(1, 'bonus', 0), ev(2, 'discarded', 0))).toBe(false);
  });

  it("doesn't count one that's old news, or someone else's", () => {
    expect(flower(ev(1, 'bonus', 0), ev(2, 'claimed', 0))).toBe(false);
    expect(flower(ev(1, 'bonus', 0), ev(2, 'kong', 0))).toBe(false);
    expect(flower(ev(1, 'discarded', 0), ev(2, 'bonus', 1))).toBe(false);
    expect(flower()).toBe(false);
  });
});

/**
 * Every view seat 0 sees in an East honour hand where everyone pungs whatever
 * they can and otherwise throws a random tile: the real reducer's events, with
 * plenty of claims and flowers, and none of the analysis a tutored hand costs.
 */
function grabbyHand(seed: string): PrivatePlayerView[] {
  const random = createRng(`${seed}-moves`).next;
  let s = startHand(karachi, { seed, progress: ROUNDS.E1, dealer: 0 });
  const views = [viewFor(s, karachi, 0)];
  for (let step = 0; step < 400 && s.phase !== 'finished'; step++) {
    const seat = SEATS.find((x) => {
      const l = viewFor(s, karachi, x).legal;
      return !!(l.discard || l.claims);
    });
    if (seat === undefined) break;
    const legal = viewFor(s, karachi, seat).legal;
    const pung = legal.claims?.find((c) => c.type === 'pung');
    const tiles = legal.discard ?? [];
    const action: Action = legal.claims
      ? pung
        ? { type: 'claim', seat, claim: pung }
        : { type: 'pass', seat }
      : { type: 'discard', seat, tile: tiles[Math.floor(random() * tiles.length)]! };
    s = reduce(s, action, karachi);
    views.push(viewFor(s, karachi, 0));
  }
  return views;
}

describe('the tiles that went past the player', () => {
  const views = Array.from({ length: 12 }, (_, i) => grabbyHand(`passed-${i}`)).flat();
  const myTurns = views.filter((v) => v.phase === 'turn' && v.turn === 0);
  const seqs = (v: PrivatePlayerView) => passedSince(v).map((p) => p.seq);
  /** Where in the events the player last discarded, claimed or declared a kong: -1 before their first move. */
  const lastMoveAt = (v: PrivatePlayerView) => {
    for (let i = v.events.length - 1; i >= 0; i--) if (v.events[i]!.seat === 0 && ['discarded', 'claimed', 'kong'].includes(v.events[i]!.type)) return i;
    return -1;
  };

  it('gives an unclaimed discard by the player on the left, once the player has drawn', () => {
    let seen = 0;
    for (const v of myTurns) {
      const [thrown, drew] = v.events.slice(-2);
      if (thrown?.type !== 'discarded' || thrown.seat !== 3 || drew?.type !== 'drew' || drew.seat !== 0) continue;
      expect(passedSince(v)[0]).toEqual({ seat: 3, tile: thrown.tile, seq: thrown.seq });
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('leaves out a discard someone took', () => {
    let seen = 0;
    for (const v of views) {
      const lastMine = lastMoveAt(v);
      v.events.forEach((e, i) => {
        if (i <= lastMine || e.type !== 'discarded' || v.events[i + 1]?.type !== 'claimed') return;
        expect(seqs(v)).not.toContain(e.seq);
        seen++;
      });
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("gives nothing on the player's turn straight after their own pung", () => {
    const afterMyPung = myTurns.filter((v) => v.events.at(-1)?.type === 'claimed' && v.events.at(-1)?.seat === 0);
    expect(afterMyPung.length).toBeGreaterThan(0);
    for (const v of afterMyPung) expect(passedSince(v)).toEqual([]);
  });

  it('keeps a discard across a flower and the tile drawn in its place', () => {
    let seen = 0;
    for (const v of myTurns) {
      const i = v.events.map((e) => e.type).lastIndexOf('discarded');
      const since = v.events.slice(i + 1);
      if (i < 0 || v.events[i]!.seat === 0 || !since.some((e) => e.type === 'bonus' && e.seat === 0) || since.some((e) => e.type === 'claimed')) continue;
      expect(passedSince(v)[0]?.seq).toBe(v.events[i]!.seq);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("only ever holds other seats' discards since the player's own last move, newest first, and nothing still on offer", () => {
    for (const v of views) {
      const passed = passedSince(v);
      const lastMine = v.events[lastMoveAt(v)]?.seq ?? -1;
      for (const p of passed) {
        expect(p.seat).not.toBe(0);
        expect(p.seq).toBeGreaterThan(lastMine);
        expect(v.events.find((e) => e.seq === p.seq)).toMatchObject({ type: 'discarded', seat: p.seat, tile: p.tile });
      }
      expect(passed.map((p) => p.seq)).toEqual([...passed.map((p) => p.seq)].sort((a, b) => b - a));
      if (v.phase === 'claim') expect(seqs(v)).not.toContain(v.events.at(-1)!.seq);
    }
  });

  it("knows the tiles the player drew since a discard: theirs alone, flowers' replacements included", () => {
    const events = [
      { seq: 1, type: 'discarded', seat: 3 as const, tile: 's6' as const },
      { seq: 2, type: 'bonus', seat: 0 as const, tile: 'F1' as const },
      { seq: 3, type: 'replacement', seat: 0 as const, tile: 's5' as const },
      { seq: 4, type: 'drew', seat: 1 as const, tile: 'm1' as const },
    ];
    expect(drawnSince({ me: 0, events }, 1)).toEqual(['s5']);
    expect(drawnSince({ me: 0, events }, 3)).toEqual([]);
  });
});

describe('the footnote for a run tile that went past', () => {
  const SUITS: readonly Suit[] = ['m', 'p', 's'];
  /** A run still to be laid down, from 'p4 p5? p6': a question mark is the tile still to find. */
  const run = (tiles: string): LayoutGroup => ({
    shape: 'run',
    exposed: false,
    open: false,
    tiles: tiles.split(' ').map((x) => ({ kind: x.replace('?', '') as TileKind, held: !x.endsWith('?') })),
  });
  const t = (suit: Suit, n: number): SuitTile => suitTile(suit, n as Num);
  /** Every run a tile could have made, the tile itself the one still to find: a run of three either side or round it, four and nine long, and one across the suits. */
  const runsFor = (kind: SuitTile): LayoutGroup[] => {
    const suit = kind[0] as Suit;
    const n = Number(kind[1]);
    const inSuit = (from: number, to: number) => run(Array.from({ length: to - from + 1 }, (_, i) => `${t(suit, from + i)}${from + i === n ? '?' : ''}`).join(' '));
    const out = [inSuit(Math.min(n, 6), Math.min(n, 6) + 3), inSuit(1, 9)];
    if (n <= 7) out.push(inSuit(n, n + 2));
    if (n >= 2 && n <= 8) out.push(inSuit(n - 1, n + 1));
    if (n >= 3) out.push(inSuit(n - 2, n));
    const [x, y] = SUITS.filter((s) => s !== suit);
    const [a, b] = n <= 7 ? [n + 1, n + 2] : [n - 2, n - 1];
    out.push(run(`${kind}? ${t(x!, a)} ${t(y!, b)}`));
    return out;
  };
  const NAMES = ['Sana', 'Bot', 'Bilal', 'Ayesha', 'Muhammad Abdullah', LONG_NAME];
  const kinds = SUITS.flatMap((suit) => Array.from({ length: 9 }, (_, i) => t(suit, i + 1)));

  it('fits its two lines, for every suit tile, every run it could have made and every name', () => {
    let nameless = 0;
    for (const name of NAMES)
      for (const kind of kinds)
        for (const g of runsFor(kind)) {
          const note = missedRunNote(name, kind, g);
          expect(visibleLength(note), note).toBeLessThanOrEqual(NOTE_BUDGET);
          expect(note).toMatch(/only come from the wall\.$/);
          expect(note).not.toMatch(/^That /);
          if (note.startsWith('A thrown')) nameless++;
        }
    // Long names give way to the lines without one.
    expect(nameless).toBeGreaterThan(0);
  });

  it("names who threw it and the run it would have made, while there's room", () => {
    const sana = isolate('Sana');
    expect(missedRunNote('Sana', 's6', run('s4 s5 s6?'))).toBe(`${sana}'s 6 Bamboo would have finished your 4-5 run, but runs only come from the wall.`);
    // Either side of a two-sided wait: the lay-out wanted 6 Bamboo, and 3 Bamboo finishes the run just the same.
    expect(missedRunNote('Sana', 's3', run('s4 s5 s6?'))).toBe(`${sana}'s 3 Bamboo would have finished your 4-5 run, but runs only come from the wall.`);
    expect(missedRunNote('Sana', 'p5', run('p4 p5? p6'))).toBe(`${sana}'s 5 Dots would have filled your 4-6 run, but runs only come from the wall.`);
    expect(missedRunNote('Sana', 'p7', run('p1 p2 p3 p4 p5 p6 p7? p8 p9'))).toBe(`${sana}'s 7 Dots would have filled your 1-9 run, but runs only come from the wall.`);
    // Across the suits there are no numbers a newcomer could read as one run.
    expect(missedRunNote('Sana', 'p2', run('m1 p2? s3'))).toBe(`${sana}'s 2 Dots would have finished a run, but runs only come from the wall.`);
  });

  it('drops the flourish, then the name, then the run, rather than run long', () => {
    const bilal = isolate('Bilal');
    expect(missedRunNote('Bilal', 'm9', run('m7 m8 m9?'))).toBe(`${bilal}'s 9 Characters would have finished your 7-8 run: runs only come from the wall.`);
    expect(missedRunNote(LONG_NAME, 's9', run('s7 s8 s9?'))).toBe('A thrown 9 Bamboo would have finished your 7-8 run: runs only come from the wall.');
    expect(missedRunNote(LONG_NAME, 'm9', run('m7 m8 m9?'))).toBe('A thrown 9 Characters would have finished a run, but runs only come from the wall.');
    expect(missedRunNote(LONG_NAME, 's9', run('s9? p1 m2'))).toBe('A thrown 9 Bamboo would have finished a run, but runs only come from the wall.');
  });
});
