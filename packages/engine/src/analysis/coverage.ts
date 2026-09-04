/**
 * A relaxed version of the pattern matcher. Where `matchPattern` asks "does this
 * hand satisfy the pattern", `coverPattern` asks "how much of the pattern can this
 * hand already pay for" - the largest number of hand tiles assignable to the
 * pattern's components, plus the tiles still missing.
 *
 * The search is a bounded depth-first assignment with branch and bound. It is
 * deterministic: candidates are always visited in the same order.
 *
 * Two rules the rest of the layer leans on:
 *   - `reachable: false` means the rules shut the pattern out - a meld it cannot
 *     use, an exposure it forbids, no lay-out the ruleset guard will accept. A
 *     pattern that is merely far away is always reachable.
 *   - `approximate: true` means `covered` is a lower bound, so `away` is an upper
 *     bound. Every prune that can cost coverage sets it.
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
import type { ClaimRules } from '../ruleset';
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

/** Distinct assignments kept per pattern, as illustrations of the best coverage. */
const MAX_SOLUTIONS = 24;

/**
 * Nodes explored per pass before the search returns its best answer so far. Only the
 * widest patterns on scattered hands reach it - the South round's four-set hands, on
 * a hand with nothing in it - where the remaining nodes would be shuffling
 * single-tile overlaps; `away` is then an upper bound, never a lie in the player's
 * favour, and `approximate` says so.
 */
const NODE_BUDGET = 24000;

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
  /**
   * The tiles encoded in `tileOrder`, so comparing two `ord` strings orders targets
   * exactly as the search generates them. The canonical order imposed on repeated
   * components has to agree with generation order, or a branch can find every
   * remaining target ranked too low and dead-end on a pattern it could reach.
   */
  readonly ord: string;
}

function target(tiles: readonly TileKind[], bindings: Bindings, type?: MeldType): Target {
  const idx = tiles.map(tileOrder);
  return {
    tiles,
    idx,
    bindings,
    ...(type ? { type } : {}),
    mask: suitMask(tiles),
    ord: idx.map((i) => String.fromCharCode(65 + i)).join(''),
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

/**
 * `bind` builds a fresh object every time, so the same set of bindings arrives as
 * dozens of distinct objects. Interning them by key gives one object per binding,
 * which is what makes the target cache below hit across calls as well as within one.
 */
const INTERNED = new Map<string, Bindings>();
function intern(b: Bindings): Bindings {
  const key = bindingKey(b);
  const hit = INTERNED.get(key);
  if (hit !== undefined) return hit;
  INTERNED.set(key, b);
  return b;
}

/**
 * Target spaces depend only on the component and the bindings in force, so they are
 * worth keeping between searches: a round asks the same questions of twenty patterns
 * every turn, and rebuilding every chow of every suit each time dominated the cost.
 */
const TARGETS = new WeakMap<Component, Map<string, readonly Target[]>>();
function targetsFor(comp: Component, b: Bindings): readonly Target[] {
  let byBindings = TARGETS.get(comp);
  if (!byBindings) {
    byBindings = new Map();
    TARGETS.set(comp, byBindings);
  }
  const key = bindingKey(b);
  const hit = byBindings.get(key);
  if (hit !== undefined) return hit;
  const space = allTargets(comp, b).map((t) => (t.bindings === b ? t : { ...t, bindings: intern(t.bindings) }));
  byBindings.set(key, space);
  return space;
}

/** The expansion is cached too, so its components stay the same objects for `TARGETS`. */
const EXPANDED = new WeakMap<Pattern, readonly Component[]>();
function componentsFor(pattern: Pattern): readonly Component[] {
  let hit = EXPANDED.get(pattern);
  if (!hit) {
    hit = expandForAnalysis(pattern.components);
    EXPANDED.set(pattern, hit);
  }
  return hit;
}

/** One way of laying the pattern over the hand, at the best coverage found. */
export interface CoverSolution {
  /** concealed tiles assigned to the pattern */
  readonly used: readonly TileKind[];
  /** tiles the pattern still wants that the hand does not hold */
  readonly missing: readonly TileKind[];
  readonly bindings: Bindings;
  /** the lay-out as groups, melds first, each concealed group holding its missing tiles too */
  readonly groups: readonly Group[];
}

/** A tile that would bring the hand closer to a pattern, and how it can arrive. */
export interface TileNeed {
  readonly kind: TileKind;
  /**
   * True when the ruleset lets this tile come from a discard: it completes a meld
   * that may be claimed, or it wins the hand and the winning tile may be claimed.
   * False means the wall is the only source - in Karachi, every tile of a chow.
   * Always false without `claims`, since only the ruleset knows.
   */
  readonly claimable: boolean;
}

export interface CoverResult {
  /** false when declared melds, the exposure rule or the ruleset guard shut the pattern out for good */
  readonly reachable: boolean;
  /** hand tiles, melds included, the pattern can account for */
  readonly covered: number;
  /** tiles the completed pattern would hold, melds counted at their real length */
  readonly size: number;
  readonly meldTiles: readonly TileKind[];
  readonly solutions: readonly CoverSolution[];
  /**
   * Every tile kind that would raise `covered`, over every best lay-out - the whole
   * wait, not the part one lay-out happens to name. Exact unless `approximate`.
   */
  readonly needs: readonly TileNeed[];
  /** the node budget ran out, so `covered` is a lower bound */
  readonly truncated: boolean;
  /** `covered` is a lower bound and `needs` may be short: the budget ran out, or a prune could have cost coverage */
  readonly approximate: boolean;
}

export interface CoverOptions {
  /** the ruleset's claim rules, which decide whether a needed tile can come from a discard */
  readonly claims?: ClaimRules;
}

const UNREACHABLE: CoverResult = {
  reachable: false,
  covered: 0,
  size: 0,
  meldTiles: [],
  solutions: [],
  needs: [],
  truncated: false,
  approximate: false,
};

/** What the depth-first search found, before it is dressed up as a `CoverResult`. */
interface SearchOutcome {
  /** false only when no meld arrangement fits the pattern at all */
  readonly reachable: boolean;
  /** concealed tiles covered by the best lay-out recorded, -1 when none was */
  readonly best: number;
  /** tiles the pattern holds once complete, melds at their real length */
  readonly size: number;
  readonly solutions: readonly CoverSolution[];
  readonly needs: readonly TileNeed[];
  readonly truncated: boolean;
  readonly approximate: boolean;
  /** the first pass dropped lay-outs that could only tie, so `needs` may be short */
  readonly tiesPruned: boolean;
  readonly meldTiles: readonly TileKind[];
}

const EMPTY_TARGETS: readonly Target[] = [];

/** The tie-collecting pass answers for everything but the flags, which are cumulative. */
function merge(first: SearchOutcome, ties: SearchOutcome): SearchOutcome {
  const flags = { truncated: first.truncated || ties.truncated, approximate: first.approximate || ties.approximate };
  if (ties.best < first.best) return { ...first, ...flags, approximate: true };
  return { ...ties, ...flags };
}

/** A tile kind is either no use, wanted from the wall, or wanted and claimable. */
const NEED_NONE = 0;
const NEED_WALL = 1;
const NEED_CLAIM = 2;

/**
 * Two passes make one answer. The first, with `seed` unset, hunts for the best
 * coverage and prunes branches that can only tie it. The second is seeded with that
 * coverage and keeps every tie, because each tying lay-out names another tile the
 * hand can be waiting for - and a search that spends its budget on ties before it
 * knows what the best coverage is finds neither.
 */
function search(
  pattern: Pattern,
  hand: HandInput,
  ctx: MatchCtx,
  guards: Guards,
  claims?: ClaimRules,
  seed?: number,
): SearchOutcome {
  const guard = pattern.guard ? guards[pattern.guard] : undefined;
  if (pattern.guard && !guard) throw new Error(`pattern ${pattern.id} needs guard ${pattern.guard}`);

  const comps = componentsFor(pattern);
  const concealed = hand.concealed.filter((k) => !isBonusTile(k));
  const meldTiles = hand.melds.flatMap((m) => [...m.tiles]);
  const handTiles = concealed.length + meldTiles.length;

  const counts = new Int32Array(NKINDS);
  for (const k of concealed) counts[tileOrder(k)]!++;
  /** copies of each kind the assignment so far has spoken for, melds included */
  const claimed = new Int32Array(NKINDS);
  const scratch = new Int32Array(NKINDS);
  /** copies of each kind already on the table or in the hand: the rest are drawable */
  const inPlay = new Int32Array(NKINDS);
  for (const k of concealed) inPlay[tileOrder(k)]!++;
  for (const k of meldTiles) inPlay[tileOrder(k)]!++;

  let reachable = false;
  let truncated = false;
  let approximate = false;
  let tiesPruned = false;
  const collectTies = seed !== undefined;
  let best = seed ?? -1;
  let recorded = false;
  let bestSize = 0;
  let fullSize = 0;
  let solutions: CoverSolution[] = [];
  let nodes = 0;

  /**
   * What each kind is worth to the hand, over every lay-out at the current best
   * coverage. Cleared whenever a better lay-out resets what "best" means.
   */
  const needKind = new Uint8Array(NKINDS);
  const mark = (kind: TileKind, claimable: boolean): void => {
    const j = tileOrder(kind);
    if (inPlay[j]! >= COPIES) return; // every copy is already accounted for
    const value = claimable ? NEED_CLAIM : NEED_WALL;
    if (needKind[j]! < value) needKind[j] = value;
  };
  /** A discard can be claimed for a meld the ruleset lets you claim, and never to expose a hand the pattern wants concealed. */
  const meldClaimable = (type: MeldType | undefined, comp: Component): boolean => {
    if (!claims || pattern.exposure === 'concealed') return false;
    if (comp.c === 'set' && comp.concealed) return false;
    if (type === 'chow') return claims.chowFromDiscard !== 'never';
    if (type === 'pung') return claims.pungFromDiscard;
    if (type === 'kong') return claims.kongFromDiscard;
    return false; // pairs, runs and loose tiles are never melds
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
    if (fullSize === 0) fullSize = size;
    const sizes = order.map(sizeOf);
    // Bound for the branch and bound: no component can cover more of the hand than
    // its best-case overlap against the whole hand, and bindings only tighten from
    // here, so the running sum of those maxima is a safe ceiling on what is left.
    const ceiling = new Array<number>(order.length + 1).fill(0);
    let total = 0;
    for (let i = order.length - 1; i >= 0; i--) {
      let bestOverlap = 0;
      for (const t of targetsFor(order[i]!, startBindings)) {
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
    /** zero-overlap targets the dedup folded into `chosen[i]`, and so could stand in for it */
    const altAt: (readonly Target[])[] = order.map(() => EMPTY_TARGETS);
    let done = false;

    const layOut = (bindings: Bindings, at = -1, instead?: Target): Solution => {
      const groups: Group[] = [...meldGroups];
      for (let i = 0; i < order.length; i++) {
        const t = i === at && instead ? instead : chosen[i]!;
        groups.push({
          c: order[i]!.c,
          ...(t.type ? { type: t.type } : {}),
          tiles: t.tiles,
          concealed: true,
          fromMeld: false,
        });
      }
      return { groups, bindings };
    };

    /** Whether the hand and the rest of the lay-out leave room for this target's tiles. */
    const fits = (t: Target): boolean => {
      let ok = true;
      for (const j of t.idx) {
        if (claimed[j]! + scratch[j]! >= COPIES) ok = false;
        scratch[j]!++;
      }
      for (const j of t.idx) scratch[j] = 0;
      return ok;
    };

    /**
     * What this lay-out says the hand is waiting for. Its own missing tiles, plus the
     * tiles of every zero-overlap target the dedup folded away: those are swaps that
     * leave coverage untouched, so each one is another lay-out at the same distance,
     * and a thirteen-sided wait is thirteen such swaps.
     */
    const collectNeeds = (missingTotal: number, bindings: Bindings): void => {
      const winning = missingTotal === 1 && handTiles + 1 === size && claims?.winFromDiscard === true;
      for (let i = 0; i < order.length; i++) {
        const miss = missAt[i]!;
        if (miss.length > 0) {
          // One tile short of a meld is a tile you can claim; two short is not.
          const claimable = winning || (miss.length === 1 && meldClaimable(chosen[i]!.type, order[i]!));
          for (const k of miss) mark(k, claimable);
        }
        for (const alt of altAt[i]!) {
          let novel = false;
          for (const k of alt.tiles) if (needKind[tileOrder(k)]! === NEED_NONE) novel = true;
          if (!novel || !fits(alt)) continue;
          // The guard may well tell the swap apart from the target it stood in for.
          if (guard && !guard(layOut(bindings, i, alt), hand, ctx)) continue;
          for (const k of alt.tiles) mark(k, winning && alt.tiles.length === 1);
        }
      }
    };

    const record = (coverage: number, bindings: Bindings): void => {
      if (coverage < best) return;
      if (recorded && coverage === best && !collectTies && solutions.length >= MAX_SOLUTIONS) {
        tiesPruned = true;
        return;
      }

      let complete = true;
      let merged = false;
      let missingTotal = 0;
      for (let i = 0; i < order.length; i++) {
        if (chosen[i]!.tiles.length === 0) complete = false;
        if (altAt[i]!.length > 0) merged = true;
        missingTotal += missAt[i]!.length;
      }

      // The guard judges the hand this lay-out is aiming at - the tiles it holds plus
      // the ones it still wants - so a shape the ruleset can never legalise is never
      // reported as one tile away. A lay-out with a component nothing can fill is not
      // a hand at all, so there is nothing there for the guard to rule on.
      if (guard && complete && !guard(layOut(bindings), hand, ctx)) {
        // A guard can tell the folded-away targets apart from the one that stood in
        // for them, so this verdict may be an artefact of that prune, not the rules.
        if (merged) approximate = true;
        return;
      }

      if (coverage > best || !recorded) {
        if (coverage > best) {
          solutions = [];
          needKind.fill(NEED_NONE);
        }
        best = coverage;
        bestSize = size;
        recorded = true;
      } else if (size < bestSize) {
        bestSize = size;
      }
      collectNeeds(missingTotal, bindings);
      if (solutions.length < MAX_SOLUTIONS) {
        const used: TileKind[] = [];
        const missing: TileKind[] = [];
        for (let i = 0; i < order.length; i++) {
          used.push(...usedAt[i]!);
          missing.push(...missAt[i]!);
        }
        solutions.push({ used, missing, bindings, groups: layOut(bindings).groups });
      }
      // A lay-out that spends the whole hand and wants nothing is a win: there is no
      // better coverage to find and nothing left to wait for.
      if (coverage === perfect && missingTotal === 0) done = true;
      else if (!collectTies && best === perfect && solutions.length >= MAX_SOLUTIONS) {
        tiesPruned = true;
        done = true;
      }
    };

    const step = (i: number, coverage: number, bindings: Bindings, mask: number, prevOrd: string | null): void => {
      if (done) return;
      if (nodes >= NODE_BUDGET) {
        // Unwinding on a spent budget counts as truncation too, or a search that stops
        // between branches reports a lower bound as though it were the whole answer.
        truncated = true;
        approximate = true;
        return;
      }
      nodes++;
      if (i === order.length) {
        record(coverage, bindings);
        return;
      }
      if (coverage + ceiling[i]! < best) return;
      // Only the tie-collecting pass has a use for branches that cannot beat the best.
      if (!collectTies && solutions.length >= MAX_SOLUTIONS && coverage + ceiling[i]! <= best) {
        tiesPruned = true;
        return;
      }

      const comp = order[i]!;
      const space = targetsFor(comp, bindings);

      const repeats = i > 0 && order[i - 1] === comp;
      const viable: { readonly t: Target; readonly overlap: number; readonly swaps: readonly Target[] }[] = [];
      /** folded-away targets, by the signature of the representative they stand behind */
      const folded = new Map<string, Target[]>();
      for (const t of space) {
        // Identical components are interchangeable, so keep them in generation order.
        // This has to come before the dedup below: dedup first and the representative
        // it keeps may be one this branch has already passed, leaving nothing to try.
        if (repeats && prevOrd !== null && t.ord < prevOrd) continue;
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
          // Targets the hand does not touch are worth nothing now and, since the hand
          // holds no copy of any of their tiles, nothing to a later component either.
          // One representative per (bindings, suits, meld type) therefore stands in for
          // all of them without costing coverage; the rest are kept as swaps, which is
          // where the tiles of a many-sided wait come from.
          const sig = `${bindingKey(t.bindings)}|${t.mask}|${t.type ?? ''}`;
          const behind = folded.get(sig);
          if (behind) {
            behind.push(t);
            continue;
          }
          const swaps: Target[] = [];
          folded.set(sig, swaps);
          viable.push({ t, overlap, swaps });
          continue;
        }
        viable.push({ t, overlap, swaps: EMPTY_TARGETS });
      }

      if (viable.length === 0) {
        // Nothing can ever serve this component - a bare 'kong' with no meld, say.
        // It still costs its tiles, so the pattern simply stays that far away.
        chosen[i] = target([], bindings);
        usedAt[i]!.length = 0;
        missAt[i]!.length = 0;
        altAt[i] = EMPTY_TARGETS;
        step(i + 1, coverage, bindings, mask, null);
        return;
      }
      // Stable, so equal overlaps stay in target-space order and the search stays deterministic.
      viable.sort((a, c) => c.overlap - a.overlap);

      const used = usedAt[i]!;
      const missing = missAt[i]!;
      for (const { t, swaps } of viable) {
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
        altAt[i] = swaps;
        step(i + 1, coverage + used.length, t.bindings, mask | t.mask, t.ord);
        for (const k of used) counts[tileOrder(k)]!++;
        for (const k of t.tiles) claimed[tileOrder(k)]!--;
        if (done) return;
        if (nodes >= NODE_BUDGET) {
          truncated = true;
          approximate = true;
          return;
        }
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

  const needs: TileNeed[] = [];
  if (recorded) {
    for (const kind of KINDS) {
      const value = needKind[tileOrder(kind)]!;
      if (value !== NEED_NONE) needs.push({ kind, claimable: value === NEED_CLAIM });
    }
  }
  return {
    reachable,
    best: recorded ? best : -1,
    size: recorded ? bestSize : fullSize,
    solutions,
    needs,
    truncated,
    approximate,
    tiesPruned,
    meldTiles,
  };
}

export function coverPattern(
  pattern: Pattern,
  hand: HandInput,
  ctx: MatchCtx,
  guards: Guards = {},
  options: CoverOptions = {},
): CoverResult {
  if (pattern.exposure === 'concealed' && hand.melds.some((m) => !m.concealed)) return UNREACHABLE;
  if (pattern.maxSuits !== undefined && suitCount(suitMask(hand.melds.flatMap((m) => [...m.tiles]))) > pattern.maxSuits) {
    return UNREACHABLE;
  }
  const first = search(pattern, hand, ctx, guards, options.claims);
  // The second pass enumerates the ties the first pruned, which is where `needs` and
  // the many-sided waits come from; it can only match or better the first's coverage.
  // Most patterns are narrow enough that the first pass pruned no tie at all, and then
  // it has already seen every lay-out there is to see.
  const needsTies = first.reachable && first.best >= 0 && (first.tiesPruned || first.truncated);
  const found = needsTies ? merge(first, search(pattern, hand, ctx, guards, options.claims, first.best)) : first;
  // Melds cannot be changed, and neither can the ruleset's verdict on a lay-out, so a
  // pattern with no legal arrangement at all is gone for good.
  if (!found.reachable) return UNREACHABLE;
  if (found.best < 0) {
    // Unless the budget ran out first, in which case "nothing found" is this search
    // giving up rather than the rules speaking, and the pattern stays on the list.
    if (!found.truncated) return UNREACHABLE;
    return {
      reachable: true,
      covered: found.meldTiles.length,
      size: found.size,
      meldTiles: found.meldTiles,
      solutions: [],
      needs: [],
      truncated: true,
      approximate: true,
    };
  }
  return {
    reachable: true,
    covered: found.best + found.meldTiles.length,
    size: found.size,
    meldTiles: found.meldTiles,
    solutions: found.solutions,
    needs: found.needs,
    truncated: found.truncated,
    approximate: found.approximate,
  };
}
