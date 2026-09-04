/**
 * A relaxed version of the pattern matcher. Where `matchPattern` asks "does this
 * hand satisfy the pattern", `coverPattern` asks "how much of the pattern can this
 * hand already pay for" - the largest number of hand tiles assignable to the
 * pattern's components, plus the tiles still missing.
 *
 * The search is a bounded depth-first assignment with branch and bound. It is
 * deterministic: candidates are always visited in the same order.
 */
import {
  ALL_TILE_KINDS,
  SUITS,
  isBonusTile,
  isSuitTile,
  suitOf,
  suitTile,
  tileOrder,
  type Suit,
  type TileKind,
} from '../tiles';
import type { HandInput, MeldType } from '../hand';
import type { Bindings, Component, Group, Guards, MatchCtx, Pattern, Solution } from '../patterns/types';
import {
  applyFilter,
  applyFilterAll,
  bind,
  distinctOk,
  isVar,
  meldAccepted,
  numsFor,
  permutations,
  specificity,
  suitsFor,
} from '../patterns/vars';

/** Kinds a pattern can consume. `tileOrder` indexes exactly these as 0..33. */
const KINDS: readonly TileKind[] = ALL_TILE_KINDS.filter((k) => !isBonusTile(k));
const NKINDS = KINDS.length;

/** Copies of a kind in a set. A target asking for more than this is unbuildable. */
const COPIES = 4;

/** Distinct assignments kept per pattern; enough to union `needs` over every wait. */
const MAX_SOLUTIONS = 24;

/**
 * Nodes explored per pattern before the search returns its best answer so far.
 * Only wide patterns on scattered hands reach it, where the remaining nodes would
 * be shuffling single-tile overlaps; `away` is then an upper bound, never a lie
 * in the player's favour.
 */
const NODE_BUDGET = 12000;

const SUIT_BIT: Record<Suit, number> = { m: 1, p: 2, s: 4 };

function suitMask(tiles: readonly TileKind[]): number {
  let mask = 0;
  for (const k of tiles) if (isSuitTile(k)) mask |= SUIT_BIT[suitOf(k)];
  return mask;
}
function suitCount(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1);
}

/** A concrete set of tiles one component wants, whether or not the hand holds them. */
interface Target {
  readonly tiles: readonly TileKind[];
  readonly idx: readonly number[];
  readonly bindings: Bindings;
  readonly type?: MeldType;
  readonly mask: number;
  readonly key: string;
}

function target(tiles: readonly TileKind[], bindings: Bindings, type?: MeldType): Target {
  return {
    tiles,
    idx: tiles.map(tileOrder),
    bindings,
    ...(type ? { type } : {}),
    mask: suitMask(tiles),
    key: tiles.join(','),
  };
}

function filteredKinds(comp: Extract<Component, { c: 'set' | 'pair' | 'tiles' }>, b: Bindings): Target[] {
  const out: Target[] = [];
  for (const k of KINDS) {
    const nb = applyFilter(k, comp.filter, b);
    if (!nb) continue;
    if (comp.c === 'set') out.push(target([k, k, k], nb, 'pung'));
    else if (comp.c === 'pair') out.push(target([k, k], nb));
    else out.push(target([k], nb));
  }
  return out;
}

/**
 * Every tile set a component could want under the current bindings - the whole
 * space, not just what the hand holds. `tiles` and `mixedRun` are pre-split by
 * `expandForAnalysis`, so only the single-tile form is generated here.
 */
function allTargets(comp: Component, b: Bindings): Target[] {
  const out: Target[] = [];
  switch (comp.c) {
    case 'set': {
      const wantChow = comp.of === 'chow' || comp.of === 'any';
      const wantPung = comp.of === 'pung' || comp.of === 'pungOrKong' || comp.of === 'any';
      if (wantChow) {
        for (const s of suitsFor(comp.filter?.suit, b)) {
          for (let i = 1; i <= 7; i++) {
            const tiles = [suitTile(s, i), suitTile(s, i + 1), suitTile(s, i + 2)];
            const nb = applyFilterAll(tiles, comp.filter, b);
            if (nb) out.push(target(tiles, nb, 'chow'));
          }
        }
      }
      // A 'kong' component still needs a declared meld, exactly as the matcher requires.
      if (wantPung) out.push(...filteredKinds(comp, b));
      return out;
    }
    case 'pair':
      return filteredKinds(comp, b);
    case 'tiles':
      return filteredKinds(comp, b);
    case 'seq': {
      for (const s of suitsFor(comp.suit, b)) {
        for (const i of numsFor(comp.start, b)) {
          if (i + comp.len - 1 > 9) continue;
          const tiles: TileKind[] = [];
          for (let j = 0; j < comp.len; j++) tiles.push(suitTile(s, i + j));
          let nb: Bindings | null = isVar(comp.suit) ? bind(b, comp.suit, s) : b;
          if (nb && isVar(comp.start)) nb = bind(nb, comp.start, i);
          if (nb) out.push(target(tiles, nb));
        }
      }
      return out;
    }
    case 'run': {
      for (const s of suitsFor(comp.suit, b)) {
        const tiles: TileKind[] = [];
        for (let i = comp.from; i <= comp.to; i++) tiles.push(suitTile(s, i));
        const nb = isVar(comp.suit) ? bind(b, comp.suit, s) : b;
        if (nb) out.push(target(tiles, nb));
      }
      return out;
    }
    case 'each':
      return [target([...comp.kinds], b)];
    case 'knit': {
      for (const n of numsFor(comp.num, b)) {
        const nb = isVar(comp.num) ? bind(b, comp.num, n) : b;
        if (nb) out.push(target(SUITS.map((s) => suitTile(s, n)), nb));
      }
      return out;
    }
    case 'mixedSeq': {
      const len = comp.len ?? 3;
      const orders: readonly (readonly Suit[])[] =
        comp.order && b[comp.order] !== undefined
          ? [(b[comp.order] as string).split('') as Suit[]]
          : permutations(SUITS);
      for (const order of orders) {
        for (let i = 1; i + len - 1 <= 9; i++) {
          const tiles: TileKind[] = [];
          for (let j = 0; j < len; j++) tiles.push(suitTile(order[j % 3]!, i + j));
          const nb = comp.order ? bind(b, comp.order, order.join('')) : b;
          if (nb) out.push(target(tiles, nb));
        }
      }
      return out;
    }
    case 'mixedPair': {
      for (let n = 1; n <= 9; n++) {
        for (let a = 0; a < 3; a++) {
          for (let c = a + 1; c < 3; c++) out.push(target([suitTile(SUITS[a]!, n), suitTile(SUITS[c]!, n)], b));
        }
      }
      return out;
    }
    case 'mixedRun':
      return [];
  }
}

/**
 * Repeat counts become separate components, as in the matcher. Two extra rewrites
 * keep the relaxed search exact rather than combinatorial: `tiles` with n > 1 is n
 * independent single-tile picks, and a `mixedRun` is one independent pick per
 * number in the run, since the numbers never compete for the same tile kind.
 */
function expandForAnalysis(components: readonly Component[]): Component[] {
  const out: Component[] = [];
  for (const comp of components) {
    if (comp.c === 'tiles') {
      // One shared object pushed n times, so the search can spot the repeat by identity.
      const single: Component = { c: 'tiles', n: 1, filter: comp.filter };
      for (let i = 0; i < comp.n; i++) out.push(single);
      continue;
    }
    if (comp.c === 'mixedRun') {
      for (let n = comp.from; n <= comp.to; n++) out.push({ c: 'tiles', n: 1, filter: { num: n } });
      continue;
    }
    const n = 'n' in comp && comp.n !== undefined ? comp.n : 1;
    for (let i = 0; i < n; i++) out.push(comp);
  }
  return out;
}

/** Tiles a component consumes once complete. */
function sizeOf(c: Component): number {
  switch (c.c) {
    case 'set':
      return c.of === 'kong' ? 4 : 3;
    case 'pair':
    case 'mixedPair':
      return 2;
    case 'seq':
      return c.len;
    case 'run':
      return c.to - c.from + 1;
    case 'each':
      return c.kinds.length;
    case 'tiles':
      return c.n;
    case 'knit':
      return 3;
    case 'mixedSeq':
      return c.len ?? 3;
    case 'mixedRun':
      return c.to - c.from + 1;
  }
}

const BINDING_KEYS = new WeakMap<object, string>();
/** Bindings objects are shared between cached targets, so their keys are worth keeping. */
function bindingKey(b: Bindings): string {
  const hit = BINDING_KEYS.get(b);
  if (hit !== undefined) return hit;
  let out = '';
  for (const k of Object.keys(b).sort()) out += `${k}=${String(b[k])};`;
  BINDING_KEYS.set(b, out);
  return out;
}

/** One way of laying the pattern over the hand, at the best coverage found. */
export interface CoverSolution {
  /** concealed tiles assigned to the pattern */
  readonly used: readonly TileKind[];
  /** tiles the pattern still wants that the hand does not hold */
  readonly missing: readonly TileKind[];
  readonly bindings: Bindings;
}

export interface CoverResult {
  /** false when declared melds or the exposure rule shut the pattern out for good */
  readonly reachable: boolean;
  /** hand tiles, melds included, the pattern can account for */
  readonly covered: number;
  /** tiles the completed pattern would hold, melds counted at their real length */
  readonly size: number;
  readonly meldTiles: readonly TileKind[];
  readonly solutions: readonly CoverSolution[];
  /** the node budget ran out, so `covered` is a lower bound */
  readonly truncated: boolean;
}

const UNREACHABLE: CoverResult = {
  reachable: false,
  covered: 0,
  size: 0,
  meldTiles: [],
  solutions: [],
  truncated: false,
};

export function coverPattern(pattern: Pattern, hand: HandInput, ctx: MatchCtx, guards: Guards = {}): CoverResult {
  if (pattern.exposure === 'concealed' && hand.melds.some((m) => !m.concealed)) return UNREACHABLE;
  if (pattern.maxSuits !== undefined && suitCount(suitMask(hand.melds.flatMap((m) => [...m.tiles]))) > pattern.maxSuits) {
    return UNREACHABLE;
  }
  const guard = pattern.guard ? guards[pattern.guard] : undefined;
  if (pattern.guard && !guard) throw new Error(`pattern ${pattern.id} needs guard ${pattern.guard}`);

  const comps = expandForAnalysis(pattern.components);
  const concealed = hand.concealed.filter((k) => !isBonusTile(k));
  const meldTiles = hand.melds.flatMap((m) => [...m.tiles]);

  const counts = new Int32Array(NKINDS);
  for (const k of concealed) counts[tileOrder(k)]!++;
  /** copies of each kind the assignment so far has spoken for, melds included */
  const claimed = new Int32Array(NKINDS);
  const scratch = new Int32Array(NKINDS);

  let reachable = false;
  let truncated = false;
  let best = -1;
  let bestSize = 0;
  let solutions: CoverSolution[] = [];
  let nodes = 0;

  /** targets by component, then by the bindings in force */
  const targetCache = new WeakMap<Component, WeakMap<object, Target[]>>();
  /**
   * `bind` builds a fresh object every time, so the same set of bindings arrives as
   * dozens of distinct objects. Interning them by key gives the caches below one
   * object per binding and keeps the target space from being rebuilt per branch.
   */
  const interned = new Map<string, Bindings>();
  const intern = (b: Bindings): Bindings => {
    const key = bindingKey(b);
    const hit = interned.get(key);
    if (hit !== undefined) return hit;
    interned.set(key, b);
    return b;
  };
  /** `distinctOk` allocates, and target bindings are shared objects, so cache the verdict. */
  const distinctCache = new WeakMap<object, boolean>();
  const distinctAllows = (b: Bindings): boolean => {
    let ok = distinctCache.get(b);
    if (ok === undefined) {
      ok = distinctOk(pattern, b);
      distinctCache.set(b, ok);
    }
    return ok;
  };

  const searchConcealed = (
    order: readonly Component[],
    size: number,
    meldGroups: readonly Group[],
    startMask: number,
    startBindings: Bindings,
  ): void => {
    const sizes = order.map(sizeOf);
    // Bound for the branch and bound: no component can cover more of the hand than
    // its best-case overlap against the whole hand, and bindings only tighten from
    // here, so the running sum of those maxima is a safe ceiling on what is left.
    const ceiling = new Array<number>(order.length + 1).fill(0);
    let total = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      let bestOverlap = 0;
      for (const t of allTargets(order[i]!, startBindings)) {
        let overlap = 0;
        for (const j of t.idx) {
          if (scratch[j]! < counts[j]!) {
            scratch[j]!++;
            overlap++;
          }
        }
        for (const j of t.idx) scratch[j] = 0;
        if (overlap > bestOverlap) bestOverlap = overlap;
        if (bestOverlap === sizes[i]!) break;
      }
      ceiling[i] = ceiling[i + 1]! + bestOverlap;
      total += sizes[i]!;
    }
    const perfect = Math.min(concealed.length, total);

    const chosen: Target[] = [];
    const usedAt: TileKind[][] = order.map(() => []);
    const missAt: TileKind[][] = order.map(() => []);

    const record = (coverage: number, bindings: Bindings): void => {
      const used: TileKind[] = [];
      const missing: TileKind[] = [];
      for (let i = 0; i < order.length; i++) {
        used.push(...usedAt[i]!);
        missing.push(...missAt[i]!);
      }
      // A lay-out with nothing missing and nothing left over is a real win, so the
      // ruleset's guard gets the final say on it.
      if (guard && missing.length === 0 && used.length === concealed.length) {
        const groups: Group[] = [...meldGroups];
        for (let i = 0; i < order.length; i++) {
          const t = chosen[i]!;
          groups.push({
            c: order[i]!.c,
            ...(t.type ? { type: t.type } : {}),
            tiles: t.tiles,
            concealed: true,
            fromMeld: false,
          });
        }
        const sol: Solution = { groups, bindings };
        if (!guard(sol, hand, ctx)) return;
      }
      if (coverage > best) {
        best = coverage;
        bestSize = size;
        solutions = [];
      } else if (coverage < best) {
        return;
      } else if (size < bestSize) {
        bestSize = size;
      }
      if (solutions.length < MAX_SOLUTIONS) solutions.push({ used, missing, bindings });
    };

    let done = false;
    const step = (i: number, coverage: number, bindings: Bindings, mask: number, prevKey: string | null): void => {
      if (done) return;
      if (nodes++ >= NODE_BUDGET) {
        truncated = true;
        return;
      }
      if (i === order.length) {
        record(coverage, bindings);
        // Nothing left to find: the hand is fully spoken for and the cap is full.
        if (best === perfect && solutions.length >= MAX_SOLUTIONS) done = true;
        return;
      }
      if (coverage + ceiling[i]! < best) return;
      if (solutions.length >= MAX_SOLUTIONS && coverage + ceiling[i]! <= best) return;

      const comp = order[i]!;
      let byBindings = targetCache.get(comp);
      if (!byBindings) {
        byBindings = new WeakMap();
        targetCache.set(comp, byBindings);
      }
      let space = byBindings.get(bindings);
      if (!space) {
        space = allTargets(comp, bindings).map((t) => (t.bindings === bindings ? t : { ...t, bindings: intern(t.bindings) }));
        byBindings.set(bindings, space);
      }

      const viable: { readonly t: Target; readonly overlap: number }[] = [];
      let emptySeen: Set<string> | null = null;
      for (const t of space) {
        if (!distinctAllows(t.bindings)) continue;
        if (pattern.maxSuits !== undefined && suitCount(mask | t.mask) > pattern.maxSuits) continue;
        let buildable = true;
        for (const j of t.idx) {
          if (claimed[j]! + scratch[j]! >= COPIES) buildable = false;
          scratch[j]!++;
        }
        for (const j of t.idx) scratch[j] = 0;
        if (!buildable) continue;
        let overlap = 0;
        for (const j of t.idx) {
          if (scratch[j]! < counts[j]!) {
            scratch[j]!++;
            overlap++;
          }
        }
        for (const j of t.idx) scratch[j] = 0;
        if (overlap === 0) {
          // Targets the hand does not touch differ only in what they bind, so one
          // representative per binding stands in for all of them.
          const sig = bindingKey(t.bindings);
          if (emptySeen === null) emptySeen = new Set();
          else if (emptySeen.has(sig)) continue;
          emptySeen.add(sig);
        }
        viable.push({ t, overlap });
      }

      if (viable.length === 0) {
        // Nothing can ever serve this component - a bare 'kong' with no meld, say.
        // It still costs its tiles, so the pattern simply stays that far away.
        chosen[i] = target([], bindings);
        usedAt[i]!.length = 0;
        missAt[i]!.length = 0;
        step(i + 1, coverage, bindings, mask, null);
        return;
      }
      // Stable, so equal overlaps stay in target-space order and the search stays deterministic.
      viable.sort((a, c) => c.overlap - a.overlap);

      const repeats = i > 0 && order[i - 1] === comp;
      const used = usedAt[i]!;
      const missing = missAt[i]!;
      for (const { t } of viable) {
        // Identical components are interchangeable, so keep them in key order.
        if (repeats && prevKey !== null && t.key < prevKey) continue;
        used.length = 0;
        missing.length = 0;
        for (const k of t.tiles) {
          const j = tileOrder(k);
          claimed[j]!++;
          if (counts[j]! > 0) {
            counts[j]!--;
            used.push(k);
          } else {
            missing.push(k);
          }
        }
        chosen[i] = t;
        step(i + 1, coverage + used.length, t.bindings, mask | t.mask, t.key);
        for (const k of used) counts[tileOrder(k)]!++;
        for (const k of t.tiles) claimed[tileOrder(k)]!--;
        if (done || nodes >= NODE_BUDGET) return;
      }
    };

    step(0, 0, startBindings, startMask, null);
  };

  const assignMelds = (i: number, used: boolean[], b: Bindings, groups: Group[], meldSize: number, mask: number): void => {
    if (i === hand.melds.length) {
      reachable = true;
      const rest = comps.filter((_, j) => !used[j]).sort((x, y) => specificity(x) - specificity(y));
      searchConcealed(rest, meldSize + rest.reduce((n, c) => n + sizeOf(c), 0), groups, mask, intern(b));
      return;
    }
    const meld = hand.melds[i]!;
    const tried = new Set<Component>();
    comps.forEach((comp, j) => {
      if (used[j] || tried.has(comp)) return;
      const nb = meldAccepted(comp, meld, b);
      if (!nb || !distinctOk(pattern, nb)) return;
      tried.add(comp); // identical expanded components are interchangeable
      used[j] = true;
      groups.push({ c: 'set', type: meld.type, tiles: meld.tiles, concealed: meld.concealed, fromMeld: true });
      for (const k of meld.tiles) claimed[tileOrder(k)]!++;
      assignMelds(i + 1, used, nb, groups, meldSize + meld.tiles.length, mask | suitMask(meld.tiles));
      for (const k of meld.tiles) claimed[tileOrder(k)]!--;
      groups.pop();
      used[j] = false;
    });
  };

  assignMelds(
    0,
    comps.map(() => false),
    {},
    [],
    0,
    0,
  );

  // Melds cannot be changed, so a pattern no meld arrangement fits is gone for good.
  if (!reachable || best < 0) return UNREACHABLE;
  return { reachable: true, covered: best + meldTiles.length, size: bestSize, meldTiles, solutions, truncated };
}
