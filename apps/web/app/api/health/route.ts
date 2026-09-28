import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { HandState } from '@society/engine';
// Relative, not '@/lib', so vitest can load this handler without an alias.
import { commitArgs, type TableWrite } from '../../../lib/live/hand-log';
import { json } from '../../../lib/live/http';
import { secretMatches } from '../../../lib/live/secret';
import { NEW_TABLE } from '../../../lib/live/table-state';
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from '../../../lib/supabase/env';
import { createServiceClient } from '../../../lib/supabase/service';

/** The tables the live table reads and writes. */
const TABLES = ['profiles', 'rooms', 'games', 'live_state', 'hands', 'hand_results', 'game_players', 'room_members', 'app_events'];
/** The columns migration 0005 added that the server leans on, by table. */
const COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ['live_state', 'table_state'],
  ['live_state', 'wake_at'],
  ['live_state', 'acted_at'],
  ['games', 'ended_how'],
  ['games', 'ended_by'],
];
/** Postgres's and PostgREST's words for "there's no such column, table or function". */
const NOT_THERE = new Set(['42703', '42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
/** What the commit_table probe sends besides its unknown game and version -1: nothing to save. */
const PROBE: TableWrite = { state: {} as HandState, table: NEW_TABLE, deadlines: { claim: null, turn: null }, wakeAt: null, acted: false, hands: [] };
const BEHIND = 'The database is behind the code: the Migrate and deploy workflow applies migration 0005 (docs/DATA-MODEL.md, "Setting up the pipeline").';

type Failure = { readonly message: string; readonly code?: string } | null;

/**
 * One URL that says whether the server can play: which settings are present
 * (never their values), whether the tables the live table needs exist, and
 * whether the database has what migration 0005 added (`schema`), so a deploy
 * that ever runs ahead of the database is diagnosed in one look.
 * Open /api/health?key=<HEALTH_KEY> in a browser before blaming the lobby,
 * or send `Authorization: Bearer <CRON_SECRET>` from a script. The browser
 * form gets its own key because a query string lands in request logs and
 * history, and the cron secret must never sit there. Without a matching key
 * it is a 404 like any other missing route: which settings exist is nobody
 * else's business.
 *
 * Every check is a plain read of no rows, never a HEAD request: PostgREST
 * answers a missing table with a 404, and a HEAD response has no body to say
 * so, which supabase-js then reads as success.
 */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return new Response(null, { status: 404 });
  const settings = {
    supabaseUrl: !!supabaseUrl(),
    anonKey: !!supabaseAnonKey(),
    serviceKey: !!supabaseServiceKey(),
    hcaptchaSiteKey: process.env.NEXT_PUBLIC_HCAPTCHA_SITEKEY ? 'from env' : 'project key in lib/captcha.ts',
  };
  const tables: Record<string, string> = {};
  let schema = 'not checked: the database settings above are missing';
  if (settings.supabaseUrl && settings.serviceKey) {
    const db = createServiceClient();
    for (const t of TABLES) {
      const { error } = await db.from(t).select('*').limit(0);
      tables[t] = error ? `missing or unreadable: ${error.message}` : 'ok';
    }
    const probes: [what: string, error: Failure][] = [];
    for (const [t, c] of COLUMNS) probes.push([`${t}.${c}`, (await db.from(t).select(c).limit(0)).error]);
    // An unknown game is a lost race to commit_table, which writes nothing and answers null (supabase/tests/checks.sql).
    probes.push(['commit_table', (await db.rpc('commit_table', commitArgs(randomUUID(), -1, PROBE))).error]);
    schema = schemaLine(probes);
  }
  const ok = settings.supabaseUrl && settings.anonKey && settings.serviceKey && Object.values(tables).every((v) => v === 'ok') && Object.keys(tables).length > 0 && schema === 'ok';
  return json(
    {
      ok,
      settings,
      tables,
      schema,
      hint: ok ? 'Server can play. If the lobby still fails, the message it shows is the next clue.' : 'Something above is missing. Fix it, redeploy, reload this page.',
    },
    ok ? 200 : 503,
  );
}

/**
 * `ok`; or `missing: <what>` and what to do, when the database says a column
 * or the function isn't there; or, when it couldn't be asked at all, what it
 * said instead, since a database that's down isn't one that's behind.
 */
function schemaLine(probes: readonly (readonly [what: string, error: Failure])[]): string {
  const missing = probes.filter(([, e]) => e && NOT_THERE.has(e.code ?? '')).map(([what]) => what);
  if (missing.length > 0) return `missing: ${missing.join(', ')}. ${BEHIND}`;
  const unchecked = probes.flatMap(([what, e]) => (e ? [`${what} (${e.message})`] : []));
  return unchecked.length > 0 ? `could not check: ${unchecked.join(', ')}` : 'ok';
}

/** `Authorization: Bearer <CRON_SECRET>` from a script, or `?key=<HEALTH_KEY>` from a browser. */
function authorised(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return secretMatches(auth.slice(7), process.env.CRON_SECRET);
  return secretMatches(req.nextUrl.searchParams.get('key'), process.env.HEALTH_KEY);
}
