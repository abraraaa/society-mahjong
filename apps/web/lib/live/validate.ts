import { ALL_TILE_KINDS, RULESETS, type ClaimOption, type RulesetId, type Seat, type TileKind } from '@society/engine';
import { NAME_MAX } from '../name-gate';
import type { ClientAction } from './types';

/**
 * Runtime checks for everything a client sends the server. TypeScript types
 * say nothing about a request body, so each parser here takes `unknown`,
 * checks every field it keeps, and builds a fresh value from those fields
 * alone: unknown keys never reach the table, the database or the log. They
 * judge shape only; whether a move is legal is the engine's call.
 */

type Obj = Readonly<Record<string, unknown>>;

function isObject(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const TILE_KINDS: ReadonlySet<string> = new Set(ALL_TILE_KINDS);

/** The most tiles anyone could hold, in any ruleset the engine plays: a bound on tile lists, not a rule. */
const MAX_TILES = Math.max(...Object.values(RULESETS).map((r) => r.shape.handSize)) + 1;

/** Tiles taken from the claimant's own hand, as the engine offers each claim. */
const CLAIM_TILES = { chow: 2, pung: 2, kong: 3 } as const;

export function parseSeat(x: unknown): Seat | null {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 3 ? (x as Seat) : null;
}

export function parseTile(x: unknown): TileKind | null {
  return typeof x === 'string' && TILE_KINDS.has(x) ? (x as TileKind) : null;
}

function parseTiles(x: unknown, min: number, max: number): TileKind[] | null {
  if (!Array.isArray(x) || x.length < min || x.length > max) return null;
  const out: TileKind[] = [];
  for (const t of x) {
    const k = parseTile(t);
    if (k === null) return null;
    out.push(k);
  }
  return out;
}

/** A claim as the engine offers it: a win carries no tiles, a set carries the tiles from the claimant's hand. */
export function parseClaim(x: unknown): ClaimOption | null {
  if (!isObject(x)) return null;
  const { type, tiles } = x;
  if (type === 'win') return tiles === undefined || (Array.isArray(tiles) && tiles.length === 0) ? { type } : null;
  if (type === 'chow' || type === 'pung' || type === 'kong') {
    const kept = parseTiles(tiles, CLAIM_TILES[type], CLAIM_TILES[type]);
    return kept ? { type, tiles: kept } : null;
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id from a URL could name a row: games are keyed by uuid, and
 * Postgres fails a query that filters a uuid column by anything else, where
 * a truncated or hand-edited link should simply find nothing.
 */
export function isUuid(x: unknown): x is string {
  return typeof x === 'string' && UUID.test(x);
}

/**
 * The action in a POST to /act, or null when it is not one a player may send.
 * Server-only moves (resolveClaims) and unknown types are refused outright.
 */
export function parseClientAction(input: unknown): ClientAction | null {
  if (!isObject(input)) return null;
  const { type } = input;
  if (type === 'nextHand') return { type };
  const seat = parseSeat(input.seat);
  if (seat === null) return null;
  if (type === 'declareWin' || type === 'pass') return { type, seat };
  if (type === 'discard' || type === 'declareKong') {
    const tile = parseTile(input.tile);
    return tile ? { type, seat, tile } : null;
  }
  if (type === 'exchange') {
    const tiles = parseTiles(input.tiles, 1, MAX_TILES);
    return tiles ? { type, seat, tiles } : null;
  }
  if (type === 'claim') {
    const claim = parseClaim(input.claim);
    return claim ? { type, seat, claim } : null;
  }
  return null;
}

/** Rulesets a host may create a room with. The engine plays Taiwanese too, but it is not offered. */
export const CREATABLE_RULESETS: readonly RulesetId[] = ['karachi'];

/**
 * The room options the server reads. Only `strict` exists today (the fast
 * clocks in policy.ts, read by the start route and the table); add a key here,
 * with its check, before anything reads it.
 */
export type RoomOptions = {
  readonly strict?: boolean;
};

export type RoomRequest = { readonly ok: true; readonly rulesetId: RulesetId; readonly options: RoomOptions } | { readonly ok: false; readonly error: string };

/** A POST to /api/rooms. An empty body is a Karachi room with no options; anything else is checked key by key. */
export function parseRoomRequest(input: unknown): RoomRequest {
  if (input === undefined || input === null) return { ok: true, rulesetId: 'karachi', options: {} };
  if (!isObject(input)) return { ok: false, error: 'that is not a room request' };
  const rulesetId = input.rulesetId === undefined ? 'karachi' : input.rulesetId;
  if (!(CREATABLE_RULESETS as readonly unknown[]).includes(rulesetId)) return { ok: false, error: 'rooms play Karachi rules' };
  const options = parseRoomOptions(input.options);
  if (!options) return { ok: false, error: 'those room options are not ones we know' };
  return { ok: true, rulesetId: rulesetId as RulesetId, options };
}

/** Known keys with the right type are kept, unknown keys are dropped, and a known key with the wrong type fails the lot. */
export function parseRoomOptions(input: unknown): RoomOptions | null {
  if (input === undefined || input === null) return {};
  if (!isObject(input)) return null;
  const out: { strict?: boolean } = {};
  if (input.strict !== undefined) {
    if (typeof input.strict !== 'boolean') return null;
    out.strict = input.strict;
  }
  return out;
}

/**
 * Characters in a name that print nothing. Every format character goes: the
 * bidi controls (U+202E and friends), which would turn the rest of "Waiting
 * for …" round for everyone at the table, and zero-width spaces, soft hyphens
 * and byte-order marks, which make a name that looks like another or like
 * nothing. So do the fillers Unicode counts as letters or symbols but draws
 * blank (U+115F, U+1160, U+3164, U+FFA0, U+2800). KEPT_FORMAT says which
 * format characters stay.
 */
const INVISIBLE = /[\p{Cf}\u{115f}\u{1160}\u{3164}\u{ffa0}\u{2800}]/gu;

/**
 * The joiners and tag characters stay: emoji are built from U+200D and the
 * tags (a family, a Scottish flag), and Urdu and Persian spelling uses U+200C
 * between letters that mustn't join. None of them reorders anything, and a
 * name made of nothing else is refused anyway.
 */
const KEPT_FORMAT = /^[\u{200c}\u{200d}\u{e0020}-\u{e007f}]$/u;

/**
 * At most this many code points in all, however few characters they make:
 * one letter can carry any number of accents and still count as one
 * character, so without this a name could run to any length. It leaves room
 * for NAME_MAX of nearly anything, or six family emoji at seven each.
 */
const NAME_CODE_POINTS_MAX = NAME_MAX * 2;

/** The characters of a text as a reader counts them, or its code points where the runtime has no Intl.Segmenter. */
function* characters(text: string): Generator<string> {
  if (typeof Intl.Segmenter === 'function') {
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) yield segment;
  } else {
    yield* text;
  }
}

/** The first NAME_MAX characters, whole: an emoji or an accented letter is kept or dropped, never cut. */
function firstCharacters(text: string): string {
  let out = '';
  let count = 0;
  let points = 0;
  for (const c of characters(text)) {
    points += Array.from(c).length;
    if (++count > NAME_MAX || points > NAME_CODE_POINTS_MAX) break;
    out += c;
  }
  // Counting by code point can end on a joiner, which then joins nothing.
  return out.replace(/[\u{200c}\u{200d}]+$/u, '');
}

/**
 * A display name as the table shows it, or null when nothing usable is left.
 * Control characters become spaces, characters that print nothing go (see
 * INVISIBLE), runs of space collapse, and the result is capped at NAME_MAX
 * characters, the name gate's limit too. A name with no letter, number or
 * symbol left (nothing but dots, say) is no name at all.
 */
export function cleanDisplayName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const flat = input
    .replace(/\p{Cc}/gu, ' ')
    .replace(INVISIBLE, (c) => (KEPT_FORMAT.test(c) ? c : ''))
    .replace(/\s+/g, ' ')
    .trim();
  const capped = firstCharacters(flat).trimEnd();
  return /[\p{L}\p{N}\p{S}]/u.test(capped) ? capped : null;
}
