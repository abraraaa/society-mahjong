# Data model

How Society Mahjong stores things, and the rules that keep the schema from
needing an edit every other feature. Read this before adding a column.

## The short version

- **Three kinds of storage, chosen on purpose.**
  1. **Relational rows** for things the database itself must know about: who
     people are, which rooms, games and hands exist, who sat where, and anything
     we filter, join, index, count in the funnel, or protect with RLS.
  2. **Versioned JSON documents** for everything the app keeps about a table,
     a room or a player that only the app reads: who's away, the ready check,
     running scores, room options, presence stamps on seats, a player's tally.
     The app owns their shape and parses them tolerantly, so a new field is a
     code change, never a migration.
  3. **Realtime only** for things nobody needs tomorrow: pokes, reactions,
     presence dots.
- **One request against a live table is one transaction** (`commit_table`):
  the new state, the table's bookkeeping and every move it made, together, or
  nothing.
- **Migrations are additive, checked on a real Postgres in CI, and applied by
  CI on merge**, before the app deploys. Nobody pastes SQL into the dashboard.

## What changes with 0005

0005 is written once, for the roadmap as it stands: absent players, the
next-hand ready check, how games end, sitting back down, "your tables", game
history, a room's running scores across games, and product numbers. After it,
none of those needs SQL.

| Where | What | Why a column or table |
|---|---|---|
| `live_state.table_state` | JSON: the table's own bookkeeping (see below) | Saved in the same versioned write as the hand, so the two never disagree |
| `live_state.wake_at` | when the server next has to act on this table unasked | The sweep's only question. A new kind of timer is a new value here, not a new column |
| `live_state.acted_at` | the last time a person moved the table | Ops and idle queries |
| `games.ended_how`, `games.ended_by` | `complete`, `host`, `idle` or `abandoned`; who ended it | The funnel splits on them |
| `game_players` | one row per seat per game: who, bot or person, final score and place | History, "who won the night", a room's scores across games, a player's record. Four rows a game |
| `room_members` | everyone who has sat at a room, first and last seen, games played | "Your tables" on the home page, "not here yet", handing the host's powers on |
| `app_events` | one row per thing worth counting, with a free-form `data` | Product numbers without a column per metric |
| `commit_table(...)` | the atomic write for a live table | Ends log gaps and out-of-order moves |

It also takes back two sets of grants Supabase gives every table by default:
the browser's roles no longer hold any privilege on `live_state` (every seat's
tiles), and no write privilege on any table. RLS already stopped both; this is
the second lock.

Nothing is dropped or renamed. These stay, unused by new code, until a
scheduled clean-up migration a release later:
- `rooms.ledger`: running scores move into `table_state`;
- `append_hand_action`: replaced by `commit_table`;
- `hand_results`: duplicates `hands.result`.

## The tables

- **`profiles`**: one per auth user, guests included, made by a trigger at sign-up.
  - `stats` is the player's tally (JSON, server-written).
  - `preferences` is theirs (JSON).
  - A guest who later adds an email keeps the same user id (Supabase links the
    identity), so nothing moves.
- **`rooms`**:
  - The code, the host, the ruleset and `options`: a JSON document for host
    settings such as strict clocks, stakes, the tutor for guests and bot strength.
  - `seats`: a JSON array of four, which is who's in which chair right now.
  - Seats are JSON on purpose. A seat change is one atomic write, guarded by
    `updated_at`. The Realtime policy reads the seats. Presence stamps and a
    bot keeping a seat for someone are optional keys on each entry.
- **`room_members`**: the group behind a room, as rows, because "which rooms is
  this person in" has to be a query. `last_seen_at` moves on an invite-link
  open, a room made, a Start, the lobby's refresh, and a game's end for those
  still there; between games, "who's here" and who holds the host's powers are
  read from it (seen in the last six hours, and since the last game ended).
- **`games`**: one per game in a room.
  - The `seed` is never readable by a client: it reveals the wall.
  - Also its status and how it ended.
- **`game_players`**: who sat where in that game, and how they finished.
  - Written at the deal.
  - A seat's row follows whoever holds it.
  - Score and place are filled in at the end.
- **`hands`**: one per hand.
  - Its dealer and progress.
  - `actions`, the move log: a compact JSON array appended by `commit_table`.
  - The result and settlement once it ends.
  - Seed plus log equals the hand.
- **`live_state`**: one per active game, overwritten on every move under
  optimistic versioning.
  - `state`: the engine's HandState.
  - `table_state`: the app's bookkeeping.
  - The clocks, `wake_at` and `acted_at`.
  - Server-only.
- **`app_events`**: append-only numbers. No foreign keys, so the counts outlive
  what they count.

**Why not a row per move?** Measured hands run to about 100 moves. A row each,
with its indexes, is about 22 KB a hand against about 1.5 KB for the JSON
array. On the free tier's 500 MB that's the difference between roughly 1,400
games and 20,000. The array keeps the size down, and `commit_table` fixes what
was actually wrong with it: gaps and ordering.

## The JSON documents

Each has one parser in `apps/web/lib/live/`. A parser gives defaults for
anything missing and ignores what it doesn't know, so an old row always reads
and a new field needs no migration. Each document carries `"v"` for the day a
change isn't additive.

| Document | Shape (all keys optional unless noted) | Parser |
|---|---|---|
| `live_state.state` | the engine's `HandState` | engine |
| `live_state.table_state` | `{ v, absence: [4 × { userId, since, misses, away: 'clock' \| 'host' \| 'self' \| null, clockMoves, lastClockMove, lastTap, tapVersion, played: { turns, sets, exchanges, wins, hands } }], ready: { hand, userIds, dealAt }, took: [4 × { userId, hand, seq }], scores: [4], over: { how, by, at, hands, scores, seats } }`. `ready` is there only while someone has tapped for the next hand; `took` only while someone has taken a seat over from a bot in the hand being played (what the tutor's first look reads, as the snapshot's `joinedAt`); `tapVersion` is the table version that saved `lastTap`. | `table-state.ts`, `absence.ts` |
| `rooms.seats` | 4 × `null` \| `{ kind: 'human', userId, name, since?, seen? }` \| `{ kind: 'bot', name, heldFor?, keptName?, kept?: 'left' \| 'late' }` (a bot keeping a seat for someone who left, or wasn't here at the deal) | `types.ts` |
| `rooms.options` | `{ strict?, stakes?, tutorForGuests?, botStrength? }` | `validate.ts` |
| `profiles.stats` | `{ hands, wins }` | `stage.ts` |
| `hands.actions[]` | `{ v, by: 'player' \| 'bot' \| 'clock' \| 'away' \| 'table' \| 'host', seat?, userId?, a: Action \| TableNote }`. Table notes include a seat going away (`{ type: 'away', reason: 'clock' \| 'host' \| 'self' }`, a break logged `by: 'player'` with their userId), coming back, a take-over, and the game's end | `hand-log.ts` |
| `app_events.data` | per `type`: `room_made` `{ ruleset, guest }`; `seat_taken` `{ how, status }`; `game_dealt` `{ humans, bots, again, levels: { new, first_hand, learning, solid } \| null }` (null when the levels couldn't be read); `game_finished` `{ how, hands, humans }`; `game_abandoned` `{ hands }` | `events.ts` |

`table-state.ts` keeps any key it doesn't read as it found it, so a newer
phone's field survives an older phone's write.

App vocabularies (`by`, `ended_how`, event types) have **no CHECK
constraints**, so a new word is a code change. Only structure is constrained
(a seat is 0 to 3).

## Access

- The browser reads almost nothing directly. Every read and write goes through
  a route handler, as the service role. The exceptions: the Realtime policy,
  which reads seats to authorise a channel, and a person's own profile row.
- Every table in `public` has RLS on. Tables the browser has no business with
  have no policies and no grants. `supabase/tests/checks.sql` enforces both, on
  every PR.
- The seed, every seat's tiles (`live_state`) and a live hand's log never reach
  a client. A finished hand's log is readable by the room's own players.

## Rules for changing the schema

1. **Prefer JSON first.** If only the app reads it, it goes in a document.
   Promote a field to a column only when the database must filter, join, index,
   constrain or protect it.
2. **Additive only.** Add columns and tables. Never rename, and never drop in
   the same release as the code that stops using something: drop it in a later
   clean-up migration.
3. **Safe to run twice**: `if not exists`, `create or replace`, and
   `drop policy if exists` before `create policy`.
4. **One file per change**, numbered in order: `supabase/migrations/NNNN_name.sql`.
5. **Tested before merge.** CI's `db` job applies every migration to a real
   Postgres twice, then runs `supabase/tests/checks.sql`. Add a check for
   anything that matters: a grant, a policy, a function's behaviour.
6. **Applied on merge.** The *Migrate and deploy* workflow runs
   `supabase db push`, then deploys.

What would still need a migration, and why each is fine to wait for:
- Push subscriptions, when push is built.
- Persisted chat, if chat ever outlives the table.
- Conversational tutor transcripts, if they're kept.

## Setting up the pipeline (once, about five minutes)

**What it holds, and why.** One credential that matters: the connection to
this project's database as the `postgres` role. Migrations create and alter
tables, functions, grants and RLS policies that `postgres` owns, so a narrower
role would have to own them too, which comes to the same thing. It can't reach
other projects, the management API, API keys, auth admin, billing or project
settings. No Supabase access token is used. The Vercel deploy hook can only
start a production build of `main`. Both live in a GitHub environment limited
to `main`, so a workflow on any other branch can't read them, including one
pushed by an agent.

1. **Supabase**:
   - Open the project, then **Connect** (top bar), then **Session pooler**, and
     copy the URI. Not the direct connection: GitHub's runners have no IPv6,
     and the direct host is IPv6-only. Not the transaction pooler (port 6543),
     which Supabase doesn't recommend for migrations.
   - Put the database password in place of `[YOUR-PASSWORD]` (Project Settings,
     then Database; reset it if lost). Letters and digits only, or
     percent-encode anything else.
2. **Vercel**:
   - Project Settings, then Git, then Deploy Hooks: create a hook for branch
     `main`.
3. **GitHub**:
   - Settings, then Environments, then New environment: `production`.
   - Deployment branches and tags: **Selected branches**, add `main`.
   - Optional: **Required reviewers**, add yourself, to approve each run before
     it touches the database. Every merge then waits for that click.
   - Add two **environment** secrets (not repository secrets):
     `SUPABASE_DB_URL` and `VERCEL_DEPLOY_HOOK`.
4. **Adopt what was run by hand**:
   - Actions, then *Migrate and deploy*, then Run workflow from `main`, with
     the box "Adopt (first run only): record 0001-0004…" ticked.
   - This records 0001–0004 as applied and pushes anything newer.
   - It's safe to run more than once.
5. **Vercel's own production deploy is off** (`apps/web/vercel.json`:
   `"git": { "deploymentEnabled": { "main": false } }`), so production deploys
   only through the workflow, after migrations are in. If a migration fails,
   production stays on the last good deploy. Previews still deploy from every
   branch.

If the database password is ever reset, update `SUPABASE_DB_URL` to match.
Nothing else expires.

Previews use the production database, so a preview whose code needs a column
that's only in an unmerged migration won't work until it merges. Supabase's
database branching fixes that on the Pro plan; it isn't needed yet.

## Running the checks locally

```sh
PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/apply.sh
```

It creates a scratch database, applies a stand-in for Supabase's own schemas
(`supabase/tests/supabase-shim.sql`), then every migration twice, then the
checks.
