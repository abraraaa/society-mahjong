import type { Suit, TileKind, Wind } from '../tiles';
import type { HandInput, MeldType } from '../hand';

/** A `$name` variable bound during matching (to a suit, a number, or a suit order). */
export type Var = `$${string}`;
export type SuitRef = Suit | Var;
export type NumRef = number | Var;

export interface TileFilter {
  readonly suit?: SuitRef;
  readonly num?: NumRef;
  readonly nums?: readonly number[];
  readonly suitTile?: boolean;
  readonly honour?: boolean;
  readonly wind?: boolean;
  readonly dragon?: boolean;
  readonly kinds?: readonly TileKind[];
  readonly terminal?: boolean;
  readonly simple?: boolean;
}

/**
 * Hand patterns are data. A pattern is a list of components that together must
 * consume every tile in the hand (concealed tiles plus melds).
 */
export type Component =
  | { readonly c: 'set'; readonly of: 'chow' | 'pung' | 'kong' | 'pungOrKong' | 'any'; readonly n?: number; readonly filter?: TileFilter; readonly concealed?: boolean }
  | { readonly c: 'pair'; readonly n?: number; readonly filter?: TileFilter }
  /** consecutive run of `len` tiles in one suit; `start` pins or binds the first number */
  | { readonly c: 'seq'; readonly len: number; readonly suit?: SuitRef; readonly start?: NumRef; readonly n?: number }
  /** one tile of each number from..to, each from any suit ("mixed run") */
  | { readonly c: 'mixedRun'; readonly from: number; readonly to: number }
  /** fixed run from..to in one suit */
  | { readonly c: 'run'; readonly from: number; readonly to: number; readonly suit: SuitRef }
  /** exactly one of each listed kind */
  | { readonly c: 'each'; readonly kinds: readonly TileKind[] }
  /** n loose tiles each matching the filter */
  | { readonly c: 'tiles'; readonly n: number; readonly filter: TileFilter }
  /** three tiles of one number, one from each suit ("knitted" set) */
  | { readonly c: 'knit'; readonly n?: number; readonly num?: NumRef }
  /** consecutive numbers with each tile from a different suit, in a consistent suit order across the hand */
  | { readonly c: 'mixedSeq'; readonly n?: number; readonly len?: number; readonly order?: Var }
  /** two tiles of the same number in different suits */
  | { readonly c: 'mixedPair'; readonly n?: number };

export interface Pattern {
  readonly id: string;
  readonly name: string;
  readonly localName?: string;
  readonly source?: string;
  readonly notes?: string;
  readonly components: readonly Component[];
  /** groups of suit variables that must take pairwise distinct values */
  readonly distinct?: readonly (readonly Var[])[];
  /** maximum number of distinct suits among all suit tiles in the hand */
  readonly maxSuits?: number;
  /** 'concealed': no exposed melds allowed (concealed kongs are fine) */
  readonly exposure?: 'any' | 'concealed';
  /** id of a ruleset-provided guard evaluated on each solution */
  readonly guard?: string;
  readonly tags?: readonly string[];
}

export type Bindings = Readonly<Record<string, Suit | number | string>>;

export interface Group {
  readonly c: Component['c'];
  readonly type?: MeldType;
  readonly tiles: readonly TileKind[];
  readonly concealed: boolean;
  readonly fromMeld: boolean;
}

export interface Solution {
  readonly groups: readonly Group[];
  readonly bindings: Bindings;
}

export interface MatchCtx {
  readonly seatWind: Wind;
  readonly roundWind: Wind;
}

export type Guard = (solution: Solution, hand: HandInput, ctx: MatchCtx) => boolean;
export type Guards = Readonly<Record<string, Guard>>;

export interface PatternMatch {
  readonly pattern: Pattern;
  readonly solution: Solution;
}

/** The ordinary "N sets and a pair" hand used by most rulesets. */
export function standardPattern(sets: number, id = 'standard', name = 'Standard hand'): Pattern {
  return { id, name, components: [{ c: 'set', of: 'any', n: sets }, { c: 'pair' }] };
}
