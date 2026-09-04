-- Society Mahjong: M2 rooms, games and the live table. See docs/MULTIPLAYER.md §3–4.
-- Replaces the per-event log from 0001 with a deterministic game log:
-- seed + ordered player actions describe a hand; live_state caches the result.

drop table if exists public.game_events;
drop table if exists public.game_snapshots;

-- ---------------------------------------------------------------- profiles
alter table public.profiles
  add column if not exists handle text unique,
  add column if not exists is_guest boolean not null default false,
  add column if not exists stats jsonb not null default '{}'::jsonb;

-- A profile per auth user, created on sign-up (guests included) so a seat can
-- always point at a profile row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), 'Guest ' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0')),
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- A guest who adds an email stops being a guest; a chosen name follows them.
create or replace function public.handle_user_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set is_guest = coalesce(new.is_anonymous, false),
         display_name = coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), display_name)
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated after update on auth.users
  for each row execute function public.handle_user_updated();

-- ---------------------------------------------------------------- rooms
alter table public.rooms rename column ruleset_options to options;
alter table public.rooms
  add column if not exists ledger jsonb not null default '[]'::jsonb,
  add column if not exists current_game_id uuid,
  add column if not exists updated_at timestamptz not null default now();

-- seats: array of exactly four entries, each null,
--   {"kind":"human","userId":"<uuid>","name":"..."} or {"kind":"bot","name":"..."}.
alter table public.rooms alter column seats set default '[null,null,null,null]'::jsonb;

create or replace function public.is_seated(room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.rooms r, jsonb_array_elements(r.seats) e
     where r.id = room
       and e->>'kind' = 'human'
       and e->>'userId' = auth.uid()::text
  ) or exists (select 1 from public.rooms r where r.id = room and r.host_id = auth.uid());
$$;

-- Which seat the caller holds in a room, or null.
create or replace function public.seat_of(room uuid) returns int
language sql stable security definer set search_path = public as $$
  select (e.ordinality - 1)::int
    from public.rooms r, jsonb_array_elements(r.seats) with ordinality e
   where r.id = room
     and e.value->>'kind' = 'human'
     and e.value->>'userId' = auth.uid()::text
   limit 1;
$$;

-- ---------------------------------------------------------------- games
alter table public.games
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists ended_at timestamptz,
  add column if not exists hands_played int not null default 0,
  add column if not exists replay_url text;

alter table public.rooms
  add constraint rooms_current_game_fk foreign key (current_game_id) references public.games (id) on delete set null;

-- The seed reveals the wall: never readable by clients while a hand is live.
revoke select on public.games from authenticated, anon;
grant select (id, room_id, status, created_at, finished_at, started_at, ended_at, hands_played, replay_url) on public.games to authenticated;

-- ---------------------------------------------------------------- live_state
-- Materialised engine state for the active hand; overwritten on every action
-- under optimistic versioning. Contains every seat's tiles: server-only.
create table public.live_state (
  game_id uuid primary key references public.games (id) on delete cascade,
  version integer not null default 0,
  state jsonb not null,
  claim_deadline timestamptz,
  turn_deadline timestamptz,
  updated_at timestamptz not null default now()
);
create index live_state_deadlines on public.live_state (claim_deadline, turn_deadline);

-- ---------------------------------------------------------------- hands
-- One row per hand: the ordered player actions (appended in place while the
-- hand is live), then the result once it ends. seed + actions = the hand.
create table public.hands (
  game_id uuid not null references public.games (id) on delete cascade,
  hand_index integer not null,
  dealer smallint not null,
  progress jsonb not null,
  actions jsonb not null default '[]'::jsonb,
  result jsonb,
  settlement jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (game_id, hand_index)
);

alter table public.live_state enable row level security;
alter table public.hands enable row level security;

-- Actions replay to every seat's tiles, so a hand's log opens only once it has ended.
create policy "seated players read finished hands" on public.hands for select using (
  ended_at is not null and exists (select 1 from public.games g where g.id = game_id and public.is_seated(g.room_id))
);
-- live_state: no policies at all; only the service role reads or writes it.

-- ---------------------------------------------------------------- realtime
-- Private broadcast channels, authorised by seat:
--   room:{roomId}          lobby changes and "started"
--   game:{gameId}          public deltas for everyone seated
--   game:{gameId}:seat:{n} that seat's private deltas
create or replace function public.can_listen(topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(topic, ':');
  room_id uuid;
  game_id uuid;
  seat int;
begin
  if parts[1] = 'room' and array_length(parts, 1) = 2 then
    room_id := parts[2]::uuid;
    return public.is_seated(room_id);
  elsif parts[1] = 'game' then
    game_id := parts[2]::uuid;
    select g.room_id into room_id from public.games g where g.id = game_id;
    if room_id is null or not public.is_seated(room_id) then return false; end if;
    if array_length(parts, 1) = 2 then return true; end if;
    if array_length(parts, 1) = 4 and parts[3] = 'seat' then
      seat := parts[4]::int;
      return public.seat_of(room_id) = seat;
    end if;
  end if;
  return false;
exception when others then
  return false;
end;
$$;

drop policy if exists "seated players receive their channels" on realtime.messages;
create policy "seated players receive their channels" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.can_listen(realtime.topic()));

-- ---------------------------------------------------------------- helpers used by the server
create or replace function public.append_hand_action(p_game_id uuid, p_hand_index int, p_action jsonb) returns void
language sql security definer set search_path = public as $$
  update public.hands set actions = actions || jsonb_build_array(p_action)
   where game_id = p_game_id and hand_index = p_hand_index;
$$;

create or replace function public.bump_hands_played(p_game_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.games set hands_played = hands_played + 1 where id = p_game_id;
$$;

revoke execute on function public.append_hand_action(uuid, int, jsonb) from public, anon, authenticated;
revoke execute on function public.bump_hands_played(uuid) from public, anon, authenticated;
