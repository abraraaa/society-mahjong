-- Run after every migration has been applied (apply.sh). Each check raises on failure.
\set ON_ERROR_STOP 1

-- Every table in public has row level security on.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity loop
    raise exception 'RLS is off on public.%', t;
  end loop;
end
$$;

-- The browser's roles hold nothing on the server-only tables.
do $$
declare t text; r text; p text;
begin
  foreach t in array array['live_state', 'game_players', 'room_members', 'app_events'] loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['select', 'insert', 'update', 'delete'] loop
        if has_table_privilege(r, 'public.' || t, p) then raise exception '% may % on public.%', r, p, t; end if;
      end loop;
    end loop;
  end loop;
end
$$;

-- No client role may insert, delete or truncate anywhere, and may update only its own profile's own columns.
do $$
declare t text; r text; p text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['insert', 'delete', 'truncate'] loop
        if has_table_privilege(r, 'public.' || t, p) then raise exception '% may % on public.%', r, p, t; end if;
      end loop;
      if t <> 'profiles' and has_table_privilege(r, 'public.' || t, 'update') then raise exception '% may update public.%', r, t; end if;
    end loop;
  end loop;
end
$$;

-- The seed shows the wall: no client may read it.
do $$
begin
  if has_column_privilege('authenticated', 'public.games', 'seed', 'select') then raise exception 'authenticated can read games.seed'; end if;
  if has_column_privilege('anon', 'public.games', 'seed', 'select') then raise exception 'anon can read games.seed'; end if;
end
$$;

-- Only the service role may commit a table or touch the hand log.
do $$
declare f text;
begin
  foreach f in array array[
    'public.commit_table(uuid, integer, jsonb, jsonb, timestamptz, timestamptz, timestamptz, boolean, jsonb)',
    'public.append_hand_action(uuid, integer, jsonb)',
    'public.bump_hands_played(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception 'a client may run %', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'the service role may not run %', f; end if;
  end loop;
end
$$;

-- commit_table: one request, one transaction; a stale version writes nothing.
do $$
declare
  u uuid := gen_random_uuid();
  r uuid;
  g uuid;
  v integer;
  moves jsonb;
begin
  insert into auth.users (id, is_anonymous) values (u, true);
  insert into public.rooms (code, host_id, ruleset_id) values ('KHI-TEST1', u, 'karachi') returning id into r;
  insert into public.games (room_id, seed) values (r, 'seed') returning id into g;
  insert into public.live_state (game_id, version, state) values (g, 1, '{"phase":"turn"}');

  v := public.commit_table(g, 1, '{"phase":"claim"}', '{"v":1,"absence":[]}', now() + interval '20 seconds', null, now() + interval '20 seconds', true,
    '[{"hand":0,"dealer":0,"progress":{"handIndex":0},"moves":[{"v":2,"by":"player","seat":0,"a":{"type":"discard"}}]}]');
  assert v = 2, 'first commit gives version 2';
  assert (select count(*) from public.hands where game_id = g) = 1, 'the hand row is made by the request that needs it';

  v := public.commit_table(g, 1, '{"phase":"lost"}', '{}', null, null, null, false, '[{"hand":0,"dealer":0,"progress":{},"moves":[{"v":99}]}]');
  assert v is null, 'a stale version is refused';
  assert (select state->>'phase' from public.live_state where game_id = g) = 'claim', 'and writes no state';
  assert jsonb_array_length((select actions from public.hands where game_id = g and hand_index = 0)) = 1, 'and logs no move';

  v := public.commit_table(g, 2, '{"phase":"finished"}', '{"v":1}', null, null, null, false,
    '[{"hand":0,"dealer":0,"progress":{},"moves":[{"v":3,"by":"bot","seat":1}],"result":{"type":"draw"},"settlement":null,"ended":true},
      {"hand":1,"dealer":1,"progress":{"handIndex":1},"moves":[{"v":3,"by":"table"}]}]');
  assert v = 3, 'second commit gives version 3';
  moves := (select actions from public.hands where game_id = g and hand_index = 0);
  assert jsonb_array_length(moves) = 2 and (moves->1->>'by') = 'bot', 'moves append in order';
  assert (select result->>'type' from public.hands where game_id = g and hand_index = 0) = 'draw', 'the result lands with the move that ended the hand';
  assert (select ended_at is not null from public.hands where game_id = g and hand_index = 0), 'and the hand is marked ended';
  assert (select count(*) from public.hands where game_id = g) = 2, 'one request can deal the next hand too';
  assert (select wake_at is null and acted_at is not null from public.live_state where game_id = g), 'the wake time follows the caller';

  delete from public.rooms where id = r;
  delete from auth.users where id = u;
end
$$;

-- commit_table: the parts of its contract the server leans on beyond the lost race.
do $$
declare
  u uuid := gen_random_uuid();
  r uuid;
  g uuid;
  v integer;
  acted timestamptz;
  row_ public.hands%rowtype;
begin
  insert into auth.users (id, is_anonymous) values (u, true);
  insert into public.rooms (code, host_id, ruleset_id) values ('KHI-TEST2', u, 'karachi') returning id into r;
  insert into public.games (room_id, seed) values (r, 'seed') returning id into g;
  -- The deal writes hand 0 itself (startGame), before live_state exists.
  insert into public.hands (game_id, hand_index, dealer, progress, actions) values (g, 0, 2, '{"handIndex":0,"roundWind":"E"}', '[{"v":1,"by":"bot","seat":3}]');
  insert into public.live_state (game_id, version, state, acted_at) values (g, 1, '{"phase":"turn"}', now() - interval '1 hour');
  acted := (select acted_at from public.live_state where game_id = g);

  -- An unknown game is refused and writes nothing: the health check calls it this way to prove the function is there.
  v := public.commit_table(gen_random_uuid(), -1, '{}', '{}', null, null, null, false, '[]');
  assert v is null, 'an unknown game is a lost race';

  -- A clock move: not a person, so acted_at stays; the row's dealer and progress are the deal's, whatever a later commit says.
  v := public.commit_table(g, 1, '{"phase":"turn"}', '{"v":1}', null, now() + interval '90 seconds', now() + interval '90 seconds', false,
    '[{"hand":0,"dealer":0,"progress":{"handIndex":99},"moves":[{"v":2,"by":"clock","seat":0},{"v":2,"by":"bot","seat":1}]}]');
  assert v = 2, 'commit gives version 2';
  assert (select acted_at from public.live_state where game_id = g) = acted, 'a commit that is not a person''s leaves acted_at alone';
  select * into row_ from public.hands where game_id = g and hand_index = 0;
  assert row_.dealer = 2 and row_.progress->>'handIndex' = '0', 'a later commit never rewrites the hand''s dealer or progress';
  assert jsonb_array_length(row_.actions) = 3 and row_.actions->2->>'by' = 'bot' and row_.actions->0->>'v' = '1', 'moves follow the deal''s, in order';
  assert row_.result is null and row_.ended_at is null, 'no result until one is sent';

  -- No moves at all (an "I'm back" between turns): still one version, nothing appended.
  v := public.commit_table(g, 2, '{"phase":"turn"}', '{"v":1,"absence":[]}', null, null, null, true, null);
  assert v = 3, 'a commit with no hands still commits';
  assert (select acted_at from public.live_state where game_id = g) > acted, 'a person''s commit moves acted_at';
  assert jsonb_array_length((select actions from public.hands where game_id = g and hand_index = 0)) = 3, 'and appends nothing';
  assert (select wake_at is null and turn_deadline is null from public.live_state where game_id = g), 'null clocks are written as null';

  -- The hand ends; a later note on the same hand keeps its result and first ended_at. now() is fixed for the whole
  -- transaction, so the first ended_at is moved back a minute: a later commit that wrote its own would be seen.
  v := public.commit_table(g, 3, '{"phase":"finished"}', '{"v":1}', null, null, now() + interval '6 hours', false,
    '[{"hand":0,"dealer":2,"progress":{},"moves":[{"v":4,"by":"player","seat":0}],"result":{"type":"draw"},"settlement":null,"ended":true}]');
  assert (select ended_at is not null from public.hands where game_id = g and hand_index = 0), 'the hand ends with the move that ended it';
  update public.hands set ended_at = ended_at - interval '1 minute' where game_id = g and hand_index = 0;
  acted := (select ended_at from public.hands where game_id = g and hand_index = 0);
  v := public.commit_table(g, 4, '{"phase":"finished"}', '{"v":1}', null, null, null, false,
    '[{"hand":0,"dealer":2,"progress":{},"moves":[{"v":5,"by":"host","seat":0}],"result":null,"settlement":null,"ended":true}]');
  select * into row_ from public.hands where game_id = g and hand_index = 0;
  assert row_.result->>'type' = 'draw' and row_.ended_at = acted, 'a later commit keeps the result and the first ended_at';
  assert (select version from public.live_state where game_id = g) = 5, 'every commit is one version';

  delete from public.rooms where id = r;
  delete from auth.users where id = u;
end
$$;

-- game_players: the key the server writes on, and what happens when a game or a person goes.
do $$
declare
  u uuid := gen_random_uuid();
  w uuid := gen_random_uuid();
  r uuid;
  g uuid;
begin
  insert into auth.users (id, is_anonymous) values (u, true), (w, true);
  insert into public.rooms (code, host_id, ruleset_id) values ('KHI-TEST3', u, 'karachi') returning id into r;
  insert into public.games (room_id, seed) values (r, 'seed') returning id into g;

  -- The deal writes four seats; the finish writes them again with score and place (upsert on game and seat).
  insert into public.game_players (game_id, seat, user_id, kind, name) values (g, 0, u, 'human', 'Amna'), (g, 1, null, 'bot', 'Bilal'), (g, 2, null, 'bot', 'Sana'), (g, 3, w, 'human', 'Zara');
  insert into public.game_players (game_id, seat, user_id, kind, name, score, place) values (g, 3, null, 'bot', 'Omar', -8504, 4)
    on conflict (game_id, seat) do update set user_id = excluded.user_id, kind = excluded.kind, name = excluded.name, score = excluded.score, place = excluded.place;
  assert (select count(*) from public.game_players where game_id = g) = 4, 'one row per seat';
  assert (select name = 'Omar' and user_id is null and place = 4 from public.game_players where game_id = g and seat = 3), 'a seat''s row follows whoever holds it';
  begin
    insert into public.game_players (game_id, seat, kind, name) values (g, 4, 'bot', 'X');
    raise exception 'seat 4 was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.game_players (game_id, seat, kind, name) values (g, 0, 'bot', 'X');
    raise exception 'a second row for seat 0 was accepted';
  exception when unique_violation then null;
  end;
  -- A person with no profile row is refused as 23503, the code the deal answers by writing the seats without ids (store.ts).
  begin
    update public.game_players set user_id = gen_random_uuid() where game_id = g and seat = 1;
    raise exception 'a seat was given a person with no profile';
  exception when foreign_key_violation then null;
  end;
  -- The finish writes the game's row from how it ended, as store.ts finishGame sends it. Who ended it must have a profile
  -- row too, or it's refused as 23503, which the finish answers by writing the row without them.
  begin
    update public.games set ended_by = gen_random_uuid() where id = g;
    raise exception 'a game was ended by a person with no profile';
  exception when foreign_key_violation then null;
  end;
  update public.games set status = 'finished', ended_at = now(), finished_at = now(), ended_how = 'complete', ended_by = null, hands_played = 16 where id = g;
  update public.games set status = 'abandoned', ended_at = now(), ended_how = 'abandoned', ended_by = null, hands_played = 3 where id = g;
  assert (select status = 'abandoned' and ended_how = 'abandoned' and hands_played = 3 and ended_by is null from public.games where id = g), 'the finish writes the game''s row';

  -- A person deleted: their game rows stay as history, without them.
  update public.game_players set user_id = w, kind = 'human', name = 'Zara' where game_id = g and seat = 1;
  update public.games set ended_by = w where id = g;
  delete from auth.users where id = w;
  assert (select ended_by is null from public.games where id = g), 'ended_by forgets a deleted person';
  assert (select user_id is null and name = 'Zara' from public.game_players where game_id = g and seat = 1), 'a seat''s row forgets a deleted person and keeps their name';

  -- A game deleted (the deal gives up on one part way): its players, hands and live table go with it.
  insert into public.hands (game_id, hand_index, dealer, progress) values (g, 0, 0, '{}');
  insert into public.live_state (game_id, version, state) values (g, 1, '{}');
  delete from public.games where id = g;
  assert not exists (select 1 from public.game_players where game_id = g), 'players go with their game';
  assert not exists (select 1 from public.hands where game_id = g) and not exists (select 1 from public.live_state where game_id = g), 'and so do its hands and live table';

  delete from public.rooms where id = r;
  delete from auth.users where id = u;
end
$$;

-- The sweep's first question (wake_at <= now) has its partial index. Its second (no wake_at) scans, which is fine at
-- one row per game; the first never waits behind it (dueGames asks them in turn).
do $$
declare def text;
begin
  select indexdef into def from pg_indexes where schemaname = 'public' and tablename = 'live_state' and indexname = 'live_state_wake_at';
  if def is null then
    raise exception 'live_state has no wake_at index';
  end if;
  if def not like '%(wake_at) WHERE (wake_at IS NOT NULL)' then
    raise exception 'live_state_wake_at is not the partial index on wake_at: %', def;
  end if;
end
$$;

-- The move log holds every seat's moves: a seated player reads a hand's log only once it has ended.
do $$
declare
  u uuid := gen_random_uuid();
  r uuid;
  g uuid;
  seen integer;
begin
  insert into auth.users (id, is_anonymous) values (u, true);
  insert into public.rooms (code, host_id, ruleset_id, seats) values ('KHI-TEST4', u, 'karachi', jsonb_build_array(jsonb_build_object('kind', 'human', 'userId', u::text, 'name', 'Amna'), null, null, null)) returning id into r;
  insert into public.games (room_id, seed) values (r, 'seed') returning id into g;
  insert into public.hands (game_id, hand_index, dealer, progress, actions, ended_at) values (g, 0, 0, '{}', '[{"v":1}]', now()), (g, 1, 1, '{}', '[{"v":9}]', null);
  perform set_config('request.jwt.claim.sub', u::text, true);
  set local role authenticated;
  seen := (select count(*) from public.hands where game_id = g);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  assert seen = 1, format('a seated player sees only the ended hand''s log (saw %s)', seen);
  delete from public.rooms where id = r;
  delete from auth.users where id = u;
end
$$;

-- The server writes these through the service role: the deal and the finish (game_players), check-ins (room_members),
-- the funnel (app_events). Supabase's default grants give it them; this says so out loud.
do $$
declare t text; p text;
begin
  foreach t in array array['game_players', 'room_members', 'app_events'] loop
    foreach p in array array['select', 'insert', 'update'] loop
      if not has_table_privilege('service_role', 'public.' || t, p) then raise exception 'the service role may not % on public.%', p, t; end if;
    end loop;
  end loop;
  if not has_sequence_privilege('service_role', 'public.app_events_id_seq', 'usage') then raise exception 'the service role may not number app_events'; end if;
  -- A deal that fails part way deletes its game (store.ts startGame).
  if not has_table_privilege('service_role', 'public.games', 'delete') then raise exception 'the service role may not drop an unstarted game'; end if;
end
$$;

-- app_events: the row events.ts recordEvent writes, as the service role writes it. Nothing it names has to exist (no
-- foreign keys, so a count outlives what it counts, and an idle end has nobody), and the database stamps when.
do $$
declare
  n bigint;
  m bigint;
  row_ public.app_events;
begin
  set local role service_role;
  insert into public.app_events (type, room_id, game_id, user_id, data)
    values ('game_finished', gen_random_uuid(), gen_random_uuid(), null, '{"how": "idle", "hands": 3, "humans": 1}')
    returning id into n;
  insert into public.app_events (type, room_id, game_id, user_id, data) values ('seat_taken', gen_random_uuid(), null, gen_random_uuid(), '{}')
    returning id into m;
  reset role;
  select * into row_ from public.app_events where id = n;
  assert row_.at is not null and row_.at <= now(), 'app_events stamps when';
  assert row_.data ->> 'how' = 'idle' and row_.user_id is null, 'app_events keeps the data as sent';
  assert m > n, 'app_events numbers each row';
  delete from public.app_events where id in (n, m);
end
$$;

-- commit_table against the payload the app builds (supabase/tests/commit-table-payload.json, written by
-- apps/web/lib/live/commit-payload.test.ts): what commitArgs and commitHands send is what commit_table reads.
create temp table commit_payload as select :'payload'::jsonb as j;
do $$
declare
  p jsonb := (select j from commit_payload);
  u uuid := gen_random_uuid();
  r uuid;
  g uuid;
  v integer := 1;
  c jsonb;
  h jsonb;
  row_ public.hands%rowtype;
begin
  insert into auth.users (id, is_anonymous) values (u, true);
  insert into public.rooms (code, host_id, ruleset_id) values ('KHI-TEST5', u, 'karachi') returning id into r;
  insert into public.games (room_id, seed) values (r, 'seed') returning id into g;
  -- Hand 0 as startGame writes it, then the live row.
  insert into public.hands (game_id, hand_index, dealer, progress, actions)
    values (g, (p->'deal'->>'hand')::int, (p->'deal'->>'dealer')::smallint, p->'deal'->'progress', p->'deal'->'moves');
  insert into public.live_state (game_id, version, state, table_state) values (g, 1, '{}', '{"v":1}');
  for c in select * from jsonb_array_elements(p->'commits') loop
    -- Each commit is applied on top of the one before, whatever version the app's own run had reached.
    v := public.commit_table(g, v, c->'p_state', c->'p_table_state', (c->>'p_claim_deadline')::timestamptz, (c->>'p_turn_deadline')::timestamptz,
      (c->>'p_wake_at')::timestamptz, (c->>'p_acted')::boolean, c->'p_hands');
    assert v is not null, 'every commit the app builds is accepted';
    for h in select * from jsonb_array_elements(c->'p_hands') loop
      select * into row_ from public.hands where game_id = g and hand_index = (h->>'hand')::int;
      assert found, format('hand %s has its row', h->>'hand');
      assert row_.dealer = (h->>'dealer')::smallint and row_.progress->>'handIndex' = h->>'hand', 'with the dealer and progress the app sent';
      if (h->>'ended')::boolean then assert row_.ended_at is not null, 'a hand the app ends is ended'; end if;
      -- A washout has no settlement: stored as none, not as JSON null.
      if jsonb_typeof(h->'result') = 'object' then
        assert row_.result = h->'result' and row_.settlement is not distinct from nullif(h->'settlement', 'null'::jsonb), 'with its result and settlement';
      end if;
    end loop;
    assert (select table_state = c->'p_table_state' and wake_at is not distinct from (c->>'p_wake_at')::timestamptz from public.live_state where game_id = g), 'the table state and wake time land as sent';
  end loop;
  assert v = 1 + jsonb_array_length(p->'commits'), 'one version per commit';
  assert (select sum(jsonb_array_length(actions)) from public.hands where game_id = g)
       = jsonb_array_length(p->'deal'->'moves') + (select coalesce(sum(jsonb_array_length(hm.y->'moves')), 0) from jsonb_array_elements(p->'commits') as cm(x), jsonb_array_elements(cm.x->'p_hands') as hm(y)),
    'every move the app sent is logged';
  assert (select count(*) from public.hands where game_id = g) = 2, 'the deal made the next hand''s row';
  delete from public.rooms where id = r;
  delete from auth.users where id = u;
end
$$;
drop table commit_payload;
