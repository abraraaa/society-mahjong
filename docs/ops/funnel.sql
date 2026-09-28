-- Society Mahjong: how tables are doing, week by week.
--
-- How to run these: docs/ops/README.md, "Run the funnel queries". In short,
-- paste this file into the Supabase SQL editor, highlight ONE query (from its
-- comment down to its semicolon) and press Run. Run the whole file at once
-- and the editor shows you only the last result.
--
-- Every statement here is a SELECT: nothing is written, changed or locked.
-- The editor runs as the postgres role, which RLS does not restrict, so you
-- see every room, not only your own.
--
-- Things to know before you read the numbers:
--
-- * Weeks start on Monday at 00:00 UTC (Supabase keeps time in UTC). For
--   Karachi evenings, that is Monday 05:00 PKT.
-- * Your own test tables count too. To leave them out, add
--   `and r.host_id <> '<your user id>'` to the query's where clause (or
--   `where r.host_id <> '...'` if it has none). Your user id is the host_id
--   on a room you made; `select id, code, host_id, created_at from
--   public.rooms order by created_at desc limit 5;` shows your latest ones.
-- * rooms.seats is who is sitting there NOW, not everyone who ever sat.
--   Someone who stands up in the lobby leaves an empty seat, and someone who
--   leaves a live game is replaced by a bot. Counts of people built from
--   seats are therefore a floor, not an exact figure. The host always sat
--   down (a room is created with its host in the first seat), so the host is
--   counted from rooms.host_id even after they stand up.
-- * A human seat is {"kind":"human","userId":"<uuid>","name":"..."}; a bot
--   seat is {"kind":"bot","name":"..."}; an empty seat is null.
-- * hands has one row per hand dealt. ended_at is set once the hand is over,
--   and result says how it went: result->>'type' is 'win', or 'draw' for a
--   washout (the wall ran out). hand_results, which older queries read, is no
--   longer written, so hands is where finished hands are counted.
-- * app_events has one row for each moment the app counts as it happens: a
--   room made, a seat taken, a game dealt, a game finished or abandoned. Only
--   query 9 reads it. The app started writing it with the release that added
--   query 9, so its counts start that day: earlier weeks aren't there, and
--   the first week is only part of one.
--
-- Columns used, checked against the migrations:
--   rooms        id, code, host_id, seats, created_at
--   games        id, room_id, status, started_at, ended_how
--   hands        game_id, result, ended_at
--   profiles     is_guest, created_at
--   app_events   at, type, user_id, data


-- 1. Rooms created per week.
-- Every room ever made, by the week it was made. A room is made when someone
-- taps "Host a table" and gets a code; nobody else need ever turn up.
select
  date_trunc('week', r.created_at)::date as week,
  count(*) as rooms_created
from public.rooms r
group by 1
order by 1 desc;


-- 2. Rooms where at least two humans sat down.
-- Of the rooms made each week, how many had the host plus at least one
-- friend: that is, the invite link worked. People are counted from the seats
-- as they are now, plus the host (see the note at the top), so this is a
-- floor. with_friends_pct is the share of that week's rooms.
with people as (
  select
    r.id,
    r.created_at,
    (
      select count(distinct who)
      from (
        select r.host_id::text as who
        union
        select s.seat ->> 'userId'
        from jsonb_array_elements(r.seats) as s(seat)
        where s.seat ->> 'kind' = 'human'
      ) as seated
    ) as humans
  from public.rooms r
)
select
  date_trunc('week', created_at)::date as week,
  count(*) as rooms_created,
  count(*) filter (where humans >= 2) as rooms_with_friends,
  round(100.0 * count(*) filter (where humans >= 2) / count(*), 0) as with_friends_pct
from people
group by 1
order by 1 desc;


-- 3. Games started per week.
-- A game starts when the host deals (bots fill any empty seats). A room can
-- deal again after a game ends, so this splits first games from games played
-- again in the same room. rooms_that_dealt counts each room once a week.
with numbered as (
  select
    g.id,
    g.room_id,
    g.started_at,
    row_number() over (partition by g.room_id order by g.started_at) as nth_in_room
  from public.games g
)
select
  date_trunc('week', started_at)::date as week,
  count(*) as games_started,
  count(distinct room_id) as rooms_that_dealt,
  count(*) filter (where nth_in_room = 1) as first_games,
  count(*) filter (where nth_in_room > 1) as played_again
from numbered
group by 1
order by 1 desc;


-- 4. Games finished versus abandoned.
-- What became of each week's games:
--   finished:  over, and the final table showed. Split by how it ended
--              (games.ended_how):
--     complete:  the last hand was scored;
--     by_host:   the host ended it;
--     idle:      nobody had played it for hours, so it ended by itself.
--              Games that finished before the reason was recorded count
--              in finished only, so the three can add up to less.
--   abandoned: every human stood up, so the game closed with no result.
--   stalled:   still marked active, but nothing has happened for a day
--              (no hand finished in the last 24 hours, or none at all since
--              a deal more than 24 hours ago). A game nobody plays ends as
--              idle after six hours (the daily sweep ends it), so this
--              should stay at or near zero; one that grows means the sweep
--              isn't running or can't end those games.
--   in_play:   active, with something in the last 24 hours.
with last_seen as (
  select
    g.id,
    g.status,
    g.ended_how,
    g.started_at,
    greatest(g.started_at, (select max(hd.ended_at) from public.hands hd where hd.game_id = g.id)) as last_activity
  from public.games g
)
select
  date_trunc('week', started_at)::date as week,
  count(*) as games_started,
  count(*) filter (where status = 'finished') as finished,
  count(*) filter (where status = 'finished' and ended_how = 'complete') as complete,
  count(*) filter (where status = 'finished' and ended_how = 'host') as by_host,
  count(*) filter (where status = 'finished' and ended_how = 'idle') as idle,
  count(*) filter (where status = 'abandoned') as abandoned,
  count(*) filter (where status = 'active' and last_activity < now() - interval '24 hours') as stalled,
  count(*) filter (where status = 'active' and last_activity >= now() - interval '24 hours') as in_play
from last_seen
group by 1
order by 1 desc;


-- 5. Hands per game.
-- How far games get, split by how they ended (finished, abandoned, or still
-- active). Hands are counted from hands, where a finished hand has its
-- ended_at. no_hand_finished is games that were dealt and left before any
-- hand ended; washout_pct is the share of hands nobody won.
with per_game as (
  select
    g.id,
    g.status,
    count(hd.game_id) filter (where hd.ended_at is not null) as hands,
    count(hd.game_id) filter (where hd.ended_at is not null and hd.result ->> 'type' = 'draw') as washouts
  from public.games g
  left join public.hands hd on hd.game_id = g.id
  group by g.id, g.status
)
select
  status,
  count(*) as games,
  round(avg(hands), 1) as avg_hands,
  percentile_cont(0.5) within group (order by hands) as median_hands,
  max(hands) as most_hands,
  count(*) filter (where hands = 0) as no_hand_finished,
  round(100.0 * sum(washouts) / nullif(sum(hands), 0), 0) as washout_pct
from per_game
group by status
order by status;


-- 6. Distinct human players per week.
-- players: different people seated at a table that dealt a game that week
--   (from the seats, so a floor; bots never count).
-- first_timers: of those, people playing their first week.
-- returning: people who had played in an earlier week too.
-- names_given: new profiles that week, one per person who gave a name at the
--   gate. A returning player whose phone forgot them gives their name again
--   and shows up here as someone new; see the iPhone check in the README.
-- guests: how many of those new profiles are still guests (no email added).
with played as (
  select distinct
    date_trunc('week', g.started_at)::date as week,
    s.seat ->> 'userId' as user_id
  from public.games g
  join public.rooms r on r.id = g.room_id
  cross join lateral jsonb_array_elements(r.seats) as s(seat)
  where s.seat ->> 'kind' = 'human'
),
firsts as (
  select user_id, min(week) as first_week
  from played
  group by user_id
),
names as (
  select
    date_trunc('week', p.created_at)::date as week,
    count(*) as names_given,
    count(*) filter (where p.is_guest) as guests
  from public.profiles p
  group by 1
),
weeks as (
  select week from played
  union
  select week from names
)
select
  w.week,
  count(pl.user_id) as players,
  count(pl.user_id) filter (where f.first_week = w.week) as first_timers,
  count(pl.user_id) filter (where f.first_week < w.week) as returning,
  coalesce(n.names_given, 0) as names_given,
  coalesce(n.guests, 0) as guests
from weeks w
left join played pl on pl.week = w.week
left join firsts f on f.user_id = pl.user_id
left join names n on n.week = w.week
group by w.week, n.names_given, n.guests
order by w.week desc;


-- 7. Time from room creation to first game.
-- For each week's rooms, how long the host waited between making the room
-- and dealing its first game: the time it takes to share the link and for
-- friends to sit down. Medians and the slowest tenth (p90) are in minutes.
-- never_dealt is rooms that were made and never started.
with first_deal as (
  select
    r.id,
    r.created_at,
    min(g.started_at) as dealt_at
  from public.rooms r
  left join public.games g on g.room_id = r.id
  group by r.id, r.created_at
)
select
  date_trunc('week', created_at)::date as week,
  count(*) as rooms_created,
  count(dealt_at) as rooms_that_dealt,
  count(*) - count(dealt_at) as never_dealt,
  round((percentile_cont(0.5) within group (order by extract(epoch from dealt_at - created_at)) / 60)::numeric, 1) as median_minutes,
  round((percentile_cont(0.9) within group (order by extract(epoch from dealt_at - created_at)) / 60)::numeric, 1) as p90_minutes
from first_deal
group by 1
order by 1 desc;


-- 8. The whole funnel, one row per week of room creation.
-- Each column is a subset of the one before, for the rooms made that week:
-- made, then had a friend sit down (as in query 2), then dealt a game, then
-- finished at least one game (played to the final table). Read it left to
-- right to see where tables drop off. dealt_any and finished_any count every
-- room, including a host who played alone against the bots.
with room_facts as (
  select
    r.id,
    r.created_at,
    (
      select count(distinct who)
      from (
        select r.host_id::text as who
        union
        select s.seat ->> 'userId'
        from jsonb_array_elements(r.seats) as s(seat)
        where s.seat ->> 'kind' = 'human'
      ) as seated
    ) as humans,
    exists (select 1 from public.games g where g.room_id = r.id) as dealt,
    exists (select 1 from public.games g where g.room_id = r.id and g.status = 'finished') as finished
  from public.rooms r
)
select
  date_trunc('week', created_at)::date as week,
  count(*) as rooms_created,
  count(*) filter (where humans >= 2) as friends_sat_down,
  count(*) filter (where humans >= 2 and dealt) as then_dealt,
  count(*) filter (where humans >= 2 and finished) as then_finished,
  count(*) filter (where dealt) as dealt_any,
  count(*) filter (where finished) as finished_any
from room_facts
group by 1
order by 1 desc;


-- 9. The funnel's moments, week by week, as they happened.
-- Counted from app_events (see the note at the top): its counts start the
-- day the app began writing them, so this is no help with earlier weeks.
-- Unlike the queries above, nothing here is pieced together from who is
-- sitting where now: each moment was written down when it happened.
--   rooms_made:      rooms created ("Host a table").
--   people_who_sat:  different people who took a seat by the room's link
--                    that week. A host sits down by making the room, so
--                    isn't counted here unless they sat in someone else's.
--   games_dealt:     games dealt, first games and games played again alike.
--   finished:        games that reached the final table, split by how:
--     complete:      the last hand was scored;
--     by_host:       the host ended it;
--     idle:          nobody had played it for six hours, so it ended by
--                    itself.
--   abandoned:       every person stood up, so the game closed with no
--                    result.
-- A game's end is counted in the week it ended, which needn't be the week it
-- was dealt. To leave your own test tables out, add
-- `where e.room_id not in (select id from public.rooms where host_id = '<your user id>')`
-- above the group by.
select
  date_trunc('week', e.at)::date as week,
  count(*) filter (where e.type = 'room_made') as rooms_made,
  count(distinct e.user_id) filter (where e.type = 'seat_taken') as people_who_sat,
  count(*) filter (where e.type = 'game_dealt') as games_dealt,
  count(*) filter (where e.type = 'game_finished') as finished,
  count(*) filter (where e.type = 'game_finished' and e.data ->> 'how' = 'complete') as complete,
  count(*) filter (where e.type = 'game_finished' and e.data ->> 'how' = 'host') as by_host,
  count(*) filter (where e.type = 'game_finished' and e.data ->> 'how' = 'idle') as idle,
  count(*) filter (where e.type = 'game_abandoned') as abandoned
from public.app_events e
group by 1
order by 1 desc;
