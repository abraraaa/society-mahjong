# Launch checks

Three things to check by hand before the link goes out to everyone. Code can't settle any of them: each depends on a setting in a dashboard or on how a real phone behaves.

1. [The daily sweep keeps Supabase awake](#1-the-daily-sweep-keeps-supabase-awake)
2. [A guest comes back as themselves after a week](#2-a-guest-comes-back-as-themselves-after-a-week-the-iphone-test)
3. [Run the funnel queries](#3-run-the-funnel-queries)

## 1. The daily sweep keeps Supabase awake

**Why it matters.** A Supabase project on the Free plan pauses after 7 days with no activity (docs/PLAN.md §3). While it's paused, every table is down until someone restores the project by hand from the Supabase dashboard. `apps/web/vercel.json` has Vercel call `GET /api/cron/sweep` every day at 04:00 UTC (09:00 in Karachi). The sweep settles tables whose clocks have run out and ends games nobody has played for six hours, and the queries it makes to find them are what keep a quiet project awake.

It asks two questions of `live_state.wake_at`, the next moment a table needs the server without anyone asking: the earliest of its clocks, or six hours after a person last moved it, when it would end as idle.

1. Which games in play have a wake time that has passed? Earliest first. This includes tables parked on a finished hand that nobody has dealt the next one from, once six hours have gone by.
2. With whatever is left of its 50 places, which games in play have no wake time at all? Least recently saved first. These are games that have ended but whose end didn't fully record (the visit records it), and tables last saved by older code.

It asks in that order, so however many tables are parked, they can never push out one whose clock has run out.

For each table it finds, it first checks whether anyone has played it in the last six hours. If nobody has, it ends the game as idle: everyone who opens it sees the final table, saying the game ended because nobody had played for a while, and the host can deal again from the room. Otherwise it settles whatever clock ran out. Anyone opening the invite link, or the host tapping Start, ends an idle game in that room the same way, so a room is never stuck "playing".

The sweep only runs if Vercel sends the right secret. Vercel adds `Authorization: Bearer <CRON_SECRET>` to its cron calls only when a `CRON_SECRET` environment variable exists. Without it, the route answers **401 before touching the database**, so the daily call keeps nothing awake, and one quiet week pauses the project under your players.

**Check it's set**

1. In Vercel, open the project, then **Settings → Environment Variables**. Look for `CRON_SECRET` with **Production** ticked. Crons only run against production, so Preview and Development don't need it.
2. If it's missing, add it. Use a long random value, for example the output of `openssl rand -hex 32`. Don't reuse `HEALTH_KEY` or any Supabase key.
3. Redeploy production: **Deployments**, then the latest production deployment, then **⋯ → Redeploy**. A new or changed variable only reaches deployments made after the change.

**Check the sweep answers 200**

1. Trigger a run now, rather than waiting for 04:00 UTC. Use **Settings → Cron Jobs**, where `/api/cron/sweep` has a **Run** button, or run `vercel crons run /api/cron/sweep` from a terminal that is linked to the project.
2. Open the logs: **View Logs** next to the job, or the project's **Logs** tab filtered to the path `/api/cron/sweep`. Vercel's own calls carry the user agent `vercel-cron/1.0`.
3. Read the status code on the latest call:
   - **200**: the secret matched and the database answered. The body is `{"swept":N,"results":{...}}`. N counts the tables from both questions, and is often 0. Each result is `ended` (nobody had played that game for six hours, so it was ended as idle), `ok` (a clock that had run out was settled, a game whose end didn't fully record was finished, or there was nothing to do yet), `already moved` (someone at the table moved it first, or the game ended, so there was nothing to do), or what went wrong.
   - **401**: `CRON_SECRET` is missing from Production, or was changed without a redeploy. Nothing reached the database. Go back to "Check it's set".
   - **500**: the secret is fine but the database didn't answer. The function log has a line containing `could not find tables past their clocks`. Open the Supabase dashboard. If the project says it's paused, restore it, then run the sweep again.
4. The next day, check again. The Logs tab should show a 200 from `vercel-cron/1.0` a little after 04:00 UTC. On the Hobby plan Vercel runs a daily job at some point within that hour, not on the minute.

**From a terminal instead.** This also proves which value production holds. Put the secret in the header, never in the URL:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" https://societymahjong.app/api/cron/sweep   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://societymahjong.app/api/cron/sweep                                          # 401
```

A manual call does exactly what the daily one does, so it's safe to repeat. The same header on `https://societymahjong.app/api/health` returns a JSON report starting `{"ok":true` when the server can play. It returns 404 when the secret doesn't match, and 503 when something is missing.

The report's `schema` line checks that the database has what migration 0005 added and the server relies on: `table_state`, `wake_at` and `acted_at` on `live_state`, `ended_how` and `ended_by` on `games`, and the `commit_table` function. It asks the function about a game that doesn't exist, so the check saves nothing.

- `ok`: all there.
- `missing: …`: names what isn't there, which means the database is behind the code, and every live table fails until it's fixed. Run the _Migrate and deploy_ workflow (GitHub, then Actions, then _Migrate and deploy_, then Run workflow; set up as in docs/DATA-MODEL.md, "Setting up the pipeline"), then reload the report.
- `no access: …`: the database refused the server, and every live table fails until it's fixed. The line says which of two things it is:
  - **The key is wrong.** Some `tables` lines start `no access` too. Supabase says `Invalid API key` to a wrong or rotated key, and `permission denied` to the anon or publishable key where the service key should be (it can read a few tables, but not `live_state`, `games` or 0005's). In Vercel, check `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) against the project's **service_role** or **secret** key (Supabase, then Project Settings, then API Keys), fix it for Production, redeploy, and reload the report.
  - **`commit_table` has lost its grant.** Every `tables` line reads `ok` and only `commit_table` is refused, so the key is right but the function may not be run by it. In Supabase's SQL editor, run the `grant execute on function public.commit_table(…) to service_role;` line from `supabase/migrations/0005_settled_model.sql`, then reload the report.
- `could not check: …`: the database said something else, or nothing at all. Usually it didn't answer, the `tables` lines say the same, and a paused project is the usual cause (see the 500 above). If the tables all read `ok`, the words in brackets are the clue.

When more than one of these applies, the line gives each in turn, in that order.

**While you're in Supabase**, check the plan under the organisation's billing settings. A paid plan doesn't pause, so this check matters only on Free.

## 2. A guest comes back as themselves after a week (the iPhone test)

**Why it matters.** A guest has no account. Who they are lives on their phone, in two places:

- the Supabase session, in cookies named `sb-<project-ref>-auth-token` (sometimes split into `.0` and `.1`);
- the name they gave, in local storage under `sm:name`.

Safari deletes a site's script-written storage after 7 days of Safari use without a visit to that site. That covers local storage and cookies set from JavaScript. A group that plays weekly sits right on that edge.

A Home Screen app keeps storage separate from Safari's. WebKit says it counts days of use only while the app itself is open, so it shouldn't lose data that way. None of this has been checked on a real device.

When a phone forgets someone:

- They're asked for their name again.
- They're then a stranger to their own table, and see that it's full, has already started, or has closed. A finished room turns newcomers away a week after its last game.
- A host loses the start button on the room they made.

**What you need**: one iPhone, used as normal for the whole test, with a normal tab in Safari (not a Private tab), and 8 days.

**Day 0**

1. In Safari, open https://societymahjong.app, tap **Host a table**, and give the name **Safari test**. Write down the room code. Don't start the game: the host's start button is part of the check.
2. Still in Safari, tap **Share → Add to Home Screen**, then open **Society** from the Home Screen.
3. Write down whether the app asks for a name. If it does, the app doesn't share Safari's identity. Someone who plays in Safari and then installs the app becomes a new guest, which is worth knowing on its own.
4. In the app, type the code into **Got a code?**, tap **Join**, and give the name **App test**. The lobby should now show two people, Safari test and App test.
5. Optional, with a Mac: connect the iPhone and open **Safari → Develop → [the iPhone] → the page → Storage**. Note that Cookies has `sb-…-auth-token` and Local Storage has `sm:name`.

**Days 1 to 8**

6. Don't open the site or the app. Do use Safari every day for other browsing: WebKit counts days Safari is used, not calendar days. Don't clear history or website data.

**Day 8 or later**

7. In Safari, open https://societymahjong.app/r/CODE, from history or typed in.
   - **Pass**: you land straight in the lobby as Safari test, in your seat, with the start button. You don't see a name box or a captcha.
   - **Fail**: any of these:
     - the name box appears again;
     - after giving a name you're told the table is full, started or closed;
     - you're seated but have no start button, which means you came back as a new guest rather than the host.
8. Open **Society** from the Home Screen, enter the code, and tap **Join**.
   - **Pass**: you're back in the lobby as App test, in the same seat.
   - **Fail**: the same signs as above.
9. If you have the Mac to hand, repeat step 5 to see which of the cookie and the name survived.

**Record** the date, the iOS version and pass or fail for Safari and for the app, at the end of this file or wherever launch notes live. If either fails, weekly players will lose their seats, and the email upgrade that docs/MULTIPLAYER.md describes ("magic link is an upgrade, never a gate") moves up the list: it's the way a guest's identity outlives the phone's storage.

## 3. Run the funnel queries

`docs/ops/funnel.sql` answers "is anyone actually playing?" from the tables the game already keeps. The file has nine queries, each with a plain-English comment:

1. Rooms created per week.
2. Rooms where at least two people sat down.
3. Games started.
4. Games finished (split by how they ended), abandoned or stalled.
5. Hands per game.
6. Distinct players per week, split into new and returning.
7. Time from making a room to dealing its first game.
8. The whole funnel in one row per week.
9. The same moments as the app counted them when they happened: rooms made, people who took a seat, games dealt, games finished (split by how they ended) and abandoned.

Every statement is a read. Nothing is changed.

1. In the Supabase dashboard, open the project, then **SQL Editor**, then **New query**.
2. Paste in the whole of `docs/ops/funnel.sql`.
3. Highlight **one** query, from its numbered comment down to its semicolon, and press **Run** (Cmd+Enter, or Ctrl+Enter). The editor runs only what's highlighted. With nothing highlighted it runs the whole file and shows only the last result, which is query 9.
4. Read the grid. To keep a copy, use the export button above the results to save a CSV. Save the snippet as **Funnel** so it's in the sidebar next time.

**Reading it**

- Weeks start on Monday at 00:00 UTC.
- The editor runs as the `postgres` role, which row-level security doesn't restrict, so you see every room, not only yours.
- Your own test tables count. The top of the file shows how to leave them out.
- Counts of people come from who is sitting in each room now, so they're a floor. Someone who stood up is no longer in a seat. The file's header explains this.
- Start with query 8 and read left to right to see where tables drop off. Query 4 splits **finished** by how the game ended: **complete** (the last hand was scored), **by_host** (the host ended it) and **idle** (nobody played it for six hours, so it ended by itself). Games that finished before the reason was recorded count only in **finished**. Its **stalled** column counts games still marked in play with no hand finished for a day. Now that a game nobody plays ends after six hours, it should stay at or near zero: a count that keeps growing means the daily sweep isn't running (section 1) or can't settle those games (`sweep_game_failed` below). In query 6, if **names_given** keeps outrunning **returning**, phones may be forgetting people. Check that against the iPhone test above.
- Query 9 doesn't rebuild anything from who's sitting where now: the app writes each moment down as it happens (the `app_events` table). Its counts start the week the app began writing them, so earlier weeks aren't there and that first week is only part of one. **people_who_sat** is people who took a seat by the room's link; a host sits by making the room, so they're in **rooms_made** instead. A game's end is counted in the week it ended. Once a few weeks have built up, its **games_dealt** should be close to query 3's **games_started** for the same weeks, and its finished and abandoned counts close to query 4's; they differ by games that ended in a different week from the one they were dealt, and by deals that failed part way (`drop_game_failed` below), which only query 3 sees. A column that falls well short means the app couldn't write some of them (`event_write_failed` below).

Once a week, on a Monday, is enough to start with.

## Reading the server's error lines

Not a launch check: a key for when something looks wrong. The server writes each error as one line of JSON in Vercel's function logs (the project's **Logs** tab). Type an `event` name below into the search box to find every line of that kind. No line carries a request body, a cookie, a token or a query string, and the only header any line keeps is the user agent on `client_error` lines. Control characters, line separators and bidi controls in a JSON line are written escaped (`\u009b`, `\u2028`, `\u202e` and so on), so each line stays one line and reads in the order it was written.

- **`route_error`**: an API route answered 500 and the player saw "something went wrong". `route` names the route. A database failure reads `could not <what>: <why>`, and `code` holds Postgres's error code.
  - `could not save the table` means nothing of that move was saved. Each move is saved in one go, with the table, its running totals, every move it made and, when a hand ends, the hand's result, or not at all. So the move didn't count, and the next look shows the table as it was.
  - `could not open the first hand`, `could not seat the players`, `could not deal the first hand` or `could not point the room at the game`, on `/api/rooms/[code]/start`, means the host's Start stopped part way. The half-dealt game was deleted (unless `drop_game_failed` follows) and the room was never pointed at it, so the host just taps Start again.
- **`after_commit_failed`**: a move was saved and the game went on, but one of the writes after it failed. The table, its running totals, the hand's log and a finished hand's result were all saved with the move, so none of them is missing. `step` says which write failed. Each is one write, and the ones after it still ran:
  - `count the hand`: the game's `hands_played` is one short. (A hand that ends the game isn't counted this way: the finish writes the game's count itself.)
  - `tally the players`: the players' hand counts, which pace their clocks, missed that hand. A profile that couldn't be read or written is logged on its own line starting `recordHand:`.
  - `finish the game`: the game ended, and its end was saved with the move, so every table already shows the final scores. What didn't fully record is the bookkeeping around it, written in this order: who finished where (`game_players`), the room, then the game's own row, which still says `active`. The line's `message` says which write failed: `could not record how everyone finished`, `could not close the room` or `could not finish the game`. The next request that touches the game writes it all again: anyone opening or refreshing the table, a clock's tick, someone leaving, someone opening the invite link or the host tapping Start in that room, or the daily sweep. A line with `heal: true` is one of those tries failing too; the next one tries again. Opening the room (both of the final table’s buttons do) and tapping Start both finish it first, so the host can still deal again.
- **`request_error`**: an error nothing else caught, such as a page that failed to render. `digest` matches the code on an error page, and `routePath` and `routeType` say where it happened.
- **`client_error`**: a page crashed in a player's browser and its error page sent word. `message` and `path` are what the browser reported, with anything shaped like a credential replaced by `[redacted]`. `userAgent` says which phone and browser. A `digest` ties it to the server's `request_error` line for the same failure, when there is one.
- **`sweep_game_failed`**: the daily sweep couldn't settle one game (`gameId`), or couldn't end it as idle. The others were still swept. A game someone else moved first isn't logged: it shows as `already moved` in the sweep's results.
- **`stages_read_failed`**: the players' levels couldn't be read, so the table ran a first-timer's clocks, the slowest, for that move or deal. The move itself went through.
- **`drop_game_failed`**: a host's Start stopped part way, and the game it had begun couldn't be deleted either. The host was told the deal didn't work and can tap Start again; the failure that stopped it has its own `route_error` line, unless it was the seats changing under the host. The room was never pointed at that game, so nobody can reach it, but the funnel's query 3 counts it as a game started. `gameId` names it. It's safe to delete that `games` row by hand: its first hand, players and live table go with it.
- **`profile_missing`**: someone sitting down to a new game, or at the table when a game ended, has no profile row, which every signed-in person gets when they first sign in (the `on_auth_user_created` trigger). The deal or the finish went ahead anyway: who sat where, or who finished where (`game_players`), was written for that game by name, without anyone's id, or the game's row without who ended it. `gameId` names the game. One now and then is harmless; if it keeps appearing, check the trigger is still in place.
- **`leave_settle_failed`**: someone stood up and the bot in their seat couldn't move straight away. The next clock or the sweep plays its move.
- **`poke_failed`**: the others weren't told the table moved. It's rare, because a failed Realtime call is caught first and logged as `broadcast failed`. Their next refresh or clock catches them up.
- **`event_write_failed`**: one of the moments the funnel's query 9 counts couldn't be written. `type` says which (`room_made`, `seat_taken`, `game_dealt`, `game_finished` or `game_abandoned`), with `roomId` and `gameId` where they apply. Nothing else was affected: the room was still made, the seat taken, the game dealt or ended, and the player never knew. Query 9 is one short for that week, and stays so: a game's end is counted only by the request that ended it, never written later. One now and then is harmless. If they all fail, check `/api/health` (section 1): under `tables`, `app_events` should read `ok`.
- **`table_state_newer`**: a table's bookkeeping (`live_state.table_state`) was written by a newer version of the app than the one running, which usually means production was rolled back. The older code won't save over what it can't read, so that table's moves, clocks and sweep answer "something went wrong" (each also logged as `route_error`, or `sweep_game_failed` from the sweep) until the newer version is deployed again. Players can still open the table and look. `gameId` names the table, and the line says which version wrote it. Roll forward, not back.
