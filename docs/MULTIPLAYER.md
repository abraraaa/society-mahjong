# Multiplayer, Authentication and Profiles (M2 design)

Constraints this design answers: Vercel serverless (no sockets, no timers),
Supabase Free (see PLAN.md §3), an authoritative deterministic engine whose
seed reveals the wall, iOS Safari as a PWA, and a social crowd that will not
tolerate sign-up friction.

## 1. Authentication

**Supabase Auth**, cookie sessions via `@supabase/ssr`, refreshed in Next.js
middleware. Decision: **passkeys, not Sign in with Apple.** Same Face ID
moment on iPhone, no Apple Developer account.

A passkey is a credential, not an identity, so the first sign-in still needs
something to bind it to. The flow:

1. First visit: email → magic link (or Google, if we enable it). One time.
2. On that first successful sign-in, offer a passkey: "Use Face ID next
   time?" Enrolment is one tap on iOS 26.
3. Every return: passkey. No email, no link, no password ever.

Supabase Auth shipped passkeys as a beta in May 2026 (WebAuthn; relying
party id is the bare domain `societymahjong.app`, origins include the
production and preview hosts). Beta means the API may shift before M2; we
verify against the docs when we build it, and magic link remains the
fallback either way. Anonymous guests stay as below.

| Provider | Role | Prerequisite |
|---|---|---|
| Magic link (email) | Bootstraps an identity | none |
| Passkey | Every subsequent sign-in | Supabase passkeys enabled, RP id + origins configured |
| Google | Optional bootstrap for Android and desktop friends | Google Cloud OAuth client |
| Anonymous (guest) | Play from an invite without any of the above | enable in Supabase Auth |

Not in v1: Sign in with Apple (passkeys cover the same moment for free),
phone OTP (SMS cost, Twilio setup).

**Guest policy.** A room code or link is enough to sit down. Guests are
anonymous Supabase users bound to the device, shown as "Guest" plus a
colour unless they choose a display name, which needs no account. They can
stay fully anonymous for as long as they like; the ledger records them by
seat. Adding an email or passkey later links in place and keeps their
history. Hosting a room requires a full account. Guests who never upgrade
are pruned after 30 idle days.

**Authority.** Every game route handler resolves the caller's seat from the
session. Clients never write to game tables. The service role is used only
inside route handlers, after the session check.

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
        load live_state (version = expectedVersion, else 409 → client refetches)
        reduce(state, action, ruleset)       // IllegalAction → 400
        run bot turns inline until a human is up, stamping each bot event
          with reveal_at = now + 600ms × n so clients animate at human pace
        if a discard opened a claim window: claim_deadline = now + policy.claimSeconds
        write live_state (version+1), append compact actions to hands row
        broadcast public delta to  game:{id}         (all seats, spectators)
        broadcast private delta to game:{id}:seat:{n} (drawn tile, legal actions)
        respond with the actor's private view
```

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

- Any incoming request first resolves expired deadlines (missing claim
  responses become passes; an expired turn applies the room's policy).
- A Vercel Cron sweep every minute resolves deadlines on tables where nobody
  has sent anything, so an abandoned claim window never wedges a game.
- Clients render the countdown from the deadline timestamp, so a phone that
  went to sleep shows the right remaining time on wake.

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
