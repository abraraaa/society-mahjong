import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The owner's health report, against a fake Supabase client that records
 * every query as its table (or rpc) and its builder calls, and answers each
 * with `db.answer`, so a test can take away one table, column or function
 * and see what the report says.
 */
type Step = readonly [method: string, args: readonly unknown[]];
interface Query {
  readonly target: string;
  readonly steps: Step[];
}
type Failure = { message: string; code?: string };

const db = vi.hoisted(() => ({
  log: [] as Query[],
  answer: (_q: Query): Failure | null => null,
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../lib/supabase/service', () => {
  function query(target: string, steps: Step[] = []): unknown {
    const q: Query = { target, steps };
    db.log.push(q);
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) =>
              Promise.resolve()
                .then(() => {
                  const error = db.answer(q);
                  return { data: error ? null : target.startsWith('rpc:') ? null : [], error };
                })
                .then(ok, fail);
          }
          return (...args: unknown[]) => {
            steps.push([String(prop), args]);
            return builder;
          };
        },
      },
    );
    return builder;
  }
  return {
    createServiceClient: () => ({
      from: (table: string) => query(table),
      rpc: (fn: string, args: unknown) => query(`rpc:${fn}`, [['rpc', [args]]]),
    }),
  };
});

import { GET } from './route';

const HEALTH_KEY = 'health-key-for-tests';
const CRON_SECRET = 'cron-secret-for-tests';
const BEHIND = 'The database is behind the code: the Migrate and deploy workflow applies migration 0005 (docs/DATA-MODEL.md, "Setting up the pipeline").';
const TABLES = ['profiles', 'rooms', 'games', 'live_state', 'hands', 'hand_results', 'game_players', 'room_members', 'app_events'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function get(query = `?key=${HEALTH_KEY}`, headers: Record<string, string> = {}): Promise<Response> {
  return GET(new NextRequest(`https://societymahjong.app/api/health${query}`, { headers }));
}

async function report(query?: string, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await get(query, headers);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The column a query read, when it read one column of a table. */
const reads = (table: string, column: string) => (q: Query) => q.target === table && q.steps.some(([m, [c]]) => m === 'select' && c === column);
const rpc = (q: Query) => q.target === 'rpc:commit_table';

beforeEach(() => {
  db.log.length = 0;
  db.answer = () => null;
  vi.stubEnv('HEALTH_KEY', HEALTH_KEY);
  vi.stubEnv('CRON_SECRET', CRON_SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health', () => {
  it('is a 404 like any missing route without the key, and asks nothing of the database', async () => {
    for (const [query, headers] of [
      ['', {}],
      ['?key=wrong', {}],
      [`?key=${CRON_SECRET}`, {}],
      ['', { authorization: `Bearer ${HEALTH_KEY}` }],
    ] as const) {
      const res = await get(query, headers);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
    }
    expect(db.log).toEqual([]);
  });

  it('says the server can play when every table, column and the function is there, by the browser key or the cron secret', async () => {
    for (const [query, headers] of [[`?key=${HEALTH_KEY}`, {}] as const, ['', { authorization: `Bearer ${CRON_SECRET}` }] as const]) {
      db.log.length = 0;
      const { status, body } = await report(query, headers);
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, schema: 'ok', hint: expect.stringMatching(/^Server can play/) });
      expect(body.tables).toEqual(Object.fromEntries(TABLES.map((t) => [t, 'ok'])));
    }
  });

  it("checks 0005's tables with the rest, each by a read of no rows, never a HEAD request that can't see a missing table", async () => {
    await report();
    for (const t of TABLES)
      expect(db.log).toContainEqual({
        target: t,
        steps: [
          ['select', ['*']],
          ['limit', [0]],
        ],
      });
    expect(JSON.stringify(db.log)).not.toContain('head');
  });

  it("names a table that isn't there, and answers 503", async () => {
    db.answer = (q) =>
      q.target === 'game_players' && q.steps[0]?.[1][0] === '*' ? { code: 'PGRST205', message: "Could not find the table 'public.game_players' in the schema cache" } : null;
    const { status, body } = await report();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.tables).toMatchObject({ game_players: "missing or unreadable: Could not find the table 'public.game_players' in the schema cache", room_members: 'ok' });
  });

  it("checks each of 0005's columns on its own, and probes commit_table with an unknown game at version -1", async () => {
    await report();
    for (const [t, c] of [
      ['live_state', 'table_state'],
      ['live_state', 'wake_at'],
      ['live_state', 'acted_at'],
      ['games', 'ended_how'],
      ['games', 'ended_by'],
    ] as const) {
      expect(db.log).toContainEqual({
        target: t,
        steps: [
          ['select', [c]],
          ['limit', [0]],
        ],
      });
    }
    const probe = db.log.filter(rpc);
    expect(probe).toHaveLength(1);
    const args = probe[0]!.steps[0]![1][0] as Record<string, unknown>;
    // Exactly the nine arguments the store sends, with nothing that could land: a commit to no game, with no moves.
    expect(Object.keys(args).sort()).toEqual(['p_acted', 'p_claim_deadline', 'p_expected', 'p_game_id', 'p_hands', 'p_state', 'p_table_state', 'p_turn_deadline', 'p_wake_at']);
    expect(args).toMatchObject({ p_expected: -1, p_acted: false, p_hands: [], p_claim_deadline: null, p_turn_deadline: null, p_wake_at: null });
    expect(args.p_game_id).toMatch(UUID);

    // A fresh game id each time, so the probe can never be about a real table.
    db.log.length = 0;
    await report();
    const again = db.log.filter(rpc)[0]!.steps[0]![1][0] as Record<string, unknown>;
    expect(again.p_game_id).toMatch(UUID);
    expect(again.p_game_id).not.toBe(args.p_game_id);
  });

  it('names a missing 0005 column and says the database is behind the code, with a 503', async () => {
    db.answer = (q) => (reads('live_state', 'wake_at')(q) ? { code: '42703', message: 'column live_state.wake_at does not exist' } : null);
    const { status, body } = await report();
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.schema).toBe(`missing: live_state.wake_at. ${BEHIND}`);
    // The tables themselves are all there.
    expect(body.tables).toEqual(Object.fromEntries(TABLES.map((t) => [t, 'ok'])));
  });

  it('names commit_table when its probe fails, with a 503', async () => {
    db.answer = (q) => (rpc(q) ? { code: 'PGRST202', message: 'Could not find the function public.commit_table(p_acted, p_claim_deadline, …) in the schema cache' } : null);
    const { status, body } = await report();
    expect(status).toBe(503);
    expect(body.schema).toBe(`missing: commit_table. ${BEHIND}`);
  });

  it('lists everything 0005 added that the server leans on, in one line, when none of it is there', async () => {
    db.answer = (q) =>
      rpc(q)
        ? { code: 'PGRST202', message: 'Could not find the function' }
        : q.steps[0]?.[1][0] !== '*'
          ? { code: '42703', message: 'column does not exist' }
          : ['game_players', 'room_members', 'app_events'].includes(q.target)
            ? { code: 'PGRST205', message: 'Could not find the table' }
            : null;
    const { status, body } = await report();
    expect(status).toBe(503);
    expect(body.schema).toBe(`missing: live_state.table_state, live_state.wake_at, live_state.acted_at, games.ended_how, games.ended_by, commit_table. ${BEHIND}`);
  });

  it("tells a database that won't answer from one that's behind", async () => {
    db.answer = () => ({ message: 'TypeError: fetch failed', code: '' });
    const { status, body } = await report();
    expect(status).toBe(503);
    expect(body.schema).toMatch(/^could not check: live_state\.table_state \(TypeError: fetch failed\), /);
    expect(body.schema).toContain('commit_table (TypeError: fetch failed)');
    expect(body.schema).not.toContain('behind');
  });

  it('checks no table without the database settings, and says so', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    const { status, body } = await report();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, tables: {}, schema: 'not checked: the database settings above are missing' });
    expect(body.settings).toMatchObject({ serviceKey: false });
    expect(db.log).toEqual([]);
  });
});
