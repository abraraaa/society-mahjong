import {
  RULESETS,
  acrossFrom,
  leftOf,
  preplaySubsteps,
  rightOf,
  type HandSpec,
  type PublicGameView,
  type Ruleset,
  type RulesetId,
  type Seat,
  type TileKind,
} from '@society/engine';
import { countWord, isolate } from './words';

/**
 * The West exchange, as the sheet shows it: which way this pass goes, which of
 * the three it is, who gets the tiles, which copies the tutor lights, and who
 * the table is still waiting for once the player has passed.
 */

/** One pass of the exchange: its direction and size, and which pass it is of how many (1-based). */
export interface ExchangeStep {
  readonly direction: 'right' | 'across' | 'left';
  readonly count: number;
  readonly step: number;
  readonly of: number;
}

/**
 * How long a wait after the player's pass goes unshown. Solo's bots all pass after one 450 ms pause, and showing
 * the wait at once would swap the sheet's line and clear its tint for that long, twice a West hand.
 */
export const WAIT_SHOW_MS = 600;

/** The pass the hand is on, or null when the spec has no exchange at that step. */
export function exchangeStep(spec: HandSpec, preplayStep: number): ExchangeStep | null {
  const substeps = preplaySubsteps(spec);
  const at = substeps[preplayStep];
  return at ? { direction: at.direction, count: at.count, step: preplayStep + 1, of: substeps.length } : null;
}

/** The same, from the table's view alone: its ruleset and the hand it's on. Null outside the exchange. */
export function viewExchangeStep(view: Pick<PublicGameView, 'rulesetId' | 'progress' | 'phase' | 'preplayStep'>): ExchangeStep | null {
  if (view.phase !== 'preplay') return null;
  const ruleset = (RULESETS as Partial<Record<RulesetId, Ruleset>>)[view.rulesetId];
  return ruleset ? exchangeStep(ruleset.handSpec(view.progress), view.preplayStep) : null;
}

/** Who gets the tiles `me` passes: the engine's own seats for each direction (reducer.ts, the exchange). */
export function receiverOf(me: Seat, direction: ExchangeStep['direction']): Seat {
  return direction === 'right' ? rightOf(me) : direction === 'across' ? acrossFrom(me) : leftOf(me);
}

const WHICH_WAY: Readonly<Record<ExchangeStep['direction'], string>> = { right: ' to the right', across: ' across', left: ' to the left' };

/** The sheet's heading: 'Pass three tiles to the right', or 'Pass three tiles' when the step isn't known. */
export function exchangeHeading(s: ExchangeStep | null, count: number): string {
  return `Pass ${countWord(count)} tiles${s ? WHICH_WAY[s.direction] : ''}`;
}

/** Which pass this is: '1 of 3'. */
export function exchangeProgress(s: ExchangeStep): string {
  return `${s.step} of ${s.of}`;
}

/** The sheet's line while it's the player's pass: 'They go to Bilal.' The name comes isolated. */
export function goesToLine(name: string): string {
  return `They go to ${name}.`;
}

/** The sheet's line once a wait has lasted: 'Passed. Waiting for Bilal.', or 'Passed.' when nobody's left. */
export function passedLine(waiting: string | null): string {
  return waiting ? `Passed. Waiting for ${waiting}.` : 'Passed.';
}

/** Per hand index: a copy of the suggested multiset, matched left to right. One suggested s1 from two held lights one. */
export function exchangeGlow(hand: readonly TileKind[], suggested: readonly TileKind[]): boolean[] {
  const left = new Map<TileKind, number>();
  for (const k of suggested) left.set(k, (left.get(k) ?? 0) + 1);
  return hand.map((k) => {
    const n = left.get(k) ?? 0;
    if (n === 0) return false;
    left.set(k, n - 1);
    return true;
  });
}

/** Stable keys: kind and copy, as the hand tray keys its tiles, so a tile that stays keeps its node when the hand changes. */
export function tileKeys(hand: readonly TileKind[]): string[] {
  const copies = new Map<TileKind, number>();
  return hand.map((k) => {
    const copy = copies.get(k) ?? 0;
    copies.set(k, copy + 1);
    return `${k}#${copy}`;
  });
}

/**
 * The tiles the sheet shows lifted while the player waits, as keys: the ones the table recorded as passed
 * (`myExchange`), which aren't always the ones this phone picked. The table may have passed for her when the clock
 * ran out, or her other phone may have passed first. Her own picks stay lifted when they're those very kinds, so a
 * pass she made herself changes nothing on screen; otherwise the first copies of the passed kinds are lifted. Nothing
 * is lifted when the table hasn't said what went.
 */
export function passedKeys(hand: readonly TileKind[], picked: readonly string[], passed: readonly TileKind[] | undefined): string[] {
  if (!passed) return [];
  const keys = tileKeys(hand);
  const mine = picked.filter((k) => keys.includes(k));
  const kinds = (tiles: readonly TileKind[]) => [...tiles].sort().join();
  if (kinds(mine.map((k) => hand[keys.indexOf(k)]!)) === kinds(passed)) return mine;
  return exchangeGlow(hand, passed).flatMap((on, i) => (on ? [keys[i]!] : []));
}

/** 'a', 'a and b', 'a, b and c'. */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Who hasn't passed yet this step, as names, each isolated ('Bilal and Sana'), or null when nobody's left. */
export function waitingFor(view: Pick<PublicGameView, 'players'> & { readonly me: Seat }, names: Readonly<Record<Seat, string>>): string | null {
  const still = view.players.filter((p) => p.seat !== view.me && !p.exchanged).map((p) => isolate(names[p.seat]));
  return still.length > 0 ? andList(still) : null;
}
