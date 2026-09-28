-- 0005: the settled data model (docs/DATA-MODEL.md).
--
-- Written once so the features on the roadmap don't each need their own SQL:
-- who's away, the next-hand ready check, how a game ended, sitting back down,
-- "your tables", a game's history and a room's running scores across games,
-- product numbers. From here, what the app keeps about a table goes in JSON
-- documents it owns and parses (see the doc for each one's shape), and a
-- column is added only for something the database itself must filter, join,
-- index or protect.
--
-- Additive only: nothing is dropped or renamed, so the code already deployed
-- keeps working while this runs, and it's safe to run more than once.

-- ---------------------------------------------------------------- live_state
-- The table's own bookkeeping, saved in the same versioned write as the hand
-- so the two can never disagree: who's away and how many turns they've
-- missed, who has tapped "Next hand", the game's running scores, and how it
-- ended. '{}' reads as a game in play with everyone here. Server-only, like
-- the rest of live_state.
alter table public.live_state add column if not exists table_state jsonb not null default '{}'::jsonb;

-- The next moment the server has to act on this table unasked: the earliest
-- of its clocks, the ready check's deadline, and the hour it's ended for
-- going quiet. The sweep asks only this, so a new kind of timer is a new
-- value, not a new column.
alter table public.live_state add column if not exists wake_at timestamptz;
update public.live_state set wake_at = least(claim_deadline, turn_deadline) where wake_at is null and (claim_deadline is not null or turn_deadline is not null);
create index if not exists live_state_wake_at on public.live_state (wake_at) where wake_at is not null;

-- The last time a person (not a clock, not a bot) moved the table.
alter table public.live_state add column if not exists acted_at timestamptz not null default now();

-- ---------------------------------------------------------------- games
-- How a game ended ('complete', 'host', 'idle', 'abandoned'; the app's words,
-- so no check constraint), and who ended it when someone did.
alter table public.games add column if not exists ended_how text;
alter table public.games add column if not exists ended_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------- game_players
-- Who sat where in each game, and how they finished: the snapshot a game's
-- history, "who won the night", a room's scores across games and a player's
-- own record are all read from. Written when the game is dealt; a seat's row
-- follows whoever holds it (someone taking over from a bot, a bot keeping a
-- leaver's seat); score and place are filled in when the game ends.
create table if not exists public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null,
  name text not null,
  score integer,
  place smallint,
  primary key (game_id, seat)
);
create index if not exists game_players_user on public.game_players (user_id) where user_id is not null;

-- ---------------------------------------------------------------- room_members
-- The group behind a room: everyone who has sat at it, and when they were
-- last there. The seats say who's in which chair right now; this says who
-- the table belongs to, which is what "your tables" on the home page, "not
-- here yet" in the lobby and handing the host's powers on are read from.
create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  games_played integer not null default 0,
  primary key (room_id, user_id)
);
create index if not exists room_members_user on public.room_members (user_id, last_seen_at desc);

-- ---------------------------------------------------------------- app_events
-- Product numbers, one row per thing that happened (a room made, a seat
-- taken, a game dealt, finished or given up, a tutor card opened), with
-- anything particular in data. No foreign keys: the numbers outlive the rows
-- they're about. A new thing to count is a new type, not a new column.
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  type text not null,
  room_id uuid,
  game_id uuid,
  user_id uuid,
  data jsonb not null default '{}'::jsonb
);
create index if not exists app_events_type_at on public.app_events (type, at);

-- ---------------------------------------------------------------- access
-- The browser reads none of these directly; route handlers do, as the
-- service role. RLS on with no policies, and Supabase's default grants on new
-- tables taken back, so a missing policy isn't the only thing in the way.
alter table public.game_players enable row level security;
alter table public.room_members enable row level security;
alter table public.app_events enable row level security;
revoke all on public.game_players, public.room_members, public.app_events from anon, authenticated;
-- live_state holds every seat's tiles. 0002 gave it no policies, so no rows were ever
-- readable, but it kept Supabase's default grants; a second lock costs nothing.
revoke all on public.live_state from anon, authenticated;
-- Nothing in the browser writes a table: every change goes through a route handler.
-- Reads stay as the policies allow (seated players see their room, game and ended hands).
revoke insert, update, delete, truncate on public.rooms, public.games, public.hands, public.hand_results from anon, authenticated;
revoke all on sequence public.app_events_id_seq from anon, authenticated;

-- ---------------------------------------------------------------- commit_table
-- One request against the table, as one transaction: the new live state (only
-- if nobody else has saved since the caller read it) and every move it made,
-- appended to its hand's log, with the hand's result once it ends. Before
-- this, the log was written after the state as separate calls, so a failure
-- between them left a gap and two requests' moves could land out of order;
-- here the row lock on live_state puts each game's commits in version order.
--
-- p_hands: [{ "hand": int, "dealer": int, "progress": {...}, "moves": [...],
--             "result": {...}|null, "settlement": {...}|null, "ended": bool }]
-- A hand's row is created if this request dealt it. Returns the new version,
-- or null when someone else saved first (nothing is written).
create or replace function public.commit_table(
  p_game_id uuid,
  p_expected integer,
  p_state jsonb,
  p_table_state jsonb,
  p_claim_deadline timestamptz,
  p_turn_deadline timestamptz,
  p_wake_at timestamptz,
  p_acted boolean,
  p_hands jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v integer;
  h jsonb;
begin
  update public.live_state
     set version = version + 1,
         state = p_state,
         table_state = p_table_state,
         claim_deadline = p_claim_deadline,
         turn_deadline = p_turn_deadline,
         wake_at = p_wake_at,
         acted_at = case when p_acted then now() else acted_at end,
         updated_at = now()
   where game_id = p_game_id and version = p_expected
  returning version into v;
  if v is null then
    return null;
  end if;
  for h in select * from jsonb_array_elements(coalesce(p_hands, '[]'::jsonb)) loop
    insert into public.hands (game_id, hand_index, dealer, progress, actions, result, settlement, ended_at)
    values (
      p_game_id,
      (h->>'hand')::int,
      (h->>'dealer')::smallint,
      h->'progress',
      coalesce(h->'moves', '[]'::jsonb),
      nullif(h->'result', 'null'::jsonb),
      nullif(h->'settlement', 'null'::jsonb),
      case when (h->>'ended')::boolean then now() end
    )
    on conflict (game_id, hand_index) do update
       set actions = public.hands.actions || coalesce(excluded.actions, '[]'::jsonb),
           result = coalesce(excluded.result, public.hands.result),
           settlement = coalesce(excluded.settlement, public.hands.settlement),
           ended_at = coalesce(public.hands.ended_at, excluded.ended_at);
  end loop;
  return v;
end;
$$;

revoke execute on function public.commit_table(uuid, integer, jsonb, jsonb, timestamptz, timestamptz, timestamptz, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.commit_table(uuid, integer, jsonb, jsonb, timestamptz, timestamptz, timestamptz, boolean, jsonb) to service_role;
