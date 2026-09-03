# Taiwanese 16-Tile Mahjong — Dubai House Rules Spec

Source: Mahjong Dubai rulebook, https://play.mahjongdubai.com/help.html,
"House" tab, PDF capture dated 3 Sep 2026. The page also has **Standard** and
**Advanced** tabs which were not captured. ⚠ marks gaps.

## Shape

- 16-tile hand. Winning hand = **5 sets + 1 pair (17 tiles)**.
- Points-based. A **5-point base** is added to every win, special hands
  included.
- Scoring order convention: exposed sets first, then connections to
  concealed sets, then everything else. The engine computes all of it; the
  order matters only for teaching.
- Flowers: red = Seasons 1–4, blue = Blossoms 1–4. Replacement tiles come
  from the "flower wall" (dead wall).
- ⚠ Not in this capture: dealing procedure, wall and flower-wall size, claim
  rules (chow from left, pung/kong from anyone, priority), seat and round
  rotation, whether dealer retains on a win (the "dice on the wall" section
  implies yes). Likely on the Standard tab.

## Scoring table (House)

### Base and win type

| Item | Pts |
|---|---|
| Base, always added | 5 |
| No flower tiles | 1 |
| No wind/dragon tiles | 1 |
| No flower, wind and dragon tiles | 5 |
| Self-pick from the wall | 5 |
| Self-pick from the flower wall | 10 |
| Concealed hand, win from a discard | 10 |
| Concealed hand, self-pick | 15 |
| Fully exposed hand (only eyes concealed), win from a discard | 15 |
| Fully exposed hand, self-pick | n/a |
| Seabed: winning tile is the last tile from the wall | 20 |
| Win by 7 tiles: 7 or fewer tiles in the sea when winning | 50 |
| Earthly hand: non-dealer wins on dealer's first discard | 90 |
| Heavenly hand: dealer dealt a complete hand | 100 |
| Dealer wins or gives the winning tile | ×1 (⚠ meaning: the dealer bonus, see dice on the wall) |

### Flowers

| Item | Pts |
|---|---|
| Each flower | 1 |
| Flower of player's seat | 1 |
| Mixed bouquet (mixed red and blue 1–4): all players pay immediately | 5 |
| Pure bouquet (full set of red or blue 1–4): all players pay immediately | 10 |
| 7 flowers: instant self-draw win, paid immediately. Must replace from the flower wall to 17 tiles before declaring | 20 |
| Forgetting to replace before declaring = false mahjong: pay 25 to each player, forfeit the round | |

### Winds and dragons

| Item | Pts |
|---|---|
| Pong of winds | 1 |
| Pong of seat wind | 1 (⚠ additional to the above, assumed) |
| Pong of round wind | 1 (⚠ additional) |
| Little 3 winds (2 pongs + pair of winds) | 15 |
| Big 3 winds (3 pongs of winds) | 30 |
| Little 4 winds (3 pongs + pair) | 50 |
| Big 4 winds (4 pongs) | 60 |
| Pong of dragons | 2 |
| Little dragons (2 pongs + pair) | 20 |
| Big dragons (3 pongs) | 40 |

### Gongs (kongs)

- One open gong counts as one concealed pong.
- Concealed gongs must be shown at the end of each game; penalty for not
  showing is 10 pts to each other player.

| Item | Pts |
|---|---|
| Each open gong | 1 |
| Each concealed gong: collect 5 from each other player immediately | 5 |
| Win by robbing a gong | 10 |
| Win by self-drawing after a gong, all self-drawn | 30 |

### Runs and set families

| Item | Pts |
|---|---|
| Mixed dragon run 123·456·789 across three suits, exposed or partly concealed | 8 |
| Mixed dragon run, fully concealed | 10 |
| Pure dragon run, same suit, exposed or partly concealed | 15 |
| Pure dragon run, fully concealed | 20 |
| 2 sequential pongs, same suit (111, 222) | 5 |
| 3 sequential pongs | 15 |
| 4 sequential pongs | 30 |
| 5 sequential pongs | 60 |
| 5 sequential pongs + pair, full hand | 80 |
| 2 brother sheungs (123, 123 same suit) | 5 |
| 3 brother sheungs | 15 |
| 4 brother sheungs | 30 |
| 2 sister sheungs (123, 123 different suits) | 5 |
| 3 sister sheungs | 10 |
| 3 sister sheungs, all concealed | 15 |
| 2 sister pongs (111, 111 different suits) | 5 |
| 3 sister pongs | 15 |
| 2 concealed pongs | 5 |
| 3 concealed pongs | 15 |
| 4 concealed pongs | 30 |
| 5 concealed pongs | 80 |
| 5 concealed pongs, no open gongs, all self-drawn | 100 |
| Step-up: 3 sheungs each stepping up one number, same or mixed suits. One claim per hand | 5 |
| Four in 2 ways (same 4 tiles usable 2 ways) | 5 |
| Four in 3 ways | 10 |
| Four in 4 ways | 20 |

### Terminals

| Item | Pts |
|---|---|
| No terminal tiles (no 1s, 9s, honours) | 5 |
| 1 terminal pong set (111 + 999 same suit) | 5 |
| 2 terminal pong sets | 15 |
| 1 terminal sheung set (123 + 789 same suit) | 5 |
| 2 terminal sheung sets, mixed suits | 10 |
| 2 terminal sheung sets, pure same suit | 15 |
| Terminals-only hand with honours (eyes 1, 9 or honour) | 20 |
| Terminals-only hand, no honours (eyes 1 or 9) | 40 |

### Suit hands

| Item | Pts |
|---|---|
| 2-suit hand, no winds/dragons | 5 |
| All-5 hand: winds + dragons + all three suits | 10 |
| All sheung hand: 5 sheungs + pair (may include flowers/honours) | 15 |
| All pong hand: 5 pongs + pair | 25 |
| Semi-pure: one suit + winds/dragons | 30 |
| Pure suit: one suit, no honours | 100 |
| Pure honour: 5 pongs of winds/dragons + pair | 140 |

### Eyes and waits

| Item | Pts |
|---|---|
| Good eyes: pair of 2s, 5s or 8s | 2 |
| Calling by pairs: waiting on pair completion | 2 |
| True single wait: only one possible winning tile | 2 |
| False single wait: waiting on one tile but multiple choices | 2 |

### Special hands

| Hand | Definition | Pts |
|---|---|---|
| 13 Orphans | Fully concealed: 1 and 9 of all three suits, one of each wind and dragon, any pong or sheung, plus one extra honour for the pair. All self-drawn except the winning tile | 80 |
| 16 Orphans | Fully concealed: three non-consecutive "sheungs" one per suit (each tile at least 2 apart, e.g. 1·4·9, 2·5·8, 1·3·5), one of each wind and dragon, plus one extra orphan for the pair. Winning tile any orphan | 60 |
| Nico Nico | Fully concealed 7 pairs + 1 pong (17 tiles). All drawn except the winning tile. Scored as a normal hand then +40. Good eyes only if the winning tile itself is 2, 5 or 8 | +40 |
| Nico Nico + 1 gong (a pair as concealed gong) | | +10 |
| Nico Nico + 2 gongs | | +25 |
| Jade hand | Green dragons + bamboo only; sheungs and pongs allowed, exposed or concealed | 20 |
| Ruby hand | Red dragons + characters only | 20 |
| Diamond hand | White dragons + circles only | 20 |
| Chicken hand | Hand adds up to only 1 pt before base; winner gets 20 + 5 base | 20 |

## Table rules

- **Multiple winners**: 1–3 players may declare on the same discard. Score
  in order starting from the player to the right of the discarder. Discards
  only, not self-draw.
- **False mahjong**: 25 pts to each player. Round void. Dealer keeps East.
- **Draw (no mahjong)**: each player puts 5 pts on the table, a 20-pt pool
  for the next self-draw winner. Dealer moves to the next seat.
- **Incorrect tile count**: must keep playing, cannot declare mahjong or
  collect flower or gong points.
- **Chasing tiles**: if all four of a tile are laid down in the same round,
  the player who placed the first pays each other player 5 (honour) or 10
  (suit). West wind cannot be chased.
- **Dice on the wall (consecutive dealer wins)**: after a dealer win, a die on
  the flower wall shows the streak. Bonus added to subsequent winning scores
  is 3, 5, 7, 9, 11, 13 for streak 1–6. If the dealer gives the winning tile
  away they pay the same bonus. Forgetting to place the die forfeits the
  bonus but not the liability.

## Settlement ⚠

Not stated in this capture. Taiwanese norm: only the winner is paid. On a
discard win the discarder pays; on a self-draw all three pay. Confirm from
the Standard tab.

## Engine notes

- Scoring is **additive points**, not multiplicative doubles. Clean to model
  as a list of scoring rules, each returning points, summed plus base.
- Many items are **mutually stacking** (seat wind pong counts twice) and some
  are **exclusive** (concealed vs exposed win types). The rule list needs an
  explicit exclusion graph. ⚠ Exclusions are not spelled out in the source;
  the Standard tab or the community handbook may have them.
- Immediate payments (bouquets, concealed gongs, chasing) happen mid-hand.
  The ledger needs mid-hand transactions, not just end-of-hand settlement.
  This also affects Karachi if flowers pay immediately there.
- "Four in N ways" is a wait-shape rule. The engine already needs wait
  analysis for the coach; this reuses it.
