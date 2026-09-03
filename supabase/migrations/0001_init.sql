-- Society Mahjong: initial schema. See docs/PLAN.md §3 "Data model".
create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  onboarding_stage text not null default 'new',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null references public.profiles (id),
  ruleset_id text not null,
  ruleset_options jsonb not null default '{}'::jsonb,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  seats jsonb not null default '[null,null,null,null]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  seed text not null,
  status text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Append-only event log. Public payloads are broadcast; private payloads only ever reach `actor`.
create table public.game_events (
  game_id uuid not null references public.games (id) on delete cascade,
  seq integer not null,
  actor smallint,
  type text not null,
  payload_public jsonb not null default '{}'::jsonb,
  payload_private jsonb,
  created_at timestamptz not null default now(),
  primary key (game_id, seq)
);

-- Latest materialised engine state so a rejoin is one read.
create table public.game_snapshots (
  game_id uuid primary key references public.games (id) on delete cascade,
  version integer not null,
  state jsonb not null,
  claim_deadline timestamptz,
  updated_at timestamptz not null default now()
);

create table public.hand_results (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  hand_index integer not null,
  winner smallint,
  pattern_id text,
  settlement jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.games enable row level security;
alter table public.game_events enable row level security;
alter table public.game_snapshots enable row level security;
alter table public.hand_results enable row level security;

create policy "profiles are readable by everyone" on public.profiles for select using (true);
create policy "users manage their own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

-- Rooms, games and results are readable by anyone seated in the room. Writes go through server routes.
create or replace function public.is_seated(room uuid) returns boolean language sql stable as $$
  select exists (
    select 1 from public.rooms r where r.id = room and r.seats @> to_jsonb(array[auth.uid()::text])
  ) or exists (select 1 from public.rooms r where r.id = room and r.host_id = auth.uid());
$$;

create policy "seated players read rooms" on public.rooms for select using (public.is_seated(id));
create policy "seated players read games" on public.games for select using (public.is_seated(room_id));
create policy "seated players read results" on public.hand_results for select using (
  exists (select 1 from public.games g where g.id = game_id and public.is_seated(g.room_id))
);
-- Snapshots and events contain private tiles: never readable directly by clients.
-- Clients receive public deltas over Realtime Broadcast and their own private view from route handlers.
