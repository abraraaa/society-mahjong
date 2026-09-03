import {
  SUITS,
  countKinds,
  isDragonTile,
  isHonourTile,
  isSimple,
  isSuitTile,
  isTerminal,
  isWindTile,
  numOf,
  suitOf,
  suitTile,
  type Counts,
  type Suit,
  type TileKind,
} from '../tiles';
import type { HandInput, Meld } from '../hand';
import type { Bindings, Component, Group, Guards, MatchCtx, Pattern, PatternMatch, Solution, SuitRef, NumRef, TileFilter, Var } from './types';

const MAX_SOLUTIONS = 32;

type Comp = Component;

function isVar(x: unknown): x is Var {
  return typeof x === 'string' && x.startsWith('$');
}

function suitsFor(ref: SuitRef | undefined, b: Bindings): readonly Suit[] {
  if (ref === undefined) return SUITS;
  if (!isVar(ref)) return [ref];
  const bound = b[ref];
  return bound === undefined ? SUITS : [bound as Suit];
}
function numsFor(ref: NumRef | undefined, b: Bindings): readonly number[] {
  if (ref === undefined) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (!isVar(ref)) return [ref];
  const bound = b[ref];
  return bound === undefined ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [bound as number];
}
function bind(b: Bindings, v: Var, value: Suit | number | string): Bindings | null {
  const cur = b[v];
  if (cur === undefined) return { ...b, [v]: value };
  return cur === value ? b : null;
}

/** Returns extended bindings if `kind` passes the filter, else null. */
export function applyFilter(kind: TileKind, f: TileFilter | undefined, b: Bindings): Bindings | null {
  if (!f) return b;
  if (f.kinds && !f.kinds.includes(kind)) return null;
  if (f.honour && !isHonourTile(kind)) return null;
  if (f.wind && !isWindTile(kind)) return null;
  if (f.dragon && !isDragonTile(kind)) return null;
  if (f.suitTile && !isSuitTile(kind)) return null;
  if (f.terminal && !isTerminal(kind)) return null;
  if (f.simple && !isSimple(kind)) return null;
  let out: Bindings | null = b;
  if (f.suit !== undefined) {
    if (!isSuitTile(kind)) return null;
    const s = suitOf(kind);
    if (isVar(f.suit)) out = bind(out, f.suit, s);
    else if (f.suit !== s) return null;
    if (!out) return null;
  }
  if (f.num !== undefined) {
    if (!isSuitTile(kind)) return null;
    const n = numOf(kind);
    if (isVar(f.num)) out = bind(out, f.num, n);
    else if (f.num !== n) return null;
    if (!out) return null;
  }
  if (f.nums) {
    if (!isSuitTile(kind) || !f.nums.includes(numOf(kind))) return null;
  }
  return out;
}

function applyFilterAll(kinds: readonly TileKind[], f: TileFilter | undefined, b: Bindings): Bindings | null {
  let out: Bindings | null = b;
  for (const k of kinds) {
    out = applyFilter(k, f, out);
    if (!out) return null;
  }
  return out;
}

function distinctOk(p: Pattern, b: Bindings): boolean {
  if (!p.distinct) return true;
  for (const group of p.distinct) {
    const seen = new Set<unknown>();
    for (const v of group) {
      const val = b[v];
      if (val === undefined) continue;
      if (seen.has(val)) return false;
      seen.add(val);
    }
  }
  return true;
}

interface Candidate {
  readonly tiles: readonly TileKind[];
  readonly bindings: Bindings;
  readonly type?: 'chow' | 'pung' | 'kong';
}

function has(counts: Counts, kinds: readonly TileKind[]): boolean {
  const need = countKinds(kinds);
  for (const [k, n] of need) if ((counts.get(k) ?? 0) < n) return false;
  return true;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((x, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

function candidatesFor(comp: Comp, counts: Counts, b: Bindings): Candidate[] {
  const out: Candidate[] = [];
  switch (comp.c) {
    case 'set': {
      const wantChow = comp.of === 'chow' || comp.of === 'any';
      const wantPung = comp.of === 'pung' || comp.of === 'pungOrKong' || comp.of === 'any';
      if (wantChow) {
        for (const s of suitsFor(comp.filter?.suit, b)) {
          for (let i = 1; i <= 7; i++) {
            const tiles = [suitTile(s, i), suitTile(s, i + 1), suitTile(s, i + 2)];
            if (!has(counts, tiles)) continue;
            const nb = applyFilterAll(tiles, comp.filter, b);
            if (nb) out.push({ tiles, bindings: nb, type: 'chow' });
          }
        }
      }
      if (wantPung) {
        for (const [k, n] of counts) {
          if (n < 3) continue;
          const nb = applyFilter(k, comp.filter, b);
          if (nb) out.push({ tiles: [k, k, k], bindings: nb, type: 'pung' });
        }
      }
      // A 'kong' component can only be satisfied by a declared meld.
      return out;
    }
    case 'pair': {
      for (const [k, n] of counts) {
        if (n < 2) continue;
        const nb = applyFilter(k, comp.filter, b);
        if (nb) out.push({ tiles: [k, k], bindings: nb });
      }
      return out;
    }
    case 'seq': {
      for (const s of suitsFor(comp.suit, b)) {
        for (const i of numsFor(comp.start, b)) {
          if (i + comp.len - 1 > 9) continue;
          const tiles: TileKind[] = [];
          for (let j = 0; j < comp.len; j++) tiles.push(suitTile(s, i + j));
          if (!has(counts, tiles)) continue;
          let nb: Bindings | null = isVar(comp.suit) ? bind(b, comp.suit, s) : b;
          if (nb && isVar(comp.start)) nb = bind(nb, comp.start, i);
          if (nb) out.push({ tiles, bindings: nb });
        }
      }
      return out;
    }
    case 'mixedRun': {
      // one tile per number, each from any suit that still has it
      const pick = (n: number, chosen: TileKind[], remaining: Counts): void => {
        if (n > comp.to) {
          out.push({ tiles: [...chosen], bindings: b });
          return;
        }
        for (const s of SUITS) {
          const k = suitTile(s, n);
          if ((remaining.get(k) ?? 0) <= 0) continue;
          const next = new Map(remaining);
          next.set(k, next.get(k)! - 1);
          chosen.push(k);
          pick(n + 1, chosen, next);
          chosen.pop();
          if (out.length > 64) return;
        }
      };
      pick(comp.from, [], counts);
      return out;
    }
    case 'run': {
      for (const s of suitsFor(comp.suit, b)) {
        const tiles: TileKind[] = [];
        for (let i = comp.from; i <= comp.to; i++) tiles.push(suitTile(s, i));
        if (!has(counts, tiles)) continue;
        const nb = isVar(comp.suit) ? bind(b, comp.suit, s) : b;
        if (nb) out.push({ tiles, bindings: nb });
      }
      return out;
    }
    case 'each': {
      if (has(counts, comp.kinds)) out.push({ tiles: [...comp.kinds], bindings: b });
      return out;
    }
    case 'tiles': {
      const pool: TileKind[] = [];
      for (const [k, n] of counts) if (n > 0 && applyFilter(k, comp.filter, b)) pool.push(k);
      const pick = (start: number, chosen: TileKind[], nb: Bindings): void => {
        if (chosen.length === comp.n) {
          out.push({ tiles: [...chosen], bindings: nb });
          return;
        }
        for (let i = start; i < pool.length; i++) {
          const k = pool[i]!;
          const already = chosen.filter((c) => c === k).length;
          if (already >= (counts.get(k) ?? 0)) continue;
          const b2 = applyFilter(k, comp.filter, nb);
          if (!b2) continue;
          chosen.push(k);
          pick(i, chosen, b2);
          chosen.pop();
        }
      };
      pick(0, [], b);
      return out;
    }
    case 'knit': {
      for (const n of numsFor(comp.num, b)) {
        const tiles = SUITS.map((s) => suitTile(s, n));
        if (!has(counts, tiles)) continue;
        const nb = isVar(comp.num) ? bind(b, comp.num, n) : b;
        if (nb) out.push({ tiles, bindings: nb });
      }
      return out;
    }
    case 'mixedSeq': {
      const len = comp.len ?? 3;
      const orders: readonly (readonly Suit[])[] = (() => {
        if (comp.order && b[comp.order] !== undefined) return [(b[comp.order] as string).split('') as Suit[]];
        return permutations(SUITS);
      })();
      for (const order of orders) {
        for (let i = 1; i + len - 1 <= 9; i++) {
          const tiles: TileKind[] = [];
          for (let j = 0; j < len; j++) tiles.push(suitTile(order[j % 3]!, i + j));
          if (!has(counts, tiles)) continue;
          const nb = comp.order ? bind(b, comp.order, order.join('')) : b;
          if (nb) out.push({ tiles, bindings: nb });
        }
      }
      return out;
    }
    case 'mixedPair': {
      for (let n = 1; n <= 9; n++) {
        for (let a = 0; a < 3; a++) {
          for (let c = a + 1; c < 3; c++) {
            const tiles = [suitTile(SUITS[a]!, n), suitTile(SUITS[c]!, n)];
            if (has(counts, tiles)) out.push({ tiles, bindings: b });
          }
        }
      }
      return out;
    }
  }
}

function expand(components: readonly Comp[]): Comp[] {
  const out: Comp[] = [];
  for (const comp of components) {
    // `n` is a repeat count, except on `tiles` where it is the number of tiles
    const n = comp.c !== 'tiles' && 'n' in comp && comp.n !== undefined ? comp.n : 1;
    for (let i = 0; i < n; i++) out.push(comp);
  }
  return out;
}

function specificity(c: Comp): number {
  switch (c.c) {
    case 'each':
    case 'run':
      return 0;
    case 'knit':
    case 'mixedSeq':
    case 'mixedRun':
    case 'tiles':
      return 1;
    case 'set':
    case 'seq':
      return 2;
    case 'pair':
    case 'mixedPair':
      return 3;
  }
}

function meldAccepted(comp: Comp, meld: Meld, b: Bindings): Bindings | null {
  if (comp.c !== 'set') return null;
  const ok =
    comp.of === 'any' ||
    comp.of === meld.type ||
    (comp.of === 'pungOrKong' && (meld.type === 'pung' || meld.type === 'kong'));
  if (!ok) return null;
  if (comp.concealed && !meld.concealed) return null;
  return applyFilterAll(meld.tiles, comp.filter, b);
}

function suitsUsed(hand: HandInput): number {
  const s = new Set<Suit>();
  for (const k of hand.concealed) if (isSuitTile(k)) s.add(suitOf(k));
  for (const m of hand.melds) for (const k of m.tiles) if (isSuitTile(k)) s.add(suitOf(k));
  return s.size;
}

/** All ways the hand satisfies the pattern (capped). Empty means no match. */
export function matchPattern(pattern: Pattern, hand: HandInput, ctx: MatchCtx, guards: Guards = {}): Solution[] {
  if (pattern.exposure === 'concealed' && hand.melds.some((m) => !m.concealed)) return [];
  if (pattern.maxSuits !== undefined && suitsUsed(hand) > pattern.maxSuits) return [];
  const guard = pattern.guard ? guards[pattern.guard] : undefined;
  if (pattern.guard && !guard) throw new Error(`pattern ${pattern.id} needs guard ${pattern.guard}`);

  const comps = expand(pattern.components);
  const concealedCounts = countKinds(hand.concealed.filter((k) => !k.startsWith('F') && !k.startsWith('S') || isSuitTile(k)));
  const solutions: Solution[] = [];

  const seen = new Set<string>();
  const finish = (groups: Group[], b: Bindings): void => {
    const key = groups.map((g) => `${g.type ?? g.c}:${g.tiles.join('')}`).sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const sol: Solution = { groups: [...groups], bindings: b };
    if (guard && !guard(sol, hand, ctx)) return;
    solutions.push(sol);
  };

  // Identical expanded components (e.g. four knits, seven pairs) are interchangeable, so
  // successive identical components must take candidates in non-decreasing key order.
  const matchConcealed = (remaining: readonly Comp[], counts: Counts, b: Bindings, groups: Group[], prev?: { comp: Comp; key: string }): void => {
    if (solutions.length >= MAX_SOLUTIONS) return;
    if (remaining.length === 0) {
      for (const n of counts.values()) if (n !== 0) return;
      finish(groups, b);
      return;
    }
    const [comp, ...rest] = remaining as [Comp, ...Comp[]];
    for (const cand of candidatesFor(comp, counts, b)) {
      const key = cand.tiles.join(',');
      if (prev && prev.comp === comp && key < prev.key) continue;
      if (!distinctOk(pattern, cand.bindings)) continue;
      const next = new Map(counts);
      for (const k of cand.tiles) next.set(k, (next.get(k) ?? 0) - 1);
      const group: Group = cand.type
        ? { c: comp.c, type: cand.type, tiles: cand.tiles, concealed: true, fromMeld: false }
        : { c: comp.c, tiles: cand.tiles, concealed: true, fromMeld: false };
      groups.push(group);
      matchConcealed(rest, next, cand.bindings, groups, { comp, key });
      groups.pop();
    }
  };

  const assignMelds = (i: number, used: boolean[], b: Bindings, groups: Group[]): void => {
    if (i === hand.melds.length) {
      const remaining = comps.filter((_, j) => !used[j]).sort((x, y) => specificity(x) - specificity(y));
      matchConcealed(remaining, concealedCounts, b, groups);
      return;
    }
    const meld = hand.melds[i]!;
    const tried = new Set<Comp>();
    comps.forEach((comp, j) => {
      if (used[j] || tried.has(comp)) return;
      const nb = meldAccepted(comp, meld, b);
      if (!nb || !distinctOk(pattern, nb)) return;
      tried.add(comp); // identical expanded components are interchangeable
      used[j] = true;
      groups.push({ c: 'set', type: meld.type, tiles: meld.tiles, concealed: meld.concealed, fromMeld: true });
      assignMelds(i + 1, used, nb, groups);
      groups.pop();
      used[j] = false;
    });
  };

  assignMelds(0, comps.map(() => false), {}, []);
  return solutions;
}

export function matchPatterns(patterns: readonly Pattern[], hand: HandInput, ctx: MatchCtx, guards: Guards = {}): PatternMatch[] {
  const out: PatternMatch[] = [];
  for (const pattern of patterns) {
    const sols = matchPattern(pattern, hand, ctx, guards);
    for (const solution of sols) out.push({ pattern, solution });
  }
  return out;
}

export function isWinningHand(patterns: readonly Pattern[], hand: HandInput, ctx: MatchCtx, guards: Guards = {}): boolean {
  return patterns.some((p) => matchPattern(p, hand, ctx, guards).length > 0);
}
