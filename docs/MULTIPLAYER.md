# Multiplayer, Authentication and Profiles (M2 design)

Constraints this design answers: Vercel serverless (no sockets, no timers),
Supabase Free (see PLAN.md §3), an authoritative deterministic engine whose
seed reveals the wall, iOS Safari as a PWA, and a social crowd that will not
tolerate sign-up friction.

## 1. Authentication

**Supabase Auth**, cookie sessions via `@supabase/ssr`, refreshed in the Next.js
`proxy` (the file convention that replaced middleware in Next 16). Decision:
**no Sign in with Apple** (no Apple Developer account needed) and **passkeys
parked** until Supabase's passkey support leaves beta; it shipped as
experimental in May 2026 with an API that may change, which is the wrong
foundation for the sign-in path. The auth module keeps a seam for it so
enabling later is a config change plus one enrolment prompt.

**The front door is the invite, not a sign-in.** A room link or code lands on
a page that asks one question, a name, and seats the visitor as an anonymous
Supabase user bound to that device. That is the whole of v1 onboarding, for
hosts as well as guests: someone has to make the first room, and putting an
email round-trip in front of that is the same friction we are avoiding for
their friends. A guest host's room is bound to their device until they add an
email.

**Magic link is an upgrade, never a gate.** On iOS the app runs as a PWA and a
magic link opens in Mail, then Safari, not in the installed app, so a
sign-in that *requires* the link strands the player outside the table. It is
offered only from the profile, as "keep my history on a new phone", where
landing in Safari is an annoyance rather than a wall. Google covers Android
and desktop friends the same way. Linking is `updateUser` on the anonymous
account, so the seat, ledger and stats carry over in place.

| Provider | Role | Prerequisite |
|---|---|---|
| Anonymous (guest) | The front door: play from a link with a name only | enable in Supabase Auth |
| Magic link (email) | Upgrade from the profile; recovers history on a new device | none |
| Google | Same, for Android and desktop | Google Cloud OAuth client |
| Passkey | Parked until GA; then "Use Face ID next time?" after first sign-in | Supabase passkeys GA, RP id + origins configured |

Not in v1: Sign in with Apple, passkeys (see above), phone OTP (SMS cost,
Twilio setup).

**Guest policy.** Guests show as the name they gave; the ledger records them
by seat. They can stay anonymous for as long as they like. Guests who never
upgrade are pruned after 30 idle days, along with rooms nobody has touched.

**Authority.** Every game route handler resolves the caller's seat from the
session. Clients never write to game tables. The service role is used only
inside route handlers, after the session check, and `games.seed` is
column-revoked from clients outright.

## 2. Profiles

`profiles` is created by a trigger on `auth.users` insert.

| Column | Notes |
|---|---|
| `id` | = auth uid |
| `display_name` | from provider metadata, else "Guest 4821" |
| `handle` | optional, unique, for @-mentions later |
| `avatar_url` | Vercel Blob URL; null means the generated monogram tile |
| `preferences` | tutor level, sounds, haptics, tile style, reduced motion |
| `onboarding_stage` | `new` → `first_hand` → `learning` → `solid` |
| `stats` | denormalised: `hands` and `wins`, tallied by the server as each hand ends; self-draws and favourite hand later |
| `is_guest` | mirrors `auth.users.is_anonymous` |

Default avatar is a monogram rendered as a tile in the player's chosen
colour, so a table of four fresh accounts still looks designed. Uploads go
through a route handler to Blob with size and type checks; we store the URL.

RLS (migration 0004): each person can read only their own profile and update
only `display_name`, `avatar_url`, `preferences` and `handle` on it. Nobody can
insert or delete a profile from the client: the `handle_new_user` trigger
creates it, and the server does everything else with the service role.

## 3. Rooms and games

### Lifecycle

1. **Create.** Host picks ruleset and options (scoring sheet, timer policy,
   tutor allowed for guests, stakes unit for the ledger). Room gets a code,
   `KHI-` and five characters from an alphabet without 0/O/1/I (2^25 codes,
   drawn from the platform's CSPRNG so one code says nothing about the
   next), and a share link `/r/KHI-4287Q`.
2. **Join.** Link → auth (guest allowed) → seat. Host can reorder seats and
   assign bots. Presence shows who is in the lobby. Sitting down is an
   optimistic write: the seats are read together with `rooms.updated_at`
   and the update is conditional on it, so two friends who tap the link in
   the same instant both sit, the second on a re-read of the room (three
   tries, then a 409 asking for another tap), and nobody lands in someone
   else's seat. Standing up and Start carry the same condition: a friend
   who sits down while the host is dealing is not quietly replaced by a
   bot; the host is asked to start again.
3. **Start.** Server creates `games` (seed generated server-side, never
   sent to clients while any hand is live), then the first hand's row with
   the moves the bots made at the deal, then `game_players` (who sat
   where), then the first `live_state` via `startHand`, and only then
   points the room at the game. If any step after the first fails, the game
   is deleted and the host taps Start again, so a room is never pointed at
   a half-dealt game. Broadcasts `hand:started` with public info only.
4. **Play.** Actions as below until the game's rounds are done, or the
   game ends early one of three ways:
   - **The host ends it** (`POST /api/games/:id/end`): between hands with
     "End the game here" under Next hand, or mid-hand from their Leave
     sheet ("End the game for everyone"), each behind a confirmation. A
     hand cut short doesn't count: no points move, and its log gets one
     `endGame` note by the host. Ending on a finished last hand records the
     game as complete. A second tap gets the final table; a commit that
     loses to another request is tried again on a fresh read (three tries).
   - **Nobody plays it for six hours** (`STALE_GAME_MS`, counted from
     `live_state.acted_at`, which moves only for a person's move or end; on
     a table last saved by older code, from the later of that and
     `updated_at`). It ends as idle, by nobody. The daily sweep does this
     first, and so does anyone opening the invite link or the host tapping
     Start in that room, so a room is never stuck "playing".
   - **The last person leaves** (below): abandoned, with no final table.
5. **End.** The request that scores the last hand ends the game, with no
   tap: a move, a clock running out or the bots, whichever finishes it. How
   the game ended (when, how many hands, the final scores and who sat
   where) is saved in `table_state` by the same `commit_table` call as the
   hand, with the clocks stopped, so a game can never be both over and in
   play, and from then on the table takes no more moves. Then the finish
   records it: who finished where, with score and place (`game_players`),
   the room back to "finished", and last the game's own row (`status`,
   `ended_how`, `ended_by`, `ended_at`, `hands_played`). If the finish
   fails part way, the game still reads finished everywhere, and the next
   request that touches it (a look, a tick, the sweep, a leave, or a join
   or Start in its room) writes it again. Everyone's result sheet becomes
   the final table: "Final scores", ranked, and a line such as "That's the
   game. Ayesha finishes top on +14,504." The host's end and the idle end
   work the same way, saved with the table and then finished, with a
   final table whose line says so ("You ended the game after two hands."
   or "This game ended after five hands, because nobody had played for a
   while."). The last person leaving ends the game the same way, as
   abandoned, with no final table. Still to do: the seed becoming readable
   for replay and audit once the game is over, and each game's replay
   (seed + move logs) archived to Blob.

### One action, end to end

```
client  POST /api/games/:id/act  { action, expectedVersion }
server  session → seat
        load live_state (version = expectedVersion, else 409 carrying the current snapshot;
          a Next hand tap that names its hand skips this, and is a vote, below)
        any move of the player's own but a pass marks them here (misses back
          to nought, back from being away)
        resolve any expired deadline first (a bot stands in for an absent
          human, in a claim window as in a turn); a turn or a pass of tiles
          that ran out is a miss, and a second in a row makes that seat away.
          A move of the player's own that this just answered for them isn't
          played (their clock beat it); then reduce(state, action, ruleset)
          // IllegalAction → 400, someone else's seat → 403
        settle: bots, and the bot playing each away seat, act inline until a
          person here has a real decision; a person with nothing to claim is
          passed for, so windows only open when someone can use them
        on a finished hand, the next one starts once everyone here has tapped
          Next hand or the 20-second wait has run out, whatever the request
        a hand won in this request adds its points to the running scores;
          the last hand scored also ends the game (no tap), and a game
          that has ended takes no more moves (409)
        deadlines from the table's timer policy (longest level among the people
          here), for the people here only; a clock already running on the
          same decision, for no one new, keeps running
        commit_table, one transaction, only if version is unchanged (else 409,
          with nothing written): live_state (version+1), table_state, both
          clocks, wake_at, acted_at when a person sent it, and every move the
          request made (the player's, the bots', the clock's, the table's
          passes) appended to the hand's log, with its result once it ends
        then, when a hand ended, count it (unless it ended the game) and
          tally the players; when the game ended, finish it (who finished
          where, the room, the game's row) and count its end for the funnel.
          A failure here is logged, and the move still counts; a finish that
          failed is written again by the next request that touches the game
          (which never counts the end a second time)
        broadcast {version} on game:{id}; every client refetches its own view
        respond with the actor's private view and version
```

"I'm back" (`POST /api/games/:id/back`) and the host's "let a bot play"
(`POST /api/games/:id/away`, `{ seat, sawAt }`) go the same way, as a
change to who plays a seat instead of a move, through the same commit, and
are tried again on a fresh read if another request saves first (three
tries).

Implemented in `apps/web/lib/live/`: `table.ts` is the pure part (settle,
deadlines, expiry, `step`), covered by tests that play whole hands through
it; `absence.ts` keeps who's away; `hand-log.ts` stamps the moves and
builds `commit_table`'s arguments; `service.ts` wraps it all in the load,
the one commit, the steps after it and the broadcast; the route handlers
are thin. Presence is worked out from what people tap, not from who has the
page open (below). Not yet done from the design: `reveal_at` pacing of bot
events (a client currently snaps to the latest view) and the private
per-seat delta channel (policies exist; nothing is sent on it yet).

Redaction is a pure function `viewFor(state, seat | null)`: other players'
concealed tiles become counts, wall and dead wall become counts, seed and
`drawn` are stripped. Nothing private ever enters the public channel.

### Realtime

Supabase Realtime Broadcast, sent from the server over HTTP, with
**private channels** authorised by RLS on `realtime.messages`:

- `game:{id}` — public deltas and Presence. Readable by anyone seated or
  spectating.
- `game:{id}:seat:{n}` — that seat's private deltas. Readable only by the
  user in seat n.

One websocket per client multiplexes both, so 100 players is 100
connections against the 200 cap. Messages per hand are roughly 100 public
× 4 recipients plus 100 private, well within the 2M/month cap at launch
volume; the number to watch as tables multiply.

### Timers without a server clock

Deadlines live on `live_state`: `claim_deadline` and `turn_deadline`
(on a finished hand someone has tapped Next hand on, the turn clock is
when the next hand starts regardless), with `wake_at` saved in the same
write: the earliest of the two clocks and
the moment the game would end as idle, six hours after a person last moved
it (null once the game is over). `wake_at` is the next moment the server
has to act on the table unasked, and it's what the sweep below reads.

- Any incoming request first resolves expired deadlines. A bot stands in
  for whoever did not answer: in a claim window it takes a win they were
  offered, claims a set only when that brings the hand closer, and passes
  on the rest; in a turn it plays the room's policy.
- Every client renders the countdown from the deadline timestamp, so a phone
  that went to sleep shows the right remaining time on wake, and when its
  countdown reaches zero it POSTs `/api/games/:id/tick`, which resolves the
  deadline without applying any action. Any seated player's tick will do, so
  a window closes as soon as one phone at the table notices. The host may tick
  too; anyone else gets a 403.
- A Vercel Cron sweep (`/api/cron/sweep`, `CRON_SECRET`; see
  `docs/ops/README.md` for how to check it runs) is the backstop for
  tables everyone has left. It asks `wake_at` alone, in two questions
  within one limit of 50 (`store.ts` `dueGames`): first the games in play
  whose wake time has passed, earliest first, which an index serves; then,
  with whatever room is left, the games in play with no wake time at all,
  least recently saved first (a game whose end is saved but whose finish
  didn't all land, which the visit finishes, or a table last saved by older
  code). Due tables come first, so parked ones can never crowd out a table
  whose clock has run out. For each table it first ends the game as idle
  if nobody has played it for six hours, and otherwise resolves whatever
  clock ran out, including starting a next hand whose 20-second wait ran
  out with no phone open. On the Hobby plan crons run at most daily, which is why
  the tick above does the real work; Pro makes the sweep per-minute.

**Claim windows are adaptive, and rarely open.** Three things keep the
countdown from frightening anyone:

1. A window only opens when someone at the table *can* claim the discard;
   the engine advances immediately otherwise. Most discards never pause.
2. When everyone who could claim has responded, the window closes early.
   Fast tables never wait out the clock. One person's answer doesn't
   restart anyone else's clock: whoever still owes theirs keeps the time
   they had, and the same goes for a pass of tiles two people owe.
3. The window's length is the **longest** of the levels of the people at
   the table who are here (a bot playing for someone away doesn't count, so
   an away first-timer doesn't slow everyone else):

   | Player level | Claim window | Turn limit |
   |---|---|---|
   | `new` (first three hands) | 20 s, with the coach pointing at the claim | 90 s |
   | `learning` | 12 s | 75 s |
   | `solid` | 7 s | 60 s |

   So a table with one first-timer here waits for the first-timer, and a table
   of regulars runs at 7 seconds, which is the norm in online Hong Kong and
   Taiwanese play and feels quick only until you've done it twice.

   The level is worked out from `profiles.stats`, which the server tallies
   at the end of every hand for each human seat (`hands`, `wins`), on the
   solo table's thresholds: one finished hand is `learning`, three wins are
   `solid` (`lib/live/stage.ts`). `onboarding_stage` is written alongside
   as a mirror for anything else that reads the profile; the timers do not
   read it, so a stage nothing advanced cannot pin the clocks.

   A window in which someone was offered the **win** runs on the turn limit
   instead (90 s for a first-timer). Twenty seconds is enough to take a
   pung; it is not enough to read "Mahjong!" for the first time and believe
   it, and the claim sheet shows the clock in every case so nobody is timed
   out by a deadline they could not see.

When a clock runs out on someone who has gone, what the bot did for them
is kept with the table (their `table_state.absence` entry), so it reaches
their own table whichever phone's request resolved it: the next time their
page looks, it says so in plain words in a line at the top ("You ran out of
time, so a bot discarded the 5 Bamboo for you"; a claimed set is "picked up
that tile to make a set", a declared kong "put down four of a kind"),
rather than leaving them to work out why the hand looks different. It's
sent to that person alone, since a pass of tiles names the tiles. The words
never say pung, chow, kong or exchange (`lib/live/presence.ts`). The host
also hears when someone's clock runs out for the first time, with what they
can do about it ("tap their name to let a bot play for them").

**Next hand.** A tap of Next hand is a vote, from any seated human, not
only the host. The next hand starts as soon as everyone here has tapped
(anyone a bot is playing for, and the bots, aren't waited on), or 20
seconds after the first tap (`NEXT_HAND_WAIT_MS`), whichever comes first.
Once you've tapped, your button reads "Waiting for Sana" and can't be
tapped again, and a line under it counts down ("The next hand starts in
0:14, or as soon as everyone's ready."); someone still to tap reads who's
ready and "or as soon as you tap" when they're the last. The votes are
kept in `table_state.ready` (the hand, who has tapped, and when it starts
regardless), and that start time is the finished hand's turn clock, so the
page's own tick, `wake_at` and the sweep start it with nothing new: the
start happens in whichever request comes first once the table is ready (a
tap, a tick, someone coming back or being handed to a bot), so someone who
leaves or goes away during the wait doesn't hold it up. One person with
three bots starts at once, as before. The tap names the hand it was made
on (`{ type: 'nextHand', hand }`), so it needs no particular version: it
skips the version check, and a commit that loses to another request is
tried again on a fresh read (five tries, `VOTE_ATTEMPTS`), so four people
tapping together while their phones tick never bounce off each other. A
tap on a hand that has already started does nothing, except bring its
person back like any tap; one from a phone on the same person counts once.
A page loaded before votes sends no hand: its tap is checked against the
version it saw, as any move is, and then counts as a vote. After the last
hand there is no next hand: the game has already ended.

**The host's powers** (starting a game, ending one, and letting a bot play
for someone who's stepped away) are worked out, never stored (`seating.ts`
`hostOf`): the room's host while they're seated and here (at a game in
play, not away); otherwise whoever here has sat longest (a seat with no
record of when it was taken counts as longest, then seat order; each seat
is stamped with when its person sat down); nobody who isn't seated. So a
room whose host has stood up, or stepped away, isn't stuck: the table, the
lobby and Start all give the same answer, and a host who comes back gets
their powers back. Watching a table without a seat stays the room's host's
right.

**Playing again.** When the game ends (its last hand scored, or ended by
the host or for being idle), every result sheet becomes the final table.
The button of whoever had the host's powers when it ended, worked out from
who sat where then, says "Play again" and everyone else's "Back to the
room": both lead to the lobby, where Start (now "Play again, same seats")
deals a fresh game for the same seats with the scores back at nought. A
finished game's page keeps showing its own final table, seats and scores,
whatever the room does next. Anyone still on the old table follows the
room channel's `started` message to the new one.

**Leaving.** Any seat can stand up from a live table (Leave, top right,
with a confirmation). A bot takes the seat for the rest of the game so the
others carry on. Everyone else's table says so the next time it looks
("Bilal's left the table, so a bot's playing their seat for now."), which
is at the next move (the bot's own, if the seat owed one) or the slow
poll: getting up changes the seats, not the table, so it pokes no game
channel by itself. Every seat a bot plays is marked "Sana · bot", on its
pill, in the result sheet's rows and on the final table. The host's Leave
sheet has a third answer, "End the game for everyone", which asks again
("End the game now?", saying the hand being played won't count) before
ending it for the whole table. When the
last human leaves, the game ends as `abandoned`, saved with the table like
any other end (a hand cut short doesn't count), and the room goes back to
`finished`; anyone still on the page sees "The table has closed". A Leave
that lands just after the game's end is saved (the last hand scored, its
finish not yet written) gives nothing up: the finish is written instead,
and the seat stays theirs for the host's next deal. So does one that lands
a moment after that end, before its finish closes the room: the final table
has them seated, so closing the room hands the bot's seat back to them. In
the lobby, leaving simply empties the seat.

**Someone who's stepped away.** Turn limits nudge at 20 seconds
remaining. A turn, or a pass of tiles, whose clock runs out on someone is a
miss; a claim window that runs out never counts, either way, and an absent
player is still caught within a lap, because their turn always comes round.
Two misses in a row, even across hands, and the seat is *away*: a bot plays
their tiles at once, as well as it can (it's their hand and their points),
with no clock, so the table runs at full speed, and the clocks are sized by
the people still here. Everyone sees "Sana's away, so a bot's playing their
tiles for now." and her pill reads "Sana · away". The host (whoever has the
host's powers, below) can also tap a person's name to let a bot play for
them straight away; that's refused, with the table, if that person has
tapped something since the host's table was sent. While away, a panel at
the bottom of their own table says why and what the bot has done for them
so far, and "I'm back" hands the seat back ("Welcome back."). Any move of
their own but a pass, or a Next hand tap, brings them back too. A late tap,
sent after their own clock had run out and the bot had moved for them, is
let go rather than refused, and isn't counted as a miss. Someone away when a
hand ends keeps its points, but the hand isn't tallied on their profile.
Leaving while away turns the seat into an ordinary bot's. Nothing
auto-discards, which would feel punitive at a friends' table: a room that
opts into "strict" only gets the shorter clocks (7 s claims for everyone,
30 s turns).

### Reconnect and presence

Reconnect = subscribe to both channels, then `GET /api/games/:id/view`,
which returns the private view with its `version`. Broadcasts carry
`version`; a gap means refetch. The whole thing is one read plus a
subscription, so a killed Safari tab is back in under a second.

Presence means "is a bot playing for them": it comes from what people do,
never from who has the page open. A tap brings someone back; a look (a
view, a tick, a poll, a reconnect, the page coming back into view) never
does, and nor does letting a tile go, since a page left open with nobody at
it passes in every claim window by itself. Spectators get the public
channel only and see hands revealed at the end of each hand, like standing
behind the table.

### Multiple winners and robbing a kong

Taiwanese House and Advanced allow up to three winners on one discard. The
claim window already collects all declarations before resolving; today the
resolver settles only the first winner in order from the discarder's right
(joint settlement is a TODO in the engine, and a ruleset's `multipleWinners`
flag is not yet honoured). Robbing a kong is a TODO in the engine and a
broadcast of the exposed tile with a short claim window once implemented.

## 4. Data model for M2

The tables, the JSON documents the app keeps in them, and the rules for
changing either are in `docs/DATA-MODEL.md`. What a live table keeps:

- `live_state`, one row per game: the engine's `state` under optimistic
  versioning, both clocks, `wake_at` and `acted_at`, and `table_state`, the
  table's own bookkeeping as JSON (`lib/live/table-state.ts`). For now that
  document holds the game's running scores, all at nought when the game is
  dealt; who's away (`absence`, per seat: whose sitting it is, missed turns
  in a row, whether a bot is playing for them and why, the clock moves made
  for them, when they last tapped and what the bot has played while they've
  been away; written once any seat has something in it); who has tapped
  Next hand on a finished hand (`ready`: the hand, their ids and when the
  next hand starts regardless; written only while someone has); and, once the
  game has ended, how it ended (`over`: how, by whom, when, how many hands,
  the final scores and who sat where). A table last
  saved before it existed reads its scores from `rooms.ledger` until its
  next move saves them; nothing writes `rooms.ledger` any more.
- `hands`, one row per hand, made by the request that deals it, with its
  result and settlement once it ends (`hand_results` is no longer written).
  `actions` is the move log: every move in the hand, in order, each
  `{ v, by, seat?, userId?, a }`. `v` is the `live_state` version its
  request produced; `by` says who made it (`player`, `bot`, `clock`, `away`,
  `table` or `host`); `a` is the engine move, or a table note (a seat going
  away, and why; someone back; the game ending), so a hand's log explains
  every bot move in it.
- `game_players`, one row per seat, written at the deal: who sat where, with
  the person's id on a human's row and the name on every row. When the game
  ends they're written again from `over`, with each seat's final score and
  place (ties share a place; nobody is placed in an abandoned game). (If a
  seated person has no profile row, that game's rows are written without
  ids.)
- `games.ended_how` (`complete`, `host`, `idle` or `abandoned`), `ended_by`
  (the host who ended it, if one did), `ended_at` and `hands_played` say
  how the game ended, for the funnel.
- `app_events`, one row for each moment the funnel counts
  (`lib/live/events.ts`, read by `docs/ops/funnel.sql` query 9): a room
  made, a seat taken by the room's link, a game dealt (with how many people
  were at each level, or `levels: null` when the levels couldn't be read),
  and a game finished (with how it ended) or abandoned. Each is written as
  it happens, and a write that fails is logged, never a failed request. A
  game's end is counted only by the request that ended it, so it's counted
  once.
- Replaying a hand (`lib/live/hand-log.ts` `replayHand`): deal it from the
  game's seed with its progress, its dealer and its dealer streak (the run of
  hand rows just before it with the same dealer, which is why the streak
  isn't stored), then play the log's moves in array order, skipping table
  notes. Hands begun before every move was logged hold bare actions and
  don't replay.

RLS: seated users read `rooms`, `games`, `hands` (actions only after the
hand ends), `hand_results`; nobody reads `live_state` or `games.seed`
directly. Realtime authorisation policies mirror the seat assignments.

## 5. What this does not do

No public matchmaking, no ranked play, no real money, no video. Chat is
short text and reactions on the public channel, rate-limited per user.
Anti-cheat is the authoritative server plus the hidden seed; a friends' app
does not need more than that.
