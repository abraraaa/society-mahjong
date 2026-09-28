import { isHonourTile, isSuitTile, numOf, sortTiles, suitOf, tileName, type LayoutGroup, type PrivatePlayerView, type Seat, type TileKind } from '@society/engine';
import type { CoachSegment } from './types';

/**
 * The small words the tutor builds its sentences from. A newcomer never meets
 * "away" or "off": a count is always tiles, spelt out in a sentence and left
 * as digits only in the plan line, where it has to be short.
 */

/** Characters of bubble text, bold action included, that fit its three lines at 375 and 390 px. */
export const SAY_BUDGET = 105;

/** Visible characters over all the footnotes under one line: two lines at 375 px. Kept beside the bubble's budget so a footnote can be fitted where its words are made; teach.ts re-exports it. */
export const NOTE_BUDGET = 84;

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

/** Characters a reader sees: the isolates round a name take no room, and the budgets were measured on visible text. */
export function visibleLength(s: string): number {
  return s.replace(/[⁨⁩]/g, '').length;
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

/** The player's own moves: after one of these, what went before is old news. */
const MY_MOVES = new Set(['discarded', 'claimed', 'kong']);

/** Whether the player has drawn a flower since their last discard, claim or kong (or since the deal, before their first). */
export function flowerSinceMyLastMove(view: Pick<PrivatePlayerView, 'me' | 'events'>): boolean {
  for (let i = view.events.length - 1; i >= 0; i--) {
    const e = view.events[i]!;
    if (e.seat !== view.me) continue;
    if (e.type === 'bonus') return true;
    if (MY_MOVES.has(e.type)) return false;
  }
  return false;
}

/** A discard that went past the player: who threw it, the tile, and when. */
export interface PassedTile {
  readonly seat: Seat;
  readonly tile: TileKind;
  readonly seq: number;
}

/**
 * Discards by other seats since the player's own last discard, claim or kong
 * (or the deal) that nobody took: the event straight after isn't 'claimed' or
 * 'won'. Newest first. A discard with nothing after it yet is still on offer,
 * so it hasn't gone past anyone.
 */
export function passedSince(view: Pick<PrivatePlayerView, 'me' | 'events'>): readonly PassedTile[] {
  const out: PassedTile[] = [];
  for (let i = view.events.length - 1; i >= 0; i--) {
    const e = view.events[i]!;
    if (e.seat === view.me && MY_MOVES.has(e.type)) break;
    if (e.type !== 'discarded' || e.seat === undefined || e.tile === undefined) continue;
    const next = view.events[i + 1];
    if (!next || next.type === 'claimed' || next.type === 'won') continue;
    out.push({ seat: e.seat, tile: e.tile, seq: e.seq });
  }
  return out;
}

/** The tiles the player has drawn into their hand since event `seq`: off the wall, or to replace a flower. Only they can see them. */
export function drawnSince(view: Pick<PrivatePlayerView, 'me' | 'events'>, seq: number): TileKind[] {
  return view.events.flatMap((e) => (e.seq > seq && e.seat === view.me && (e.type === 'drew' || e.type === 'replacement') && e.tile !== undefined ? [e.tile] : []));
}

/**
 * How a run the tile would have made reads, when a newcomer could read it: the
 * two numbers held and "finished" (or "filled", with a gap between them) for a
 * run of three in one suit, the first and last numbers and "filled" for a
 * longer one. A run across the suits has no such numbers.
 */
function runSpan(group: LayoutGroup): { readonly ab: string; readonly verb: 'finished' | 'filled' } | null {
  const kinds = group.tiles.map((t) => t.kind);
  const suited = kinds.filter(isSuitTile);
  if (suited.length !== kinds.length || suited.length === 0 || !suited.every((k) => suitOf(k) === suitOf(suited[0]!))) return null;
  if (suited.length === 3) {
    const [a, b] = group.tiles.flatMap((t) => (t.held && isSuitTile(t.kind) ? [numOf(t.kind)] : [])).sort((x, y) => x - y);
    if (a === undefined || b === undefined) return null;
    return { ab: `${a}-${b}`, verb: b - a === 1 ? 'finished' : 'filled' };
  }
  const nums = suited.map(numOf).sort((x, y) => x - y);
  return { ab: `${nums[0]}-${nums[nums.length - 1]}`, verb: 'filled' };
}

/**
 * The footnote for a run tile that went past the player (rule:runs): who threw
 * it, what it would have done, and why it couldn't be taken. The first of these
 * that fits NOTE_BUDGET, the last always does. It names no hand (a footnote's
 * words can't hold a hand's button), and never says "That {tile}": the tile
 * may have gone past three discards ago, and nothing on screen shows it.
 */
export function missedRunNote(who: string, kind: TileKind, group: LayoutGroup): string {
  const tile = tileName(kind);
  const name = isolate(who);
  const span = runSpan(group);
  const last = `A thrown ${tile} would have finished a run, but runs only come from the wall.`;
  const attempts = span
    ? [
        `${name}'s ${tile} would have ${span.verb} your ${span.ab} run, but runs only come from the wall.`,
        `${name}'s ${tile} would have ${span.verb} your ${span.ab} run: runs only come from the wall.`,
        `A thrown ${tile} would have ${span.verb} your ${span.ab} run: runs only come from the wall.`,
      ]
    : [`${name}'s ${tile} would have finished a run, but runs only come from the wall.`];
  return [...attempts, last].find((s) => visibleLength(s) <= NOTE_BUDGET) ?? last;
}

/** One copy, and for a suit tile nothing within two of it in its suit: a tile with no friends. */
export function isLoner(concealed: readonly TileKind[], kind: TileKind): boolean {
  if (concealed.filter((k) => k === kind).length !== 1) return false;
  if (isHonourTile(kind) || !isSuitTile(kind)) return true;
  const suit = suitOf(kind);
  const n = numOf(kind);
  return !concealed.some((k) => k !== kind && isSuitTile(k) && suitOf(k) === suit && Math.abs(numOf(k) - n) <= 2);
}
