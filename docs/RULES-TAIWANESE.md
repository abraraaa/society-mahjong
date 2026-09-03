# Taiwanese 16-Tile Mahjong — Spec from the Mahjong Dubai Rulebook

Source: https://play.mahjongdubai.com/help.html, all three tabs (Standard,
House, Advanced), PDF captures dated 3 Sep 2026. The site notes "rules are
tweaked occasionally".

This is one game with **three scoring sheets**. Mechanics are shared;
scoring differs. The engine models Taiwanese as one ruleset with a
`scoring: 'standard' | 'house' | 'advanced'` option.

## Shared mechanics ✅

- 144 tiles: three suits 1–9 ×4, four winds ×4, three dragons ×4, eight
  flowers (red = Seasons 1–4, blue = Blossoms 1–4).
- **Hand: 16 tiles; win = 5 sets + 1 pair (17 tiles).** Dealer starts with
  17 and discards.
- **Seating**: pull one of each wind into a stack; last to join rolls three
  dice, total picks the East seat; East rolls again to pick who draws first;
  players draw winds anti-clockwise and sit accordingly.
- **Dealing**: East rolls to pick the wall to break. Breaking creates the
  start point and the **flower wall** (dead wall). East takes 4, then S, W,
  N, repeating until all have 16; East takes a 17th. Flowers are exposed
  immediately and replaced from the flower wall in order E, S, W, N.
  Player calls "cheng" when replacements are done.
- **Claims**: Pong from any player's discard. **Sheung (chow) only from the
  player to your left.** Priority: **Mahjong > Gong > Pong > Sheung.**
- **Speed rule**: a discard can be claimed until the next player has drawn
  and either crossed the tile over their ruler or put it in hand.
- **Passing rule** (過水 in Standard; "Flow of luck" in Advanced): if you pass
  on a tile you could have claimed, you may not claim that same tile again
  in the same round (a round = every player has discarded once). Missing
  your winning tile means waiting until next round.
- **Multiple winners**: 1–3 players may win on the same discard. All are
  paid by the discarder, scored in order from the discarder's right.
  Discards only.
- **Settlement**: self-pick is paid by all three players; a discard win is
  paid by the discarder only. A "seabed" win off the last discard is paid
  only by the discarder.
- **Dealer**: dealer wins or dealer discards the winning tile apply the
  dealer multiplier / bonus. Dealer retains the seat on a win (consecutive
  win bonuses exist). On a draw, East moves to the next seat.
- **False mahjong**: 25 pts to each player, round void, dealer keeps East.
  Declaring with the wrong tile count is a false mahjong.
- **Wrong tile count** (not a false mahjong): play on, cannot win or collect
  flower/gong points, must still pay.
- **Concealed gongs** must be revealed at end of hand; penalty 10 pts to
  each other player (voided if someone wins by robbing the 4th tile).
- **Closing / calling** (House and Advanced): on your turn after drawing,
  before discarding, turn all concealed tiles face down to declare you are
  waiting. Worth 5 pts. Once closed you cannot look at, change, or gong
  from those tiles; bouquet payments still collect; declaring on a wrong
  tile is a false mahjong.

## Sheet 1: Standard (tai) ✅

Classic Taiwanese as documented by authoritative sources. Patterns award
**tai (台)**; payment = base + (perTai × totalTai) with a dealer multiplier.
Typical win 1–8 tai. ⚠ base and perTai values are configured per game in
the Dubai app's "Pattern Editor" and not stated here; standard Taiwanese
practice is a fixed base (底) plus a per-tai unit (台).

| Pattern | Tai |
|---|---|
| Self-pick (自摸) | 1 |
| Concealed hand (門清) | 1 |
| Concealed self-pick (門清自摸) | 3 |
| All pong (碰碰胡) | 4 |
| All sheung (平胡) | 2 |
| Semi pure (混一色) | 4 |
| Pure suit (清一色) | 8 |
| All honours (字一色) | 16 |
| Dragon pong, seat wind pong, round wind pong | 1 each |
| Little dragons (小三元) | 4 |
| Big dragons (大三元) | 8 |
| Little four winds (小四喜) | 8 |
| Big four winds (大四喜) | 16 |
| 3 concealed pongs (三暗刻) | 2 |
| 4 concealed pongs (四暗刻) | 5 |
| 5 concealed pongs (五暗刻) | 8 |
| Heavenly hand (天胡) | 24 |
| Earthly hand (地胡) | 16 |
| Nico Nico (七對半) | 30 (special) |

Standard explicitly excludes: 13/16 Orphans, Jade/Ruby/Diamond, chasing
penalties, draw pot, immediate flower payments, chicken-hand top-up.
Consecutive dealer bonus is **2n+1** tai. Passing rule (過水) and dead-hand
rule (相公, wrong tile count) enforced.

## Sheets 2 and 3: House and Advanced (points) ✅

Both add a **5-point base** to every win and score additively. Where the two
sheets differ, both values are shown as House / Advanced. Single values
apply to both.

### Win type

| Item | House | Advanced |
|---|---|---|
| Base | 5 | 5 |
| Closing / calling declared | — | 5 |
| Self-pick from the wall | 5 | 5 |
| Self-pick from the flower wall | 10 | 10 |
| Concealed hand, win from discard (only flowers and exposed gongs showing) | 10 | 5 |
| Concealed hand, self-pick (no closing allowed) | 15 | 10 |
| Fully exposed, win from discard (one concealed tile completing the pair) | 15 | 5 |
| Fully exposed, self-pick | — | 10 |
| Seabed: winning tile is the last wall tile | 20 | 50 |
| Win by 7 tiles: ≤7 tiles in the sea | 50 | — |
| Earthly: win on dealer's first discard | 90 | 20 |
| Heavenly: dealer dealt a complete hand | 100 | 100 |
| Dealer wins or discards the winning tile | ×1 | ×1 |
| Chicken hand: only 1 pt before base → 20 + 5 | 20 | — |

⚠ "×1" for dealer is the sheet's notation; read as "dealer bonus applies once"
via the dice-on-the-wall schedule rather than a doubling. Confirm.

### Flowers

| Item | House | Advanced |
|---|---|---|
| Each flower | 1 | 1 |
| Flower of own seat | 1 | ×1 (⚠ extra 1) |
| Mixed bouquet (red and blue 1–4 mixed), paid immediately by all | 5 | 5 |
| Pure bouquet (all red or all blue 1–4), paid immediately by all; can stack with mixed | 10 | 10 |
| 7 flowers: instant win, must replace to 17 first, paid immediately | 20 | 20 |
| 8 flowers: instant win | — | 40 |
| No flowers | 1 | 5 |
| No winds/dragons | 1 | 5 |
| No flowers, winds or dragons | 5 | 10 |
| No flowers, winds or dragons in an all-sheung hand (includes the above) | — | 15 |

### Winds, dragons

| Item | House | Advanced |
|---|---|---|
| Pong of winds | 1 | 1 |
| Pong of seat wind (additional) | 1 | ×1 |
| Pong of round wind (additional) | 1 | ×1 |
| Little 3 winds (2 pongs + pair) | 15 | 15 |
| Big 3 winds | 30 | 30 |
| Little 4 winds (3 pongs + pair) | 50 | 60 |
| Big 4 winds | 60 | 80 |
| Pong of dragons | 2 | 2 |
| Little dragons | 20 | 20 |
| Big dragons | 40 | 40 |

### Gongs

- One open gong = one concealed pong for counting concealed pongs. If your
  only exposed set is a pong and you self-draw its 4th tile, it becomes a
  fully concealed gong.

| Item | House | Advanced |
|---|---|---|
| Each open gong | 1 | (listed, ⚠ value not printed) |
| Each concealed gong, collect 5 from each player immediately | 5 | (listed, ⚠ value not printed) |
| Win by robbing a gong (the gonger pays an extra 10) | 10 | 10 |
| Win by self-drawing after gong → flower-wall gong → draw → mahjong | 30 | 30 |
| Four in 2 ways (1 sheung + 1 pong) | 5 | 5 |
| Four in 3 ways (2 sheungs + pair) | 10 | 15 |
| Four in 4 ways (4 sheungs) | 20 | 20 |

### Sequences

| Item | House | Advanced |
|---|---|---|
| Mixed dragon run 123·456·789 across all three suits, exposed/partly concealed | 8 | 5 |
| Mixed dragon run, concealed | 10 | 10 |
| Pure dragon run, same suit, exposed/partly concealed | 15 | 15 |
| Pure dragon run, concealed | 20 | 20 |
| Step-up: 3 sheungs each one number up, any suits, once per hand | 5 | 5 |
| All step-up: 5 sheungs all stepping up, mixed suits | — | 20 |
| All step-up, same suit | — | 90 |
| 2 brother sheungs (same sheung twice, same suit) | 5 | 5 |
| 3 brother sheungs | 15 | 15 |
| 4 brother sheungs | 30 | 30 |
| 2 sister sheungs (same numbers, different suits) | 5 | 5 |
| 3 sister sheungs | 10 | 15 |
| 3 sister sheungs, all concealed | 15 | — |
| 4 sister sheungs | — | 30 |
| 5 sister sheungs | — | 50 |
| All sheung hand (5 sheungs + pair, flowers/honours allowed) | 15 | 5 |
| All sheung hand, no flowers, no honours (includes the no-flower bonus) | — | 15 |
| 1 terminal sheung set (123 + 789 same suit) | 5 | 5 |
| 2 terminal sheung sets, mixed suits (each set pure) | 10 | 20 |
| 2 terminal sheung sets, all same suit | 15 | 20 |

A discard completing a dragon run makes it "partially concealed"; a wall
draw keeps it concealed. Mixed and pure dragon runs can both be claimed.

### Pongs

| Item | House | Advanced |
|---|---|---|
| All pong hand (5 pongs + pair) | 25 | 25 |
| 2 concealed pongs | 5 | 5 |
| 3 concealed pongs | 15 | 15 |
| 4 concealed pongs | 30 | 30 |
| 5 concealed pongs | 80 | 80 |
| 5 concealed pongs, self-draw, no gong | 100 | 100 |
| 2 sister pongs (same number, different suits) | 5 | 5 |
| 3 sister pongs | 15 | 15 |
| 2 sequential pongs, same suit ("uncle"/"neighbours") | 5 | 5 |
| 3 sequential pongs | 15 | 15 |
| 4 sequential pongs | 30 | 30 |
| 5 sequential pongs | 60 | 60 |
| 5 sequential pongs + pair in sequence | 80 | 80 |
| 1 terminal pong set (111 + 999 same suit) | 5 | 5 |
| 2 terminal pong sets | 15 | (listed, ⚠ value not printed) |

### Terminals and suits

| Item | House | Advanced |
|---|---|---|
| No terminals (no 1s, 9s, honours) | 5 | 5 |
| Terminals-only with honours (no 4/5/6; eyes 1, 9 or honour) | 20 | 20 |
| Terminals-only, no honours (eyes 1 or 9) | 40 | 40 |
| 2-suit hand, no honours (flowers allowed) | 5 | 5 |
| 2-suit hand, no flowers, no honours (once; includes no-flower bonus) | — | 10 |
| All-5 hand (three suits + winds + dragons) | 10 | (listed, ⚠ value not printed) |
| Semi pure (one suit + honours) | 30 | 30 |
| Pure suit (one suit, no honours) | 100 | 90 |
| Pure honour (5 honour pongs + pair) | 140 | — |

### Eyes and waits

| Item | House | Advanced |
|---|---|---|
| Good eyes: pair of 2s, 5s or 8s | 2 | (listed, ⚠ value not printed) |
| Calling by pairs (two pairs, waiting on either) | 2 | (listed) |
| True single wait | 2 | (listed) |
| False single wait | 2 | — |

Putting the winning tile into your hand rather than laying it across your
sets forfeits wait bonuses.

### Special hands

| Hand | Definition | House | Advanced |
|---|---|---|---|
| Nico Nico | 7 pairs + 1 pong, fully concealed, no closing. Scored normally plus bonus. Good eyes only if the winning tile itself is 2/5/8 | +40 | +40 |
| Nico Nico + 1 gong (a pair-of-pairs not declared as gong) | | +10 | +10 |
| Nico Nico + 2 gongs | | +25 | +25 |
| 13 Orphans | Concealed: 1 and 9 of all suits, one of each honour, any pong or sheung, plus one honour for the pair. All self-drawn but the winning tile | 80 | 80 |
| 16 Orphans | Concealed, no closing: three non-consecutive "sheungs" (tiles ≥2 apart), one per suit; one of each honour; one extra orphan for the pair | 60 | 60 |
| Jade | Green dragon pong + bamboo only | 20 | 20 |
| Ruby | Red dragon pong + characters only | 20 | 20 |
| Diamond | White dragon pong + circles only | 20 | 20 |

### Table penalties and bonuses (House and Advanced)

- **Chasing tiles**: all four of a tile discarded in one round; the first
  discarder pays 5 (honour) or 10 (suit) to each player. Never chase all
  West winds.
- **Draw**: each player puts 5 under the wind marker; 20-pt pool to the next
  self-draw winner; carries over if unclaimed before the next roll.
- **Dice on the wall**: dealer streak bonus 3, 5, 7, 9, 11, 13 for streaks
  1–6, added to the dealer's wins and paid by the dealer if they discard the
  winning tile. Forgetting the die forfeits the bonus, not the liability.
- **Triple dice** (Advanced): dealer rolls three of a kind when breaking the
  wall, others pay immediately: 5 for 1–5s, 10 for 6-6-6. Game start only.

## Engine notes

- **Three scoring sheets, one mechanic set.** Model the scoring sheet as a
  data table of `(pattern, value, unit)` rows plus an exclusion list; the
  pattern detectors are shared. Standard's tai and House/Advanced points are
  different units and never mix.
- **Exclusions are only partly specified.** The sheets say "awarded only
  once" for a few combined items and nothing for the rest. Default: honour
  and win-type items stack as listed; suit hands are exclusive of each
  other; sheung families are exclusive of pong families. Confirm at a table.
- **Mid-hand payments**: bouquets, concealed gongs, chasing, triple dice.
  Ledger needs transactions during a hand.
- **Closing / calling** is a player state with rules that restrict later
  actions. It also exposes information (the player is waiting), which the
  coach should teach.
- **Passing rule** requires per-round memory of claimable tiles each player
  declined. The engine already tracks the claim window; add a per-player
  "passed on" set that clears each round.
- **Multiple winners** on one discard: collect all mahjong declarations in
  the claim window before resolving.
- **Wait analysis** (true/false single wait, calling by pairs, four-in-N-ways)
  reuses the coach's wait detection.
