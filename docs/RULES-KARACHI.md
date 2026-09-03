# Karachi Style Mahjong — Working Rules Spec

Primary source: https://mahjongmates.com/karachi-style-mahjong-rules/ (not
reachable from the build environment; reconstructed from excerpts).
Items marked ⚠ are unconfirmed and must be verified before implementation.

## Lineage

- Blend of Mumbai style and Western (British-lineage) style.
- Oral tradition, taught teacher to student in Karachi since at least the 1970s.

## Tiles

- Suits: bamboo, characters (wan), circles (dots), 1–9, four of each = 108.
- Honours: four winds (E S W N) ×4 = 16; three dragons (red, green, white) ×4 = 12.
- ⚠ Flowers and seasons (8 bonus tiles) — likely in play given Mumbai/Western
  lineage; confirm.
- ⚠ Jokers — assume none.

## Players and seating

- Four players, prevailing wind and seat winds. ⚠ Rotation and game length
  (one round of each wind? fixed number of hands?) to confirm.

## Hand 1: Goulash

- The first hand of a game is a goulash "warm-up".
- Only pungs (and ⚠ kongs) are allowed; no chows.
- To use honours, two of three "goulash conditions" must be met. ⚠ Conditions
  unknown. Mumbai goulash reference: all pungs/kongs and a pair in one suit;
  with honours, three doubles complete with a pair/pung in suit and a minimum
  count of 20.
- ⚠ Whether the goulash includes a tile exchange (charleston) as in Western
  goulash.

## Hands 2+: standard Karachi hand

A winning hand is 14 tiles:

- **Three sets** of the same kind: three chows, or three pungs (⚠ kongs
  counting as pungs), and
- **Five honours**, in one of two forms:
  - N, E, W, S (one of each wind) plus a pair of one of those winds, or
  - A pung of any honour plus a pair of any honour.

The three sets must be either:

- all in one suit ("clean"), or
- one set in each of the three suits.

⚠ Mixed hands (two pungs + one chow) are assumed illegal. ⚠ Whether dragons
count towards the NEWS form. ⚠ Whether other special hands (thirteen orphans,
seven pairs, all honours) exist.

## Claims

- **Chow: never from a discard.** Chows are formed only from self-drawn tiles.
  This is the defining Karachi rule.
- Pung: ⚠ claimable from any player's discard (assumed).
- Kong: ⚠ claimable from any discard; concealed kongs from hand; replacement
  tile from the dead wall (assumed).
- Mahjong: ⚠ claimable on any discard completing the hand (assumed).
- Priority: ⚠ mahjong > pung/kong (assumed; chow priority moot).

## Scoring

⚠ Entirely unconfirmed. Working assumption based on Western lineage:
- Base points for sets (exposed vs concealed, simples vs honours/terminals),
  pair points, flower/season points.
- Doubles for clean hand, all pungs, own wind, dragons, etc.
- All four players score their hands on a win, with settlement between every
  pair (Western), and East pays/receives double.
- A limit value.

## Draw

⚠ Wall exhaustion handling (dealer retains? no payment?) to confirm.
