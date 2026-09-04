# Society Mahjong — Plan v0.1

A browser-led social mahjong game. Karachi rules ship first because that is the craze we are answering, and Karachi's tables are the design muse, but the product is multi-ruleset and is not called "Karachi style" anywhere a player sees it. Mobile and tablet first
(iOS 26+ Safari guaranteed), up to ~100 concurrent players (~25 tables),
beautiful, fast, persistent, with a tutor that sits beside first-timers.

Status: **v0.3, tracking a live build.** This document sets direction; it is
not the record of what exists. As of the last update:

| | |
|---|---|
| M0 Foundation | Done. Monorepo, tokens, CI, engine skeleton. |
| M1 Solo table | Engine-driven, playable on a phone. Layout, hand-analysis, coach and bots all rebuilt on the analysis layer after a review round. Next: M1.5 polish (tablet sizing, hand-over-hand progression, sound), then M2. |
| Karachi rules fidelity | Catalogue and scoring built from primary sources; several points still ⚠ in `docs/RULES-KARACHI.md`, blocked on one session at a real table. |
| Taiwanese | Engine ruleset stubbed (patterns, House/Advanced/Standard scoring); no UI. |
| M2 Multiplayer | Designed in `docs/MULTIPLAYER.md` (authoritative over this doc's §3 on realtime and schema). First slice built: rooms with codes and links, guest seats, authoritative table in route handlers with optimistic versioning, bots inline, deadlines with client tick + cron backstop, Realtime pokes, live table UI on the shared `Table`. Needs migration 0002 applied and env set; untested against a live project until then. Next: presence and away/stand-in, ledger across hands, profile upgrade (magic link/Google), replay archive. |
| Tutor | Deterministic coach layer landing now, grounded in engine analysis. Conversational layer not started. |

Treat any other section below as intent, and defer to the code and to
`docs/RULES-KARACHI.md` / `docs/MULTIPLAYER.md` where they've moved ahead of it.

---

## 1. Product shape

**Who it's for.** Karachi socialites and their diaspora (London, Dubai, Toronto)
who play at home and at the club, plus the wave of first-timers who want to keep
up. Most of them have never touched a mahjong app. Many have never played.

**What it is.** A private-table game you open in Safari, sign in with a
magic link, and play with three friends (or bots) in a room you share by link.
The host picks the table's rules; Karachi is the first ruleset built. A tutor sits in
your first rounds and explains what to do and why.

**What it is not (v1).** Not a public matchmaking lobby, not a ranked ladder,
not a real-money product, not American (NMJL card) mahjong, not video chat.

### Comparison to mahjong4friends

Mahjong 4 Friends proves the functional baseline: create room → invite link →
fill seats with friends or bots → play, with in-game hint bubbles and a linked
tutorial. It supports HK, Chinese, British, American and Panama variants. It is
ugly, dense, desktop-born and squeezed onto phones. We take the flow and drop
everything else.

| Baseline (M4F) | Ours |
|---|---|
| Room code + link | Same, plus Apple/Google/magic-link accounts and guest seats |
| Bots fill seats | Same, plus difficulty and a "tutor" personality |
| Yellow hint bubbles | Contextual coach layer driven by the engine, plus a conversational tutor |
| Many rulesets | Karachi first, ruleset interface so others plug in |
| Desktop-first UI | Portrait phone and landscape tablet, designed from the tile up |
| Session persists while tab open | Event-sourced games; close Safari, come back tomorrow |

---

## 2. Karachi rules — what we know and what we don't

Source of truth is the Mahjong Mates article (PDF capture in hand). Full
working spec in `docs/RULES-KARACHI.md`. The headline that reshapes the build:
**the rules change by wind round.**

| Round | Hand structure |
|---|---|
| East | Hand 1 is a goulash (pungs only, honours gated by the goulash conditions). Then three chows or three pungs, clean or one per suit, plus "five honours" |
| South | No honours. Four pungs + pair, plus Western special hands (Knitting, Crochet, Crazy Chows) and mixed chows |
| West | Every hand a goulash, with a three-tile exchange Right → Front → Left before play |
| North | Big hands only: long 1–9 runs and rare hands mapped to Thompson–Maloney (Big Robert = Pinkys, Gates of Heaven = Wriggly Snake v2, Unique Wonder = Monty Unique Wonders …) |

Across all rounds: **you can never chow from a discard.** Chows come only
from self-drawn tiles.

Still missing, and blocking the engine:

1. The **Karachi–T&M Hand Mapping PDF** (free download on mahjongmates.com)
   which lists every hand by round. North is undefined without it.
2. **Thompson–Maloney definitions** for each named hand.
3. **Scoring.** The article has none. T&M uses fixed values per hand
   (standard / half-limit / full limit); assume Karachi does the same until
   told otherwise.
4. Mechanics the article skips: flowers/seasons, kong handling, hands per
   round, dealer retention, wash-outs, blind vs open exchange in West.

## 3. Architecture

Guiding constraints: Vercel, serverless, one database vendor, small team, ~25
concurrent tables, turn-based (no twitch latency), sessions that survive
Safari being killed.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router, React 19) on Vercel, Fluid Compute | RSC for lobby/profile pages, route handlers for game actions, one deploy target |
| Data + auth + realtime | **Supabase** (Postgres, Auth, Realtime Broadcast/Presence) | One vendor covers all three. Neon would need Ably/Pusher and Auth.js bolted on |
| Rules engine | Pure TypeScript package `packages/engine`, zero deps | Runs on server (authoritative) and in the browser (instant legality hints, optimistic UI) |
| Styling | Tailwind v4 + CSS custom properties for tokens | Same approach as the workout app |
| Motion | Motion (framer-motion) | Tile dealing, claims, wins deserve real choreography |
| State (client) | Zustand store fed by realtime events + engine reducer | Small, testable, no Redux ceremony |
| Tutor LLM | Claude via Vercel AI SDK, grounded in engine analysis | Only for "why" and debriefs; never decides legality |
| Testing | Vitest for engine (property tests on hand validation), Playwright for table flows | Engine correctness is the product |

### Realtime and authority on serverless

Vercel functions cannot hold websockets or timers, so the design is:

1. **Server is authoritative.** Every action (draw, discard, claim, pass,
   declare) is a POST to a route handler. It loads the live state, runs the
   engine reducer, appends the action to the hand's compact log, updates the
   live state, and returns the acting player's private view.
2. **Fan-out is the route handler POSTing to Supabase Realtime Broadcast**,
   not a database trigger — superseded by `docs/MULTIPLAYER.md`, which is
   authoritative on this. Public and private deltas go to separate channels
   (`game:{id}` and `game:{id}:seat:{n}`); the public one never carries
   another player's concealed tiles.
3. **Private state** (your hand, your drawn tile) comes back in the HTTP
   response or via an RLS-scoped query on reconnect. Nothing secret crosses
   the broadcast channel.
4. **Timers without a server clock.** Claim windows and turn limits are
   deadlines stored on the snapshot. Any request after a deadline resolves it
   first (lazy advancement). A one-minute Vercel Cron sweeps stalled tables so
   an abandoned claim window never wedges a game.
5. **Bots run inline.** When a human's action leaves the turn with a bot, the
   same request plays bot turns until a human is up again, emitting events
   with staggered `reveal_at` timestamps so the client animates them at human
   pace rather than all at once.
6. **Reconnect** = fetch snapshot + events since your last sequence number,
   replay through the engine reducer. Presence shows who is at the table.

**Upgrade path if it bites.** If claim-window latency or bot pacing ever feels
wrong at scale, the table becomes a Cloudflare Durable Object (PartyKit) with
real websockets and alarms, and the engine package moves unchanged. Not for v1.

### Regions

The first players are spread across London, Karachi, Dubai and Sri Lanka.
Mumbai (`ap-south-1`) is the centre of that map: roughly 40ms from Karachi
and Dubai, 60ms from Colombo, 120ms from London. London would punish three
of the four groups. Decision: Supabase in Mumbai, Vercel functions pinned to
`bom1`. Turn-based play tolerates 120ms comfortably.

### Data model

Constraint: Supabase Free (500 MB database, 5 GB egress, 2M Realtime messages
and 200 concurrent connections per month, project pauses after 7 idle days).
Measured from bot-played hands: ~100 player actions and 110–160 engine events
per hand. One row per event costs 35–50 KB per hand and would fill the tier
in about two months of nightly play. So the engine's determinism does the
work instead: **a hand is fully described by its seed plus the ordered list
of validated player actions** (draws derive from the seed), which is ~450
bytes raw and ~230 bytes gzipped. To be precise about the pattern: this is
a **deterministic game log with materialised state**, not event sourcing.
Player actions are the canonical input; the reducer derives state and the
events the UI animates. Invariant: `seed + actions = the game`. `live_state`
is a cache of that and is never patched by hand; if it ever disagrees with
the log it is thrown away and rebuilt by replay.

- `profiles` — user, display name, avatar URL (Blob), preferences, onboarding stage
- `rooms` — code, host, ruleset id + options, seat assignments, status, ledger
- `games` — one per full game within a room; seed (server-only until the game ends)
- `hands` — one row per hand: hand index, dealer, compact action log
  (appended in place while live), result and settlement JSON. ~1.5 KB each,
  ~25 KB per 16-hand game, so ~20,000 games in 500 MB
- `live_state` — one row per active game, overwritten on every action:
  materialised engine snapshot (~3 KB) + claim deadline. Rejoin is one read
- `hand_results` — flattened scoring rows for stats and ledgers
- `tutor_sessions` — pointers to transcripts stored in Blob

RLS everywhere. Service role only inside route handlers. The seed is never
readable by clients while a hand is live, since it reveals the wall.

**Vercel Blob** is the archive tier: avatars, finished-game replays exported
as JSON once a game ends (then trimmed from Postgres if we ever need to),
tutor transcripts. Never live state: Blob is eventually consistent and not
transactional, which is wrong for turn actions.

**Realtime is the quota that bites first.** Each action fans out to three
other clients: ~400 messages per hand, so 100 games a week is ~2.7M
messages a month against a 2M cap. Fine at launch volumes; at full load the
fan-out moves to a dedicated realtime provider or the game gets Supabase
Pro, which also removes the 7-day pause. That pause is the real launch
risk for a social app: a quiet week freezes the database until someone
restores it by hand.

### Ruleset interface

```ts
interface Ruleset {
  id: 'karachi' | 'hongkong' | 'british' | ...
  tiles(): TileSetConfig            // suits, honours, flowers, seasons, jokers
  shape: { handSize: 13 | 16, sets: 4 | 5 }   // Taiwanese is 16 tiles, five sets + pair
  dealing(): DealConfig             // wall, dead wall, dealer extra tile, dealer retention
  handSchedule(game): HandSpec      // Karachi: per round + hand index (goulash, honour, no-honour, big)
  preplay(game): PreplayStep[]      // Karachi West: three-tile exchange R → F → L
  patterns: HandPattern[]           // declarative hand definitions (T&M-style), filtered by HandSpec
  claims: {
    canChow(ctx): boolean           // Karachi: never from discard
    canPung(ctx): boolean
    canKong(ctx): boolean
    priority: ClaimPriority
  }
  isWinning(hand, ctx): WinResult   // matches hand against allowed patterns for this round
  score(win, ctx): Settlement       // who pays whom, doubles, limits
}

// Not on the ruleset: analysis (distance to a hand, safe discards, what you
// are building) is a separate layer that consumes the engine's legal moves
// and pattern data. The engine says what is legal; the analysis layer says
// what is good; the tutor says why. Bots and the coach both sit on the
// analysis layer, and bots only ever see a PrivatePlayerView, never HandState.
```

Hand definitions are **data, not code**: a pattern language (sets, runs,
pairs, suit constraints, honour constraints, round gating) that the validator
interprets. That is what makes Western special hands, Karachi round rules and
HK standard hands live in one engine, and what lets the coach explain "you
are two tiles from Pinkys".

**What varies between rulesets is more than the hand list.** Taiwanese play
is 16-tile (five sets + pair), deals differently, makes flowers mandatory,
scores in flat tai, and lets East keep the deal on a win. American adds
jokers and a Charleston. So the engine parameterises hand size, set count,
dealing, bonus tiles, claim rules, round schedule, hand patterns, and
settlement, and never assumes 13 tiles or four sets anywhere. Cheap to do
from day one, expensive to retrofit.

Ruleset roadmap:

1. **Karachi** ("Karachi official"): the reason the product exists, and the
   only one with a written source we control.
2. **Taiwanese 16-tile**: what Dubai's clubs and platforms default to, and
   the group is Dubai-heavy. Additive points scoring, quick to teach. The
   Dubai house scoring table is captured in `docs/RULES-TAIWANESE.md`.
3. **Hong Kong**: the most widely known Chinese-style ruleset globally;
   cheap once Taiwanese exists.
4. **Western/British** (Thompson–Maloney): arrives almost free with Karachi's
   South and North rounds; needs its own scoring table.
5. **American** (NMJL card, jokers, Charleston): out of scope. A different
   product with an annual licensing problem.

Which one a given group actually plays is settled at the table, not by
inference. The room picker makes switching a one-tap choice, so being wrong
about the default costs nothing. British/Western third as it shares
Karachi's ancestry. American is out of scope.

---

## 4. Experience

### Design direction

The workout app taught us: one strong material metaphor, restrained palette,
motion that explains state changes, and never a spinner where a transition will
do. Here the material is the tile.

- **Palette**: warm ivory tiles with deep engraved glyphs; a felt in dark jade
  or Arabian Sea blue; brass accents for gold-state moments (a win, a kong).
  Dark mode is the default at the table; light mode for lobby and learning.
- **Type**: a humanist sans for UI, a display serif with a nod to Nastaliq
  rhythm for headings. Tile numerals rendered as SVG, not fonts.
- **Layout**: portrait phone = your hand as a bottom rail, discards as a
  compact river in the centre, opponents as three slim edges. Landscape tablet
  = the full square table. One codebase, two compositions, not one stretched.
- **Motion**: deal animates from the wall; a claimed tile slides from the
  river to the claimant's melds; a win fans the hand and holds. Motion tokens
  (durations, easings) shared with sound and haptic cues.
- **Sound + haptics**: tile clack, wall shuffle, a soft chime on claim window.
  iOS Safari haptics via the `input[type=switch]` trick; respect reduced motion.
- **PWA**: installable, standalone, home-screen icon, web push for "your turn"
  and "table is ready" (iOS 26 supports both).

### Onboarding and the tutor

Three layers, cheapest first:

1. **Learn by doing, no lecture.** First launch offers "Play your first hand"
   against three bots with the tutor on. No rules screen up front.
2. **Coach (deterministic, engine-driven).** Always-on, toggleable per player.
   Highlights legal moves, explains the claim window ("You can pung this
   3-bamboo. In Karachi you can never chow a discard, so don't wait for one"),
   shows what hand you're closest to ("Three pungs, one suit, 4 tiles away"),
   flags dangerous discards late in the wall. All from `ruleset.analyse()`,
   so it is never wrong about the rules.
3. **Tutor (conversational, Claude).** Tap the tutor, ask "why did she win with
   that?" or "what should I be aiming for?". The prompt gets the engine's
   structured analysis and the ruleset text, answers in plain English, and
   offers a 30-second debrief at the end of each hand. Personality: warm,
   direct, a bit of a Karachi auntie.

Progression: tutor intensity drops as the player wins hands unaided; the app
notices ("You've won three on your own, want me to just watch?").

### Social

- Rooms with a 6-character code and share sheet link; host controls ruleset,
  bots, timers, whether the tutor is allowed for guests.
- Quick reactions and short chat, no free-for-all video.
- Ledger per room: running score across sessions, optional "stakes" as a
  number the host sets (we never move money).
- Spectator seats so the auntie can watch and heckle.

---

## 5. Performance and persistence budgets

- First table render on a mid iPhone over 4G: < 2.0s. Engine + table client
  chunk under 150KB gzipped. Tiles as one SVG sprite.
- Action round-trip (POST to broadcast received by others): p95 < 400ms
  intra-region, < 600ms cross-region.
- A player can kill Safari mid-hand and rejoin within one tap; rejoin
  completes in < 1s from cache.
- A game abandoned for a week is still there, with a "resume" or "dissolve"
  choice for the host.

---

## 6. Milestones

| # | Milestone | Outcome |
|---|---|---|
| M0 | Foundation | Monorepo, tokens, Supabase project, Auth (Apple/Google/magic link/guest), CI. Engine package with tiles, wall, dealing, Karachi validator + scorer with test suite from the confirmed rules |
| M1 | Solo table | Full hand vs three bots in the browser, no network. Every animation and interaction designed here first |
| M2 | Multiplayer | Rooms, invites, authoritative server, realtime, reconnect, timers, cron sweeper, ledger |
| M3 | Tutor | Coach layer, conversational tutor, first-hand onboarding, progression |
| M4 | Polish + rulesets | Sound, haptics, PWA, push, stats; Hong Kong ruleset to prove the interface |

M0's engine work is blocked on §2. Everything else can start.

---

## 7. Open questions (need answers to proceed)

1. The Karachi–T&M Hand Mapping PDF, T&M hand definitions, and how your table scores. Flowers? Kongs? Hands per round?
2. ~~Where are the first 100 players?~~ London, Karachi, Dubai, Sri Lanka. Mumbai region chosen.
3. Scoring display: points only, or a stakes ledger with a host-set unit value?
4. Turn timers: social (30s, nudges) or strict (10s, auto-discard)?
5. Guests without accounts: allowed to play, or must sign in to sit?
6. Workout app: add its repo to this session so the tokens and patterns carry over, or describe the ones that matter?
