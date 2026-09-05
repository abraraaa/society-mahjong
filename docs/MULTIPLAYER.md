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
| `stats` | denormalised: hands, wins, self-draws, favourite hand id |
| `is_guest` | mirrors `auth.users.is_anonymous` |

Default avatar is a monogram rendered as a tile in the player's chosen
colour, so a table of four fresh accounts still looks designed. Uploads go
through a route handler to Blob with size and type checks; we store the URL.

RLS: a profile is readable by any authenticated user (this is a private app
among friends), writable only by its owner.

## 3. Rooms and games

### Lifecycle

1. **Create.** Host picks ruleset and options (scoring sheet, timer policy,
   tutor allowed for guests, stakes unit for the ledger). Room gets a
   6-character code and a share link `/r/ABC123`.
2. **Join.** Link → auth (guest allowed) → seat. Host can reorder seats and
   assign bots. Presence shows who is in the lobby.
3. **Start.** Server creates `games` (seed generated server-side, never
   sent to clients while any hand is live) and the first `live_state` via
   `startHand`. Broadcasts `hand:started` with public info only.
4. **Play.** Actions as below until the game's rounds are done or the host
   dissolves it.
5. **End.** Final ledger written; replay JSON (seed + action logs) archived
   to Blob; the seed becomes readable for replay and audit.

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
        deadlines from the table's timer policy (longest level at the table)
        write live_state (version+1) if version unchanged, else 409
        append the action to the hand's log; close the hand row on a result
        broadcast {version} on game:{id}; every client refetches its own view
        respond with the actor's private view and version
```

Implemented in `apps/web/lib/live/`: `table.ts` is the pure part (settle,
deadlines, expiry, `step`), covered by tests that play whole hands through
it; `service.ts` wraps it in loads, saves and broadcasts; the route handlers
are thin. Not yet done from the design: `reveal_at` pacing of bot events (a
client currently snaps to the latest view), the private per-seat delta
channel (policies exist; nothing is sent on it yet) and presence.

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

Deadlines live on `live_state`: `claim_deadline` and `turn_deadline`.

- Any incoming request first resolves expired deadlines. A bot stands in
  for whoever did not answer: in a claim window it takes a win they were
  offered, claims a set only when that brings the hand closer, and passes
  on the rest; in a turn it plays the room's policy.
- Every client renders the countdown from the deadline timestamp, so a phone
  that went to sleep shows the right remaining time on wake, and when its
  countdown reaches zero it POSTs `/api/games/:id/tick`, which resolves the
  deadline without applying any action. Any seated player's tick will do, so
  a window closes as soon as one phone at the table notices.
- A Vercel Cron sweep (`/api/cron/sweep`, `CRON_SECRET`) is the backstop for
  tables everyone has left. On the Hobby plan crons run at most daily, which
  is why the tick above does the real work; Pro makes the sweep per-minute.

**Claim windows are adaptive, and rarely open.** Three things keep the
countdown from frightening anyone:

1. A window only opens when someone at the table *can* claim the discard;
   the engine advances immediately otherwise. Most discards never pause.
2. When everyone who could claim has responded, the window closes early.
   Fast tables never wait out the clock.
3. The window's length is the **longest** of the seated players' levels:

   | Player level (from `onboarding_stage`) | Claim window | Turn limit |
   |---|---|---|
   | `new` (first three hands) | 20 s, with the coach pointing at the claim | 90 s |
   | `learning` | 12 s | 75 s |
   | `solid` | 7 s | 60 s |

   So a table with one first-timer waits for the first-timer, and a table
   of regulars runs at 7 seconds, which is the norm in online Hong Kong and
   Taiwanese play and feels quick only until you've done it twice.

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

**Leaving.** Any seat can stand up from a live table (Leave, top right,
with a confirmation). A bot takes the seat for the rest of the game so the
others carry on; when the last human leaves, the game is marked
`abandoned` and the room `finished`, and anyone still on the page sees
"The table has closed". In the lobby, leaving simply empties the seat.

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
claim window already collects all declarations before resolving; the
resolver settles each winner against the discarder in order from the
discarder's right. Robbing a kong is a TODO in the engine and a broadcast
of the exposed tile with a short claim window once implemented.

## 4. Data model for M2

Replaces the per-event `game_events` table in the initial migration.

- `rooms` (code, host_id, ruleset_id, options, status, seats jsonb, ledger jsonb)
- `games` (room_id, seed text server-only, status, rounds, started_at, ended_at, replay_url)
- `live_state` (game_id pk, version, state jsonb, claim_deadline, turn_deadline, updated_at)
- `hands` (game_id, hand_index, dealer, actions text, result jsonb, settlement jsonb)
- `hand_results` (flattened for stats)
- `profiles` as above

RLS: seated users read `rooms`, `games`, `hands` (actions only after the
hand ends), `hand_results`; nobody reads `live_state` or `games.seed`
directly. Realtime authorisation policies mirror the seat assignments.

## 5. What this does not do

No public matchmaking, no ranked play, no real money, no video. Chat is
short text and reactions on the public channel, rate-limited per user.
Anti-cheat is the authoritative server plus the hidden seed; a friends' app
does not need more than that.
