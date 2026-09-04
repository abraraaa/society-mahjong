/** Variable binding and tile-filter primitives shared by the matcher and the analyser. */
import {
  SUITS,
  isDragonTile,
  isHonourTile,
  isSimple,
  isSuitTile,
  isTerminal,
  isWindTile,
  numOf,
  suitOf,
  type Suit,
  type TileKind,
} from '../tiles';
import type { Meld } from '../hand';
import type { Bindings, Component, NumRef, Pattern, SuitRef, TileFilter, Var } from './types';

export function isVar(x: unknown): x is Var {
  return typeof x === 'string' && x.startsWith('$');
}

export function suitsFor(ref: SuitRef | undefined, b: Bindings): readonly Suit[] {
  if (ref === undefined) return SUITS;
  if (!isVar(ref)) return [ref];
  const bound = b[ref];
  return bound === undefined ? SUITS : [bound as Suit];
}

export function numsFor(ref: NumRef | undefined, b: Bindings): readonly number[] {
  if (ref === undefined) return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  if (!isVar(ref)) return [ref];
  const bound = b[ref];
  return bound === undefined ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [bound as number];
}

export function bind(b: Bindings, v: Var, value: Suit | number | string): Bindings | null {
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

export function applyFilterAll(kinds: readonly TileKind[], f: TileFilter | undefined, b: Bindings): Bindings | null {
  let out: Bindings | null = b;
  for (const k of kinds) {
    out = applyFilter(k, f, out);
    if (!out) return null;
  }
  return out;
}

export function distinctOk(p: Pattern, b: Bindings): boolean {
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

export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((x, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

/** Components with fewer ways to be satisfied are tried first. */
export function specificity(c: Component): number {
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

export function meldAccepted(comp: Component, meld: Meld, b: Bindings): Bindings | null {
  if (comp.c !== 'set') return null;
  const ok =
    comp.of === 'any' ||
    comp.of === meld.type ||
    (comp.of === 'pungOrKong' && (meld.type === 'pung' || meld.type === 'kong'));
  if (!ok) return null;
  if (comp.concealed && !meld.concealed) return null;
  return applyFilterAll(meld.tiles, comp.filter, b);
}
