# Launch checks

Three things to check by hand before the link goes out to everyone. Code can't settle any of them: each depends on a setting in a dashboard or on how a real phone behaves.

1. [The daily sweep keeps Supabase awake](#1-the-daily-sweep-keeps-supabase-awake)
2. [A guest comes back as themselves after a week](#2-a-guest-comes-back-as-themselves-after-a-week-the-iphone-test)
3. [Run the funnel queries](#3-run-the-funnel-queries)

## 1. The daily sweep keeps Supabase awake

**Why it matters.** A Supabase project on the Free plan pauses after 7 days with no activity (docs/PLAN.md §3). While it's paused, every table is down until someone restores the project by hand from the Supabase dashboard. `apps/web/vercel.json` has Vercel call `GET /api/cron/sweep` every day at 04:00 UTC (09:00 in Karachi). The sweep settles tables whose clocks have run out, and the query it makes to do that is what keeps a quiet project awake.

The sweep only runs if Vercel sends the right secret. Vercel adds `Authorization: Bearer <CRON_SECRET>` to its cron calls only when a `CRON_SECRET` environment variable exists. Without it, the route answers **401 before touching the database**, so the daily call keeps nothing awake, and one quiet week pauses the project under your players.

**Check it's set**

1. In Vercel, open the project, then **Settings → Environment Variables**. Look for `CRON_SECRET` with **Production** ticked. Crons only run against production, so Preview and Development don't need it.
2. If it's missing, add it. Use a long random value, for example the output of `openssl rand -hex 32`. Don't reuse `HEALTH_KEY` or any Supabase key.
3. Redeploy production: **Deployments**, then the latest production deployment, then **⋯ → Redeploy**. A new or changed variable only reaches deployments made after the change.

**Check the sweep answers 200**

1. Trigger a run now, rather than waiting for 04:00 UTC. Use **Settings → Cron Jobs**, where `/api/cron/sweep` has a **Run** button, or run `vercel crons run /api/cron/sweep` from a terminal that is linked to the project.
2. Open the logs: **View Logs** next to the job, or the project's **Logs** tab filtered to the path `/api/cron/sweep`. Vercel's own calls carry the user agent `vercel-cron/1.0`.
3. Read the status code on the latest call:
   - **200**: the secret matched and the database answered. The body is `{"swept":N,"results":{...}}`, and N is usually 0. Each result is `ok`, `already moved` (someone at the table moved it first, or the game ended, so there was nothing to do), or what went wrong.
   - **401**: `CRON_SECRET` is missing from Production, or was changed without a redeploy. Nothing reached the database. Go back to "Check it's set".
   - **500**: the secret is fine but the database didn't answer. The function log has a line containing `could not find tables past their clocks`. Open the Supabase dashboard. If the project says it's paused, restore it, then run the sweep again.
4. The next day, check again. The Logs tab should show a 200 from `vercel-cron/1.0` a little after 04:00 UTC. On the Hobby plan Vercel runs a daily job at some point within that hour, not on the minute.

**From a terminal instead.** This also proves which value production holds. Put the secret in the header, never in the URL:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" https://societymahjong.app/api/cron/sweep   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://societymahjong.app/api/cron/sweep                                          # 401
```

A manual call does exactly what the daily one does, so it's safe to repeat. The same header on `https://societymahjong.app/api/health` returns a JSON report starting `{"ok":true` when the server can play. It returns 404 when the secret doesn't match, and 503 when something is missing.

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

`docs/ops/funnel.sql` answers "is anyone actually playing?" from the tables the game already keeps. The file has eight queries, each with a plain-English comment:

1. Rooms created per week.
2. Rooms where at least two people sat down.
3. Games started.
4. Games finished, abandoned or stalled.
5. Hands per game.
6. Distinct players per week, split into new and returning.
7. Time from making a room to dealing its first game.
8. The whole funnel in one row per week.

Every statement is a read. Nothing is changed.

1. In the Supabase dashboard, open the project, then **SQL Editor**, then **New query**.
2. Paste in the whole of `docs/ops/funnel.sql`.
3. Highlight **one** query, from its numbered comment down to its semicolon, and press **Run** (Cmd+Enter, or Ctrl+Enter). The editor runs only what's highlighted. With nothing highlighted it runs the whole file and shows only the last result, which is query 8.
4. Read the grid. To keep a copy, use the export button above the results to save a CSV. Save the snippet as **Funnel** so it's in the sidebar next time.

**Reading it**

- Weeks start on Monday at 00:00 UTC.
- The editor runs as the `postgres` role, which row-level security doesn't restrict, so you see every room, not only yours.
- Your own test tables count. The top of the file shows how to leave them out.
- Counts of people come from who is sitting in each room now, so they're a floor. Someone who stood up is no longer in a seat. The file's header explains this.
- Start with query 8 and read left to right to see where tables drop off. Query 4's **stalled** column counts games nobody finished and nobody left: a room like that stays "playing" for good. In query 6, if **names_given** keeps outrunning **returning**, phones may be forgetting people. Check that against the iPhone test above.

Once a week, on a Monday, is enough to start with.

## Reading the server's error lines

Not a launch check: a key for when something looks wrong. The server writes each error as one line of JSON in Vercel's function logs (the project's **Logs** tab). Type an `event` name below into the search box to find every line of that kind. No line carries a request body, a cookie, a token or a query string, and the only header any line keeps is the user agent on `client_error` lines. Control characters, line separators and bidi controls in a JSON line are written escaped (`\u009b`, `\u2028`, `\u202e` and so on), so each line stays one line and reads in the order it was written.

- **`route_error`**: an API route answered 500 and the player saw "something went wrong". `route` names the route. A database failure reads `could not <what>: <why>`, and `code` holds Postgres's error code.
- **`after_commit_failed`**: a move was saved and the game went on, but a write after it failed. `step` says which one. Each is one write, and the ones after it still ran:
  - `log the move`: that hand's log is missing the move.
  - `open the hand`: the new hand has no row in `hands`, so its log and its end aren't kept.
  - `settle the scores`: the room's running totals missed that hand's points. Everyone's table shows the totals the room holds, so they all agree.
  - `close the hand`: the hand's row isn't marked as ended. Its result was still recorded.
  - `record the result`: the hand is missing from `hand_results`, so the funnel's hand counts are one short for that game.
  - `count the hand`: the game's `hands_played` is one short.
  - `tally the players`: the players' hand counts, which pace their clocks, missed that hand. A profile that couldn't be read or written is logged on its own line starting `recordHand:`.
  - `finish the game`: the game's end didn't fully record, and the game is still active. Anyone at the table pressing **Next hand** once more finishes it. The room is written first, so if that much landed, the lobby already offers the host **Play again**. A room left "playing" by a game that has ended reads as finished, so it can always be dealt again.
- **`request_error`**: an error nothing else caught, such as a page that failed to render. `digest` matches the code on an error page, and `routePath` and `routeType` say where it happened.
- **`client_error`**: a page crashed in a player's browser and its error page sent word. `message` and `path` are what the browser reported, with anything shaped like a credential replaced by `[redacted]`. `userAgent` says which phone and browser. A `digest` ties it to the server's `request_error` line for the same failure, when there is one.
- **`sweep_game_failed`**: the daily sweep couldn't settle one game (`gameId`). The others were still swept. A game someone else moved first isn't logged: it shows as `already moved` in the sweep's results.
- **`stages_read_failed`**: the players' levels couldn't be read, so the table ran a first-timer's clocks, the slowest, for that move or deal. The move itself went through.
- **`leave_settle_failed`**: someone stood up and the bot in their seat couldn't move straight away. The next clock or the sweep plays its move.
- **`poke_failed`**: the others weren't told the table moved. It's rare, because a failed Realtime call is caught first and logged as `broadcast failed`. Their next refresh or clock catches them up.
