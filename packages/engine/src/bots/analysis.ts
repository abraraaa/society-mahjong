import { analyseHand, handAfterClaim, handAfterKong } from '../analysis/index';
import type { HandAnalysis } from '../analysis/types';
import type { Action, PrivatePlayerView } from '../game/index';
import type { HandInput } from '../hand';
import type { Ruleset } from '../ruleset';
import { simpleBot } from './simple';

/**
 * A bot that plays the round it is in. Every decision comes from the same
 * analysis the coach uses: which hands are on the table (`ruleset.handSpec`),
 * how far each is (`analyseHand`), and whether taking a discard or declaring a
 * kong would leave the hand closer or further from its nearest one.
 *
 * `simpleBot` pungs anything it can and bins lone honours, which in East and
 * North wrecks the very hands the round asks for. This one claims only when the
 * re-analysed hand is nearer than it was, and otherwise lets the tile go.
 *
 * It still sees only its own seat: a PrivatePlayerView, never the wall or
 * anyone else's tiles.
 */
export interface BotOptions {
  /**
   * `sharp` plays the analysis straight. `gentle` is company for a first-timer:
   * it sometimes lets a useful tile go and sometimes misses a claim, the way a
   * relative who has had two cups of chai does. Never worse than legal.
   */
  readonly strength?: 'sharp' | 'gentle';
  /** source of randomness for `gentle`; defaults to Math.random */
  readonly random?: () => number;
}

/** How often a gentle bot fumbles: a loose discard, a claim not taken. */
const GENTLE_LOOSE_DISCARD = 0.35;
const GENTLE_MISSED_CLAIM = 0.3;

export function analysisBot(view: PrivatePlayerView, ruleset: Ruleset, options: BotOptions = {}): Action | null {
  const { legal, me: seat } = view;
  const gentle = options.strength === 'gentle';
  const random = options.random ?? Math.random;
  const spec = ruleset.handSpec(view.progress);
  const ctx = { seatWind: view.players[seat].seatWind, roundWind: view.progress.roundWind };
  const hand: HandInput = { concealed: view.concealed, melds: view.players[seat].melds };
  const analyse = (h: HandInput): HandAnalysis => analyseHand(h, spec.patterns, ctx, ruleset.guards, { claims: ruleset.claims });
  const awayOf = (a: HandAnalysis) => a.candidates[0]?.away ?? Number.POSITIVE_INFINITY;

  if (legal.exchange) {
    const a = analyse(hand);
    const count = legal.exchange.count;
    const loose = a.spare.length >= count ? a.spare.slice(0, count) : a.ratings.slice(0, count).map((r) => r.kind);
    return loose.length === count ? { type: 'exchange', seat, tiles: loose } : simpleBot(view);
  }

  if (legal.claims) {
    const win = legal.claims.find((c) => c.type === 'win');
    if (win) return { type: 'claim', seat, claim: win };
    const discard = view.lastDiscard;
    if (!discard) return { type: 'pass', seat };
    const before = awayOf(analyse(hand));
    let best: { claim: (typeof legal.claims)[number]; away: number } | null = null;
    for (const claim of legal.claims) {
      const after = handAfterClaim(hand, claim, discard.kind, discard.from);
      if (!after) continue;
      const away = awayOf(analyse(after));
      if (!best || away < best.away) best = { claim, away };
    }
    if (best && best.away < before && !(gentle && random() < GENTLE_MISSED_CLAIM)) return { type: 'claim', seat, claim: best.claim };
    return { type: 'pass', seat };
  }

  if (legal.win) return { type: 'declareWin', seat };

  const a = analyse(hand);
  if (legal.kong && legal.kong.length > 0) {
    // A kong is only worth its replacement draw when it costs the hand nothing.
    const before = awayOf(a);
    const kong = legal.kong.find((k) => awayOf(analyse(handAfterKong(hand, k))) <= before);
    if (kong) return { type: 'declareKong', seat, tile: kong };
  }
  if (legal.discard && legal.discard.length > 0) {
    if (gentle && random() < GENTLE_LOOSE_DISCARD) {
      // One of the three least useful tiles rather than the least: still
      // sensible-looking, just not the best, which is what gives a beginner room.
      const loose = a.ratings.slice(0, 3);
      const pick = loose[Math.floor(random() * loose.length)];
      if (pick) return { type: 'discard', seat, tile: pick.kind };
    }
    const tile = a.bestDiscard ?? a.ratings[0]?.kind;
    return tile ? { type: 'discard', seat, tile } : simpleBot(view);
  }
  return null;
}
