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
