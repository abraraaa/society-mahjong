import { isHonourTile, isSuitTile, numOf, sortTiles, suitOf, tileName, type PrivatePlayerView, type TileKind } from '@society/engine';
import type { CoachSegment } from './types';

/**
 * The small words the tutor builds its sentences from. A newcomer never meets
 * "away" or "off": a count is always tiles, spelt out in a sentence and left
 * as digits only in the plan line, where it has to be short.
 */

/** Characters of bubble text, bold action included, that fit its three lines at 375 and 390 px. */
export const SAY_BUDGET = 105;

const WORDS = ['nought', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** 'one' to 'ten' in a sentence; digits beyond. */
export function countWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n]! : String(n);
}

/** 'one tile', 'two tiles', '11 tiles'. */
export function tilesWord(n: number): string {
  return `${countWord(n)} ${n === 1 ? 'tile' : 'tiles'}`;
}

export function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** The plan line's count: 'complete', '1 tile to go', '7 tiles to go', 'about 7 tiles to go'. */
export function planCount(away: number, approximate: boolean): string {
  if (away <= 0) return 'complete';
  return `${approximate ? 'about ' : ''}${away} ${away === 1 ? 'tile' : 'tiles'} to go`;
}

/** 'a', 'a or b', 'a, b or c'. */
export function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const SUIT_PLURAL: Readonly<Record<'m' | 'p' | 's', string>> = { m: 'Characters', p: 'Dots', s: 'Bamboo' };

/** The tiles that would finish a hand, sorted: '3, 6 or 9 Characters' when they share a suit, else each named. */
export function waitList(kinds: readonly TileKind[]): string {
  const sorted = sortTiles([...new Set(kinds)]);
  const suits = sorted.filter(isSuitTile);
  if (sorted.length > 1 && suits.length === sorted.length && suits.every((k) => suitOf(k) === suitOf(suits[0]!))) {
    return `${orList(suits.map((k) => String(numOf(k))))} ${SUIT_PLURAL[suitOf(suits[0]!) as 'm' | 'p' | 's']}`;
  }
  return orList(sorted.map(tileName));
}

/** A player's name inside a sentence, isolated so a right-to-left name can't reorder the words around it. */
export function isolate(name: string): string {
  return `⁨${name}⁩`;
}

export function textOf(say: readonly CoachSegment[]): string {
  return say.map((s) => s.text).join('');
}

/** How many copies of a tile might still turn up: four, less the player's own and every one already face up. */
export function liveCopies(view: PrivatePlayerView, kind: TileKind): number {
  let seen = view.concealed.filter((k) => k === kind).length;
  for (const p of view.players) {
    for (const m of p.melds) seen += m.tiles.filter((k) => k === kind).length;
    seen += (p.discards ?? []).filter((k) => k === kind).length;
  }
  return Math.max(0, 4 - seen);
}

/** How many times the player has discarded in this hand. */
export function myDiscardCount(view: Pick<PrivatePlayerView, 'me' | 'events'>): number {
  return view.events.filter((e) => e.type === 'discarded' && e.seat === view.me).length;
}

/** One copy, and for a suit tile nothing within two of it in its suit: a tile with no friends. */
export function isLoner(concealed: readonly TileKind[], kind: TileKind): boolean {
  if (concealed.filter((k) => k === kind).length !== 1) return false;
  if (isHonourTile(kind) || !isSuitTile(kind)) return true;
  const suit = suitOf(kind);
  const n = numOf(kind);
  return !concealed.some((k) => k !== kind && isSuitTile(k) && suitOf(k) === suit && Math.abs(numOf(k) - n) <= 2);
}
