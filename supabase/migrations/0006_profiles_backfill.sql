-- 0006: a profile for every account.
--
-- Every signed-in person, guests included, is meant to have a profile row:
-- 0002's trigger (public.handle_new_user) makes one at sign-up. An account
-- can still be without one if it was made before that trigger was in place
-- (the first guests signed in with the same release as 0002, which was run
-- by hand), or if its owner deleted their own row under 0001's "for all"
-- policy before 0004 took it away. rooms.host_id, room_members.user_id,
-- game_players.user_id and games.ended_by all reference profiles, so such a
-- person can't make a room, is never checked in (the lobby calls them "not
-- here yet", and a Start deals a bot into their seat), and any game they sit
-- at has every player's id left off its game_players rows.
--
-- This makes each missing row as the trigger would have: the name they gave
-- at sign-up, or "Guest" and four digits, and whether they're a guest. No
-- existing row is touched. Safe to run more than once: a second run finds
-- nobody missing.

insert into public.profiles (id, display_name, is_guest)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), 'Guest ' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0')),
       coalesce(u.is_anonymous, false)
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;
