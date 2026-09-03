# Karachi Mahjong — Rules Spec

The first ruleset the engine implements, and the design muse for the product.
13-tile play whose rules change by wind round, with chows only from the wall.

## Sources and their standing

1. **Legality and round structure**: Naila Baig-Ansari, *Karachi Style Mahjong Rules*, Mahjong Mates, Oct 2025 (captured as PDF).
2. **Names**: *Karachi ↔ Thompson & Maloney Hand Mapping*, Mahjong Mates, Mar 2026 (PDF).
3. **Hand constructions**: *Special Hands Guide v4.2*, Mahjong Mates, Jul 2026 (captured as PDF, 3 Sep 2026). Each hand is given as one 14-tile example; the definitions below generalise those examples and say so where the generalisation is a judgement.
4. **Scoring**: the Mahjong Mates Karachi score tracker, screenshots 3 Sep 2026.
5. **Thompson & Maloney**, *The Mah Jong Player's Companion* (1997): the Western originals of many hands; not captured, used only through 2 and 3.
6. Your table's practice, where the above leave gaps.

Guide notation: b = bamboo, d = dots, c = characters; E S W N winds; R G Wh dragons; "paired" marks the tile that is doubled.

## Lineage

A blend of Mumbai style and Western (British/Australian) play, taught orally
in Karachi since at least the 1970s (Mrs Mumtaz "Monty" Kadri). First
written down in October 2025. Several hands carry the names of the women
who play them.

## Tiles and seating

- Suits 1–9 ×4 in bamboo, dots and characters; four winds ×4; three dragons ×4.
- ⚠ Flowers and seasons: the score tracker accounts for the winner's own
  flower and own season, so they are in play at least at the tracker's
  tables. Assumed present.
- Four players; seat winds rotate from the dealer. ⚠ Rotation on a win and
  draw handling are not documented.

## Round structure

| Round | Hands | Scoring |
|---|---|---|
| East | Hand 1 is a **goulash**; then the **honour hand**: three chows or three pungs (one suit, or one per suit) plus five honours | Flat stake (goulash: calculator) |
| South | **No honours.** Any four sets and a pair with no winds or dragons, or a named South hand | Flat stake |
| West | Every hand a goulash, with a three-tile exchange right → across → left before play | Calculator |
| North | Big hands only: the named North hands | Flat stake |

Five honours means either NEWS with one wind paired, or an honour pung plus an honour pair. The guide's North examples also use NEWS plus a fifth honour of any kind; the engine accepts that form where the guide shows it.

**Chows never come from a discard**, in any round. Pungs and kongs may be claimed from any discard; the winning tile may be claimed.

**Goulash**: four pungs or kongs and a pair. Honour pungs are allowed only when two of these hold: a dragon pung, a pung of the round wind, a pung of your own wind. ⚠ Whether the East-round goulash also has the West-round tile exchange is not stated.

## Catalogue (engine ids in `packages/engine/src/rulesets/karachi/patterns.ts`)

Every example below is a golden fixture in `packages/engine/test/karachi-catalogue.test.ts`, together with a one-tile mutation that must fail.

### East

| Hand | Guide example | Definition in the engine |
|---|---|---|
| Chow + 5 Honors | 123b 123d 123c EEE RR | The general East chow form (article) |
| Apple Blossom | 123b 123d 123c WhWhWh GG | 123 in each suit, or three mixed chows (Sloper on T&M), white dragon pung, green dragon pair |
| Windy Wonders | 123b 123d 123c EEE SS | Chows one per suit, wind pung, wind pair |
| Windyfly | 111b 444d 777c E W N S(paired) | Pungs one per suit, NEWS with a wind paired (T&M Windvane) |
| Windy Chows | 456b 234d 678c E S N W(paired) | Chows one per suit, NEWS with a wind paired (T&M Windy Chow) |
| Hovering Angel | 456b 234d 123c NNN RR | Chows one per suit, wind pung, dragon pair (T&M Hovering Angels) |
| The Professors | 678d 456b 234c R G Wh SS | Chows one per suit, one of each dragon, wind pair. ⚠ Sloper reports the pair as own wind; not enforced |
| Pinky's Hand | 1234b 1234d 1234c WW | The same four-tile run in every suit, wind pair (T&M Big Robert: 4567 ×3 + EE) |
| Monty | 1234b 1234d 1234c RR | As Pinky's with a dragon pair |
| Khalida's Hand | 1d 2b 3d 4d 5b 6c 7c 8b 9c E S W N N | A 1–9 run with each tile from any suit, NEWS with a wind paired |
| Naila's Hand | 123b 345b 123d 345c NN | ⚠ Generalised as 1-2-3 and 3-4-5 in one suit, 1-2-3 in a second, 3-4-5 in the third, wind pair |
| Dragonfly | R G Wh 333b 555d 777c 44b | One of each dragon, a pung in each suit, a pair from any suit |

### South

| Hand | Guide example | Definition in the engine |
|---|---|---|
| Any Damn Hand | 123b 456b 123d 456d 77c | Any four sets and a pair, no honours (the article's "mixed chows allowed") |
| Dirty Pairs | 1b1b 3d3d 5c5c 7b7b 2d2d 4c4c 6b6b | Seven pairs of suit tiles. ⚠ The mapping says no terminals; the example has 1b. Terminals allowed |
| Dirty Gertie's Garter | 1234567b 1234567d | 1–7 in two suits |
| Knitting | 1b1d 2b2d 4b4d 5b5d 7b7d 8b8d 9b9d | Seven knitted pairs (same number, two suits), the same two suits throughout |
| Crochet | 1b1d1c 4b4d4c 7b7d7c 7b7d7c 4b4b | Four knitted sets and a pair (T&M Triple Knitting) |
| Crazy Chows | 2b3d4c 4b5d6c 5b6d7c 7b8d9c 3b 7d | Four mixed chows plus two suit tiles. ⚠ The example's tail 3b 7d is not a pair of any kind |

### North

| Hand | Guide example | Definition in the engine |
|---|---|---|
| Laila's Hand | 111d 999b R G Wh N E W S(paired) | Pung of 1s in one suit, pung of 9s in another, one of each dragon, NEWS with a wind paired |
| Easy Virgin | 123b 111b R G Wh E S N W(paired) | 1-2-3 and a pung of 1s in the same suit, one of each dragon, NEWS with a wind paired |
| 1-9 plus 5 Honors | 1–9b E S W N R | A 1–9 run in one suit, NEWS, any fifth honour (T&M Wriggly Snake) |
| 1-7 plus 7 Honors | 1–7b E S W N R G Wh | A 1–7 run in one suit and all seven honours |
| Numbers Pungs | 555b 555d 555c E S W N R | Pungs of one number in all three suits, NEWS, any fifth honour. The Western form (EEE SS + three pungs) is also accepted |
| Sind Club Hand | R G Wh E S W N 2b 5b 5d 1c 8c 7c 1c | A fixed hand; the pair is 1c |
| Monty Wriggly Snake v2 | 111c 999c 234c 678c 5c(paired) | Gates of Heaven: one suit, pung of 1s, pung of 9s, 2–8, one of 2–8 paired |
| Wriggly Snake v1 | 111b 999d 234c 678c 5c(paired) | Confused Gates: pung of 1s, pung of 9s, 2–8 in the third suit with one paired |
| Four Blessings | EEE SSS WWW NNN RR | Four wind pungs and any pair |
| All Honor Hand | 111b 999d EEE NNN RR | Pungs of terminals and honours, terminal-or-honour pair |
| Gertie's Garter | 1234567b 1234567d | 1–7 in two suits |
| Green Jade | GGG 111b 444b 777b 88b | Green dragon pung, three bamboo pungs, bamboo pair (the guide lists "Ruby Jade" as its Karachi alias) |
| Imperial Jade | GGG 222b 333b 444b 66b | Green tiles only |
| Royal Coral | RRR 333c 555c 888c 99c | Red dragon pung, three character pungs, character pair (T&M Red Coral) |
| Royal Ruby | RRR 111b 555b 777b 99b | Red dragon pung, red bamboo (1,5,7,9) pungs and pair |
| Ruby Jade | RRR GGG 111b 222b 66b | Red and green dragon pungs, two bamboo pungs, bamboo pair |
| Lilly of the Valley (Monty ver) | WhWhWh 222d 666d 999d 44d | T&M White Opal: white dragon pung, three dots pungs, dots pair |
| Lillypilly | GGG WhWh 444d 666d 999d | Green dragon pung, white dragon pair, three dots pungs |
| Run, Pung & Pair | 1–9d 888d 22d | One suit |
| Monty Unique Wonders | 1b 1d 9d 1c 9c E S W N R G Wh 9b(paired) | Thirteen orphans |

## Scoring (from the Karachi score tracker)

**East, South and North: a flat stake per round.** Every loser pays the winner. East pays and receives double, whichever side of the win it is on. Defaults, editable per table:

| Round | Regular seat | East seat |
|---|---|---|
| East | 2,000 | 4,000 |
| South | 1,000 | 2,000 |
| North | 4,000 | 8,000 |

Example from the tracker: East wins an East-round hand, each of the three others pays 4,000, the winner takes 12,000. Named hands do not change the amount; they decide whether the hand is legal at all.

⚠ The tracker asks for the winner's own-flower / own-season count (0, 1, 2: "own flower or own season", "both"). Its effect on the payout is not visible in the screenshots. Modelled as a multiplier table defaulting to ×1, ×2, ×4 until checked.

**False mahjong**: the offender pays 4,000 to each other player (shown the same in East and South).

**West round, and the opening goulash of East: the Cantonese-style calculation**, as the tracker's West form lays it out.

Base points:

| Item | Points |
|---|---|
| Mahjong | 20 |
| Pung, basic (2–8): revealed / concealed | 2 / 4 |
| Pung, terminal or honour: revealed / concealed | 4 / 8 |
| Kong, basic: revealed / concealed | 8 / 16 |
| Kong, terminal or honour: revealed / concealed | 16 / 32 |
| Pair of dragons, of own wind, of round wind, of terminals | 2 each |
| Each flower or season | 4 ⚠ (not shown in the tracker) |

Doublers, each doubling the base:

| Doubler | Doubles |
|---|---|
| All honour pungs | 3 |
| Three or more kongs | 2 |
| All three dragon pungs | 2 |
| All four wind pungs | 2 |
| One suit with honours | 1 |
| One suit, no honours | 1 |
| Self-drawn win | 1 |
| Three or more concealed sets | 1 |
| All pungs | 1 |
| Round wind pung or kong | 1 |
| Seat wind pung or kong | 1 |
| Each dragon pung or kong (when not all three) | 1 |
| Own flower or season | 1 each |

Final = base × 2^doublers; every loser pays the final amount (the tracker's West example: base 22, no doublers, each loser pays 22; no East doubling shown in West).

## Still open

- Own-flower multiplier on flat payouts, and flower points in the calculator.
- Whether the East-round goulash has the tile exchange.
- Kongs in East "pung" slots (accepted), exposure requirements for named hands (none enforced), and overlapping named hands (flat scoring makes this moot outside West).
- Draw handling, dealer rotation on a win, and whether flowers and seasons are in play at every table.
