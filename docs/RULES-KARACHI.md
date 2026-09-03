# Karachi Style Mahjong — Working Rules Spec

Primary source: "Karachi Style Mahjong Rules" by Naila Baig-Ansari, Mahjong
Mates, 21 Oct 2025 (https://mahjongmates.com/karachi-style-mahjong-rules/),
read from the PDF capture dated 3 Sep 2026. Teacher credited: Mrs Mumtaz
"Monty" Kadri, playing in Karachi for over fifty years.

Legend: ✅ confirmed by the article · ⚠ unconfirmed, needs the mapping PDF,
Thompson–Maloney, or your table.

## Lineage and character

- ✅ Oral tradition, "house rules on steroids". Evolved from a blend of Mumbai
  and Western/British-style play. Nothing written down until this article.
- ✅ Many hands overlap with Thompson & Maloney, *The Mahjong Player's
  Companion* (T&M), under different names. T&M is the reference for hand
  definitions the article does not spell out.
- ✅ **The rules shift by wind round.** Each of the four rounds has its own
  hand structure. This is the defining architectural fact for the engine.

## Tiles

- ✅ Three suits 1–9 ×4 (108), four winds ×4 (16), three dragons ×4 (12).
- ⚠ Flowers and seasons. Western play uses them; the article never mentions
  them. Assume present but confirm.
- ⚠ Jokers: assume none.

## Claims

- ✅ **Chow: never from a discard**, not even from the player on your left.
  Chows are built only from self-drawn tiles. "My least favourite house
  rule", and the one that makes the game deliberate and defensive.
- ⚠ Pung: claimable from any player's discard (standard, assumed).
- ⚠ Kong: claimable from any discard; concealed kongs allowed; replacement
  tile from the end of the wall (assumed). Kongs are referenced in the
  goulash conditions, so kongs exist.
- ⚠ Mahjong on a discard: assumed allowed for any hand. Whether a "concealed
  except last" rule applies to big hands (as in Western Wriggly Snake) is
  unknown.
- ⚠ Claim priority: mahjong > pung/kong. Chow priority is moot.

## The four rounds

### East round — the honour hand ✅

- **Hand 1 is a goulash** (warm-up). Only pungs allowed. To use honours, two
  of the three goulash conditions must be met (below).
  ⚠ Whether East's goulash includes the three-tile exchange used in West.
  ⚠ Goulash structure: four pungs/kongs + pair, presumably any suits.
- **Remaining East hands** are 14 tiles built as:
  - three chows + five honours, **or**
  - three pungs + five honours.
  - The three sets are either **all one suit** ("clean") **or one in each
    suit**.
  - **Five honours** = N, E, W, S with one wind paired, **or** a pung of
    honours + a pair of honours.
  - ⚠ Mixed chow/pung sets assumed illegal. ⚠ Whether kongs count as pungs
    here. ⚠ Whether dragons can be the pair in the NEWS form.

### South round — no honours ✅

- No honour tiles in the hand.
- Standard structure: **four pungs + a pair**.
- Some **Western special hands** allowed: **Knitting, Crochet, Crazy Chows**
  (T&M names). Crazy Chows = four mixed chows and a mixed pair (per Western
  references). ⚠ Exact T&M definitions of Knitting and Crochet needed.
- **Mixed chows** allowed (sequences across suits, which Chinese styles do
  not recognise).
- ⚠ Whether plain four-chows-plus-pair is allowed, or only via Crazy Chows.

### West round — all goulash ✅

- Every hand is a Karachi goulash hand (pungs only, honour restriction).
- Before play, **everyone exchanges three tiles**, in order:
  **Right → Front (opposite) → Left**.
- ⚠ Blind or face-down exchange; whether you may pass tiles you received.

### North round — big hands only ✅

- Only "big" hands: long 1–9 sequences and other larger, rarer hands. The
  full list is in the hand catalogue below.

## Hand catalogue ✅ (mapping) / ⚠ (definitions)

Source: "Thompson & Maloney → Karachi Style Hand Mapping" PDF (Mahjong Mates,
March 2026): 27 T&M hands with Karachi names, grouped by round. Page numbers
refer to *The Mahjong Player's Companion*. Definitions come from Western
and Australian references that describe the same named hands; T&M's own
wording may differ, so every definition is ⚠ until checked against the
book pages listed. "?" means no definition found yet.

### East (7 hands)

| T&M hand | Page | Karachi name | Definition |
|---|---|---|---|
| Apple Blossom | 19 | Apple Blossom | ? |
| Big Robert | 14 | Pinkys | Three four-tile chows, one in each suit, plus a pair of winds or dragons |
| Dragonfly | 31 | Dragonfly | One of each dragon, a pung/kong in each of the three suits, plus a pair from any suit |
| Hovering Angels | 17 | Chow + 5 Honors | One chow in each suit, pung of own wind, pair of white dragons; concealed except last |
| The Professors | 19 | The Professors | ? |
| Windy Chow | 18 | Windy Chows | One chow in each suit, E S W N, plus one extra wind (making a pair) |
| Windyvane | 28 | Windyfly | ? |

Note how Karachi's stated East structure ("three chows or three pungs, clean
or one per suit, plus five honours") is the generalisation of Windy Chows
and Hovering Angels. The named hands are specific instances; the engine
should model East as the general pattern with the named hands as scored
sub-patterns.

### South (4 hands)

| T&M hand | Page | Karachi name | Definition |
|---|---|---|---|
| Crazy Chows | 16 | Crazy Chow | Four mixed chows (each tile from a different suit, in the same suit order) plus a mixed pair |
| Knitting | 20 | Knitting | Seven pairs in any two suits, no honours (Western); some sources define knitted pairs (same number, one tile from each of two suits). ⚠ which |
| Seven Twins | 22 | Dirty Pairs (no terminals or honours) | Seven pairs, simples only (2–8), suits mixed |
| Triple Knitting | 20 | Crochet | Four sets of three tiles of the same number, one from each suit, plus a pair; no honours |

Plus the standard South hand: four pungs and a pair, no honours, mixed chows
allowed. ⚠ Whether four plain chows + pair (not Crazy) is legal in South.

### North (16 hands)

| T&M hand | Page | Karachi name | Definition |
|---|---|---|---|
| All Honor Hand | 44 | All Honor Hand | Four pungs/kongs and a pair, all winds and dragons |
| Confused Gates | 9 | Wriggly Snake v1 | Pung of 1s in one suit, run 2–8 in a second suit, pung of 9s in the third; concealed |
| Four Blessings | 30 | Four Blessing | Four pungs of winds plus any pair |
| Gates of Heaven | 9 | Wriggly Snake v2 | One suit: pung of 1s, pung of 9s, run 2–8, with one of 2–8 paired |
| Gerties Garter | 14 | Gerties Garter | Run 1–7 in one suit and run 1–7 in another; no honours |
| Green Jade | 35 | Green Jade | Pungs/kongs and/or chows of green bamboos (2,3,4,6,8) with a pair of green dragons |
| Imperial Jade | 36 | Imperial Jade | Pungs/kongs of green dragons and green bamboos, at most one chow, pair of green bamboos |
| Lilly Pilly | 36 | Lilly Pilly | ? |
| Numbers in Parallel | 43 | Number Pungs | Pungs of the same number in all three suits, plus a pung of winds and a pair of dragons (or the reverse) |
| Royal Coral | 35 | Royal Coral | Pungs/kongs (chows allowed) of 2,3,4,6,8 characters and red dragons; pair from the same tiles |
| Royal Ruby | 37 | Royal Ruby | Pungs/kongs of red dragons and red bamboos (1,5,7,9); pair of red bamboos |
| Ruby Jade | 37 | Ruby Jade | Pungs/kongs of red dragons, green dragons, red bamboos and green bamboos; pair of any bamboos |
| Run, Pung, Pair | 9 | Run, Pung, Pair | One suit: run 1–9, a pung, and a pair; no honours |
| Unique Wonder | 44 | Monty Unique Wonders (13 Orphans) | One each of the 1s and 9s of every suit, one of each wind, one of each dragon, any of them paired |
| White Opal | 35 | Lilly of the Valley (Monty ver) | ? (Monty's version contains a pair of dragons) |
| Wriggly Snake | 27 | 1-9 plus 5 Honors | Run 1–9 in one suit plus E S W N with one wind paired; concealed (Western). Karachi name suggests any "five honours" form qualifies |

### Book pages to capture

To finish the catalogue and get T&M's exact wording and values, capture
these pages of *The Mahjong Player's Companion*: 9, 14, 16, 17, 18, 19, 20,
22, 27, 28, 30, 31, 35, 36, 37, 43, 44. Also the book's scoring pages, which
the Karachi values are presumably based on.

## Goulash conditions ✅

To use honour pungs (pungs or kongs of winds or dragons) in a goulash hand,
you must meet **any two** of:

1. A pung/kong of any dragon
2. A pung/kong of the wind of the round
3. A pung/kong of your own (seat) wind

Example from the article: East seat in a South round with pungs of red
dragons and south winds satisfies two conditions and may use honour pungs
freely.

⚠ Whether a single honour pung is allowed if it is itself one of the two
conditions (e.g. a dragon pung alone meets condition 1 only, so no). Reading:
you need two qualifying pungs before any *other* honour pung is legal.

## Rounds, seating, game length

- ✅ A full game is one cycle: East, South, West, North.
- ⚠ How many hands per round (until each player has been East once is the
  Western norm), whether East retains the deal on a win, and wash-out rules.

## Scoring ⚠

Not covered by the article at all. Working assumption, from the T&M lineage:
**fixed values per hand** (standard win, half-limit, full limit) rather than
stacked doubles. Needs: the value table, whether non-winners score, dealer
doubling, flower/season bonuses, kong bonuses, and how a goulash win scores.

## Source hierarchy

1. **Karachi legality**: the Mahjong Mates article (Naila Baig-Ansari, Oct 2025).
2. **Karachi ↔ T&M hand mapping**: the Mahjong Mates mapping PDF (Mar 2026), in hand.
3. **Concrete hand constructions**: the Mahjong Mates Special Hands Guide
   (announced Jun 2026, "Five Styles, One App"), which has a Karachi
   category with Karachi-only names. **Not yet captured.** Second-hand
   transcriptions of it circulated via an LLM were rejected: 7 of 21
   constructions had 13, 15 or 20 tiles, and several contradicted the
   mapping PDF (Gertie's Garter placed in South, hands absent from the
   27-hand mapping). Only a first-hand capture of the guide, or the hand
   checker's source, goes into the catalogue.
4. **T&M definitions and scoring**: *The Mah Jong Player's Companion*,
   Thompson & Maloney, Kangaroo Press 1997, ISBN 978-0-86417-891-6, 120+
   hands; 2025 reissue available. Copyrighted; capture the pages listed
   above rather than a scan.
5. **Your table's practice**: only where the above leave ambiguity.

Karachi-only names reported for the guide, to look for when it is
captured (unverified): Windy Wonders, Khalida's Hand, Monty, Naila's Hand
(East); Any Damn Hand (South); Laila's Hand, Easy Virgin, 1–7 plus 7
Honors, Sind Club Hand (North).

## Sources still needed

1. First-hand capture of the Mahjong Mates Special Hands Guide, Karachi
   category (print to PDF, as with the article).
2. T&M book pages listed above for exact definitions and values.
3. Your table's scoring sheet, or whatever Monty's students use to settle up.
4. The mahjongmates.com hand checker source, which may encode all of this.
