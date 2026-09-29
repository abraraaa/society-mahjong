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
/** PostgREST's and Postgres's words for "not with this key": one it can't read or that has expired, none at all, or a role with no right to this. */
const REFUSED = new Set(['PGRST301', 'PGRST302', 'PGRST303', '42501']);
/** What the commit_table probe sends besides its unknown game and version -1: nothing to save. */
const PROBE: TableWrite = { state: {} as HandState, table: NEW_TABLE, deadlines: { claim: null, turn: null }, wakeAt: null, acted: false, hands: [] };
const BEHIND = 'The database is behind the code: the Migrate and deploy workflow applies migration 0005 (docs/DATA-MODEL.md, "Setting up the pipeline").';
const KEY =
  "The database turned the server's key away: check that SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in Vercel is this project's service_role or secret key, not the anon or publishable one, and that it hasn't been rotated since, then redeploy.";
const GRANT =
  "The server's key reads the tables but may not run commit_table, so the function has lost its grant to the service role: run the grant line that follows commit_table in supabase/migrations/0005_settled_model.sql in Supabase's SQL editor, then reload this report.";

type Failure = { readonly message: string; readonly code?: string } | null;
/** What the database said to one check: its error, if any, and the HTTP status it came with (0 when nothing answered). */
interface Answer {
  readonly error: Failure;
  readonly status: number;
}

/**
 * Refused, rather than the thing asked about being missing or the database
 * not answering: a code that says so, or a 401 or 403 with any words at all,
 * since Supabase's gateway turning a wrong or rotated key away says only
 * "Invalid API key".
 */
function refused({ error, status }: Answer): boolean {
  return error !== null && (REFUSED.has(error.code ?? '') || status === 401 || status === 403);
}

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
      const { error, status } = await db.from(t).select('*').limit(0);
      tables[t] = !error ? 'ok' : refused({ error, status }) ? `no access: ${error.message}` : `missing or unreadable: ${error.message}`;
    }
    const probes: [what: string, answer: Answer][] = [];
    for (const [t, c] of COLUMNS) {
      const { error, status } = await db.from(t).select(c).limit(0);
      probes.push([`${t}.${c}`, { error, status }]);
    }
    // An unknown game is a lost race to commit_table, which writes nothing and answers null (supabase/tests/checks.sql).
    const { error, status } = await db.rpc('commit_table', commitArgs(randomUUID(), -1, PROBE));
    probes.push(['commit_table', { error, status }]);
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
 * `ok`, or what went wrong, by kind, each with what to do: `missing: <what>`
 * when the database says a column or the function isn't there (it's behind
 * the code); `no access: <what> (<its words>)` when it refused (a wrong key,
 * or, when only commit_table is refused, the function's lost grant); and
 * `could not check: <what> (<its words>)` for anything else, such as no
 * answer at all, since a database that's down is neither behind nor locked.
 *
 * A key the server's tables refuse is the wrong key: the anon or publishable
 * one reads none of live_state, games or 0005's tables. One that reads them
 * all but may not run commit_table is the service role's, so the grant is
 * what's gone.
 */
function schemaLine(probes: readonly (readonly [what: string, answer: Answer])[]): string {
  const missing: string[] = [];
  const locked: string[] = [];
  const unchecked: string[] = [];
  for (const [what, answer] of probes) {
    const e = answer.error;
    if (!e) continue;
    if (NOT_THERE.has(e.code ?? '')) missing.push(what);
    else (refused(answer) ? locked : unchecked).push(`${what} (${e.message})`);
  }
  const grantLost = locked.length === 1 && locked[0]!.startsWith('commit_table (');
  const lines = [
    ...(missing.length > 0 ? [`missing: ${missing.join(', ')}. ${BEHIND}`] : []),
    ...(locked.length > 0 ? [`no access: ${locked.join(', ')}. ${grantLost ? GRANT : KEY}`] : []),
    ...(unchecked.length > 0 ? [`could not check: ${unchecked.join(', ')}`] : []),
  ];
  return lines.length > 0 ? lines.join(' ') : 'ok';
}

/** `Authorization: Bearer <CRON_SECRET>` from a script, or `?key=<HEALTH_KEY>` from a browser. */
function authorised(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return secretMatches(auth.slice(7), process.env.CRON_SECRET);
  return secretMatches(req.nextUrl.searchParams.get('key'), process.env.HEALTH_KEY);
}
