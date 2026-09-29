import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysisBot, karachi, viewFor, type Seat } from '@society/engine';
import { commitArgs, handWrites, stamp } from './hand-log';
import { policyFor } from './policy';
import { dealFirstHand, step, type StepResult } from './table';
import { NEW_TABLE, wakeAt } from './table-state';
import type { ClientAction, LiveGame, Seats } from './types';

/*
 * supabase/tests/commit-table-payload.json is what the app sends commit_table,
 * written by this test from a real game: supabase/tests/checks.sql feeds it to
 * the function on a real Postgres (apply.sh, and CI's db job), so the app and
 * the function can't drift apart unnoticed.
 *
 * Run with UPDATE_PAYLOAD=1 to write the file afresh. Otherwise the file's
 * shape (every key, and every value's JSON type, down to each hand entry and
 * each move's v, by, seat and a.type) must be the shape of what the code builds
 * now. Values aren't compared, so an engine or bot change never forces a
 * rewrite; a renamed or missing key, or a changed type, does, and the new file
 * then has to pass apply.sh.
 */

const FILE = new URL('../../../../supabase/tests/commit-table-payload.json', import.meta.url);
const RERUN = 'the commit_table payload has changed shape: run UPDATE_PAYLOAD=1 pnpm exec vitest run lib/live/commit-payload.test.ts, then supabase/tests/apply.sh';

/** One person, in seat 2, so both deals open with the bots' moves. */
const AMNA: Seat = 2;
const seats: Seats = [
  { kind: 'bot', name: 'Bilal' },
  { kind: 'bot', name: 'Sana' },
  { kind: 'human', userId: 'u-amna', name: 'Amna' },
  { kind: 'bot', name: 'Omar' },
];
const SEED = 'payload-1';
const GAME = '00000000-0000-4000-8000-00000000c0de';
const policy = policyFor(['new']);
const T0 = 1_700_000_000_000;

/**
 * A fixed game at a one-person table, as the service would save it: the deal
 * (hand 0's row, the bots' opening moves included), then three of its
 * commits: Amna's first move, the step that finishes hand 0, and the "next
 * hand" that deals hand 1. The steps between the first two are played and
 * counted but left out, so the file stays small; checks.sql applies each
 * commit on top of the last.
 */
function build(): { deal: Record<string, unknown>; commits: unknown[] } {
  const first = dealFirstHand(karachi, seats, SEED, policy, T0);
  const deal = { hand: first.state.progress.handIndex, dealer: first.state.dealer, progress: first.state.progress, moves: stamp(first.moves, 1) };
  let game: LiveGame = { ...first, tableState: NEW_TABLE };
  let version = 1;
  const commits: unknown[] = [];
  /** Save one step as the service does, keeping its arguments when asked. */
  const save = (r: StepResult, now: number, keep: boolean): void => {
    const hands = handWrites(game.state, r.state, stamp(r.moves, version + 1));
    const w = { state: r.state, table: r.tableState, deadlines: r.deadlines, wakeAt: wakeAt({ deadlines: r.deadlines, table: r.tableState, actedAt: now }), acted: true, hands };
    if (keep) commits.push(commitArgs(GAME, version, w));
    version += 1;
    game = r;
  };
  const amnasMove = (now: number): StepResult => {
    const a = (analysisBot(viewFor(game.state, karachi, AMNA), karachi) ?? { type: 'pass', seat: AMNA }) as ClientAction;
    return step({ game, ruleset: karachi, seats, policy, now, action: a, actor: AMNA, seed: SEED });
  };

  save(amnasMove(T0 + 1000), T0 + 1000, true);
  for (let i = 2; i < 400 && game.state.phase !== 'finished'; i++) {
    const r = amnasMove(T0 + i * 1000);
    save(r, T0 + i * 1000, r.state.phase === 'finished');
  }
  if (game.state.phase !== 'finished') throw new Error('hand 0 never finished');
  const next = T0 + 500_000;
  save(step({ game, ruleset: karachi, seats, policy, now: next, action: { type: 'nextHand' }, actor: AMNA, seed: SEED }), next, true);
  return { deal, commits };
}

type Shape = string | readonly Shape[] | { readonly [key: string]: Shape };

function typeOf(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}

/** A time commit_table casts: an ISO string, or null when there's none. Either is the same shape. */
const time = (x: unknown): Shape => (x === null || typeof x === 'string' ? 'time' : typeOf(x));
/** A document commit_table stores whole, such as a hand's result: an object, or null when there's none. */
const doc = (x: unknown): Shape => (x === null || typeOf(x) === 'object' ? 'document' : typeOf(x));

/** Every key of `x`, each with its value's shape: by its rule, or else its JSON type. */
function fields(x: unknown, rules: Readonly<Record<string, (v: unknown) => Shape>> = {}): Shape {
  if (typeOf(x) !== 'object') return typeOf(x);
  const o = x as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, (rules[k] ?? typeOf)(o[k])]),
  );
}

/** A list whose length is the game's business, not the shape's: the distinct shapes of its items. */
function each(x: unknown, item: (v: unknown) => Shape): Shape {
  if (!Array.isArray(x)) return typeOf(x);
  const seen = new Map(x.map((v) => [JSON.stringify(item(v)), item(v)]));
  return [...seen.keys()].sort().map((k) => seen.get(k)!);
}

/** A logged move, as far as commit_table and replay lean on it: v, by, seat and what kind of move it is. */
function move(x: unknown): Shape {
  const m = (typeOf(x) === 'object' ? x : {}) as Record<string, unknown>;
  const a = (typeOf(m['a']) === 'object' ? m['a'] : {}) as Record<string, unknown>;
  return { v: typeOf(m['v']), by: typeOf(m['by']), seat: typeOf(m['seat']), a: typeOf(m['a']), 'a.type': typeOf(a['type']) };
}

/** The engine's own documents (the hand state, its progress) are the engine's shape to change, so only their JSON type counts here. */
const hand = (x: unknown): Shape => fields(x, { progress: typeOf, moves: (v) => each(v, move), result: doc, settlement: doc });
const commit = (x: unknown): Shape =>
  fields(x, {
    p_state: typeOf,
    // The table's bookkeeping is stored whole, so nothing in the database would notice a key the code adds: each part's keys
    // are pinned here instead.
    p_table_state: (v) => fields(v, { absence: (a) => each(a, (e) => fields(e)), ready: (r) => fields(r), took: (t) => each(t, (e) => fields(e)), over: (o) => fields(o) }),
    p_claim_deadline: time,
    p_turn_deadline: time,
    p_wake_at: time,
    p_hands: (v) => (Array.isArray(v) ? v.map(hand) : typeOf(v)),
  });
function shape(payload: unknown): Shape {
  return fields(payload, {
    deal: (v) => fields(v, { progress: typeOf, moves: (m) => each(m, move) }),
    commits: (v) => (Array.isArray(v) ? v.map(commit) : typeOf(v)),
  });
}

/** What the code builds now, as it reaches the database: JSON. */
const built = JSON.parse(JSON.stringify(build())) as ReturnType<typeof build>;
if (process.env['UPDATE_PAYLOAD'] === '1') writeFileSync(FILE, `${JSON.stringify(built)}\n`);
const text = readFileSync(FILE, 'utf8');
const file = JSON.parse(text) as { deal: Record<string, unknown>; commits: Record<string, unknown>[] };

describe('supabase/tests/commit-table-payload.json', () => {
  it('has the shape of what the app sends commit_table now', () => {
    expect(shape(file), RERUN).toEqual(shape(built));
  });

  it('holds a hand that ends with its result, and a hand the next deal made, each after the deal’s own moves', () => {
    const hands = file.commits.flatMap((c) => c['p_hands'] as Record<string, unknown>[]);
    expect((file.deal['moves'] as unknown[]).length).toBeGreaterThan(0);
    expect(
      hands.some((h) => h['ended'] === true && typeOf(h['result']) === 'object'),
      'an ended hand with a result',
    ).toBe(true);
    expect(
      hands.some((h) => (h['hand'] as number) > (file.deal['hand'] as number)),
      'a dealt hand',
    ).toBe(true);
    expect(hands.every((h) => (h['moves'] as unknown[]).length > 0)).toBe(true);
  });

  it('fits in the one command-line argument apply.sh passes it to psql in, which Linux caps at 128 KiB', () => {
    expect(Buffer.byteLength(text)).toBeLessThan(100_000);
  });
});

describe('the shape check', () => {
  it('fails when a key is renamed, dropped or changes type, and passes when only values change', () => {
    const copy = () => JSON.parse(JSON.stringify(built)) as { deal: Record<string, unknown>; commits: Record<string, unknown>[] };
    const handOf = (p: ReturnType<typeof copy>, i: number) => (p.commits[i]!['p_hands'] as Record<string, unknown>[])[0]!;

    const renamed = copy();
    const h = handOf(renamed, 1);
    h['handIndex'] = h['hand'];
    delete h['hand'];
    expect(shape(renamed)).not.toEqual(shape(built));

    const dropped = copy();
    delete dropped.commits[0]!['p_wake_at'];
    expect(shape(dropped)).not.toEqual(shape(built));

    const retyped = copy();
    handOf(retyped, 0)['ended'] = 'false';
    expect(shape(retyped)).not.toEqual(shape(built));

    const moveRenamed = copy();
    (handOf(moveRenamed, 2)['moves'] as Record<string, unknown>[])[0]!['maker'] = 'bot';
    delete (handOf(moveRenamed, 2)['moves'] as Record<string, unknown>[])[0]!['by'];
    expect(shape(moveRenamed)).not.toEqual(shape(built));

    // Other values, another number of moves, a clock that's now set or a washout instead of a win: the same shape.
    const replayed = copy();
    replayed.commits[0]!['p_claim_deadline'] = replayed.commits[0]!['p_claim_deadline'] === null ? '2026-01-01T00:00:00.000Z' : null;
    const ended = handOf(replayed, 1);
    ended['result'] = { type: 'draw' };
    ended['settlement'] = null;
    (ended['moves'] as unknown[]).push(...(ended['moves'] as unknown[]));
    replayed.commits[2]!['p_state'] = { anything: 'the engine likes' };
    expect(shape(replayed)).toEqual(shape(built));
  });
});
