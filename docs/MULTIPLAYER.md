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
4. **Play.** Actions as below until the game's rounds are done or the host
   dissolves it.
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
   game. Ayesha finishes top on +14,504." The last person leaving ends the
   game the same way, as abandoned, with no final table. Still to do: the
   seed becoming readable for replay and audit once the game is over, and
   each game's replay (seed + move logs) archived to Blob.

### One action, end to end

```
client  POST /api/games/:id/act  { action, expectedVersion }
server  session → seat
        load live_state (version = expectedVersion, else 409 carrying the current snapshot)
        resolve any expired deadline first (a bot stands in for an absent
          human, in a claim window as in a turn), then reduce(state, action, ruleset)
          // IllegalAction → 400, someone else's seat → 403
        settle: bots act inline until a human has a real decision; a human
          with nothing to claim is passed for, so windows only open when
          someone can use them
        a hand won in this request adds its points to the running scores;
          the last hand scored also ends the game (no tap), and a game
          that has ended takes no more moves (409)
        deadlines from the table's timer policy (longest level at the table)
        commit_table, one transaction, only if version is unchanged (else 409,
          with nothing written): live_state (version+1), table_state, both
          clocks, wake_at, acted_at when a person sent it, and every move the
          request made (the player's, the bots', the clock's, the table's
          passes) appended to the hand's log, with its result once it ends
        then, when a hand ended, count it (unless it ended the game) and
          tally the players; when the game ended, finish it (who finished
          where, the room, the game's row). A failure here is logged, and
          the move still counts; a finish that failed is written again by
          the next request that touches the game
        broadcast {version} on game:{id}; every client refetches its own view
        respond with the actor's private view and version
```

Implemented in `apps/web/lib/live/`: `table.ts` is the pure part (settle,
deadlines, expiry, `step`), covered by tests that play whole hands through
it; `hand-log.ts` stamps the moves and builds `commit_table`'s arguments;
`service.ts` wraps it all in the load, the one commit, the steps after it
and the broadcast; the route handlers are thin. Not yet done from the
design: `reveal_at` pacing of bot events (a client currently snaps to the
latest view), the private per-seat delta channel (policies exist; nothing
is sent on it yet) and presence.

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

Deadlines live on `live_state`: `claim_deadline` and `turn_deadline`,
with `wake_at`, the earliest of them, saved in the same write. `wake_at` is
the next moment the server has to act on the table unasked, and it's what
the sweep below reads.

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
  least recently saved first (a finished hand nobody has dealt on from, a
  game whose end is saved but whose finish didn't all land, which the visit
  finishes, or a table last saved by older code). Due tables come first,
  so parked ones can never crowd out a table whose clock has run out. On
  the Hobby plan crons run at most daily, which is why the tick above does
  the real work; Pro makes the sweep per-minute.

**Claim windows are adaptive, and rarely open.** Three things keep the
countdown from frightening anyone:

1. A window only opens when someone at the table *can* claim the discard;
   the engine advances immediately otherwise. Most discards never pause.
2. When everyone who could claim has responded, the window closes early.
   Fast tables never wait out the clock.
3. The window's length is the **longest** of the seated players' levels:

   | Player level | Claim window | Turn limit |
   |---|---|---|
   | `new` (first three hands) | 20 s, with the coach pointing at the claim | 90 s |
   | `learning` | 12 s | 75 s |
   | `solid` | 7 s | 60 s |

   So a table with one first-timer waits for the first-timer, and a table
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

When a clock runs out on someone who has gone, the response to whichever
request resolved it carries what the stand-in did, and their own table
says so in a line at the top ("You ran out of time, so a stand-in
discarded 5 bamboo for you") rather than leaving them to work out why the
hand looks different.

**Next hand.** Any seated human may deal the next hand, not only the host:
the finished phase runs no clock, so a host who has wandered off would
otherwise wedge the table for everyone. A second tap cannot skip a hand;
it is rejected as stale (409) and the table shows a notice. After the last
hand there is no next hand to deal: the game has already ended.

**Playing again.** When the last hand is scored the game ends there and
then, and every result sheet becomes the final table. The host's button
says "Play again" (if they were still at the table at the end) and
everyone else's "Back to the room": both lead to the lobby, where Start
(now "Play again, same seats") deals a fresh game for the same seats with
the scores back at nought. A finished game's page keeps showing its own
final table, seats and scores, whatever the room does next. Anyone still
on the old table follows the room channel's `started` message to the new
one.

**Leaving.** Any seat can stand up from a live table (Leave, top right,
with a confirmation). A bot takes the seat for the rest of the game so the
others carry on. When the last human leaves, the game ends as
`abandoned`, saved with the table like any other end (a hand cut short
doesn't count), and the room goes back to `finished`; anyone still on the
page sees "The table has closed". In the lobby, leaving simply empties the
seat.

Turn limits nudge at 20 seconds remaining. After two expired turns the seat
is handed to a bot stand-in and the human reclaims it on return. No
auto-discard by default, which feels punitive at a friends' table. A room
can opt into "strict" (7 s claims for everyone, 30 s turns, auto-discard
the drawn tile) for the competitive.

### Reconnect and presence

Reconnect = subscribe to both channels, then `GET /api/games/:id/view`,
which returns the private view with its `version`. Broadcasts carry
`version`; a gap means refetch. The whole thing is one read plus a
subscription, so a killed Safari tab is back in under a second.

Presence on the public channel drives the "away" indicator and the bot
stand-in. Spectators get the public channel only and see hands revealed at
the end of each hand, like standing behind the table.

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
  dealt, and, once the game has ended, how it ended (`over`: how, by whom,
  when, how many hands, the final scores and who sat where). A table last
  saved before it existed reads its scores from `rooms.ledger` until its
  next move saves them; nothing writes `rooms.ledger` any more.
- `hands`, one row per hand, made by the request that deals it, with its
  result and settlement once it ends (`hand_results` is no longer written).
  `actions` is the move log: every move in the hand, in order, each
  `{ v, by, seat?, userId?, a }`. `v` is the `live_state` version its
  request produced; `by` says who made it (`player`, `bot`, `clock`, `away`,
  `table` or `host`); `a` is the engine move, or a table note.
- `game_players`, one row per seat, written at the deal: who sat where, with
  the person's id on a human's row and the name on every row. When the game
  ends they're written again from `over`, with each seat's final score and
  place (ties share a place; nobody is placed in an abandoned game). (If a
  seated person has no profile row, that game's rows are written without
  ids.)
- `games.ended_how` (`complete`, or `abandoned`, for now), `ended_by`,
  `ended_at` and `hands_played` say how the game ended, for the funnel.
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
