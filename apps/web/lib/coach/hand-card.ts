import { analyseHand, type HandAnalysis, type HandInput, type HandSpec, type MatchCtx, type Pattern, type PatternCandidate, type Ruleset } from '@society/engine';
import { shapeOf, titleOf } from './shape';
import { stripGroups } from './strip';
import type { CoachHandRef, CoachState } from './types';
import { capitalise, tilesWord } from './words';

/**
 * What a hand's card shows, wherever the tutor names the hand: the player's own
 * nearest lay-out, how it would stand after a claim, the winner's actual tiles,
 * or a checked example from the ruleset. A name alone teaches nobody; a hand
 * laid out in its sets does, so every title the tutor says carries one of these.
 */

/** A ref with no tiles to show, for a ruleset that has no example: the card shows the title and shape alone. */
function bare(pattern: { readonly id: string; readonly name: string; readonly localName?: string }, patterns: readonly Pattern[], whose: CoachHandRef['whose']): CoachHandRef {
  return { patternId: pattern.id, title: titleOf(pattern), shape: shapeOf(pattern.id, patterns), whose, layout: [] };
}

/** The player's own nearest lay-out of a candidate, as it stands (`yours`) or as it would after a claim (`ifClaimed`). No lay-out falls back to the example. */
export function yoursRef(c: PatternCandidate, patterns: readonly Pattern[], ruleset: Ruleset, ctx: MatchCtx, whose: 'yours' | 'ifClaimed' = 'yours'): CoachHandRef {
  if (c.layout) {
    return { patternId: c.patternId, title: titleOf(c), shape: shapeOf(c.patternId, patterns), whose, away: c.away, approximate: c.approximate, layout: c.layout };
  }
  const pattern = patterns.find((p) => p.id === c.patternId);
  const example = pattern ? exampleRef(pattern, ruleset, ctx) : null;
  return example ?? { ...bare({ id: c.patternId, name: c.name, ...(c.localName ? { localName: c.localName } : {}) }, patterns, whose), away: c.away, approximate: c.approximate };
}

const EXAMPLES = new Map<string, CoachHandRef | null>();

/**
 * The ruleset's example of a pattern, laid out by the analyser against that pattern
 * alone. An alias shows the example of the hand it's announced under, as
 * `Ruleset.aliases` asks. Memoised per ruleset, pattern and winds: the goulash's
 * honour gate reads the winds. Null when the ruleset has no example for it.
 */
export function exampleRef(pattern: Pattern, ruleset: Ruleset, ctx: MatchCtx): CoachHandRef | null {
  const key = `${ruleset.id}|${pattern.id}|${ctx.seatWind}|${ctx.roundWind}`;
  const known = EXAMPLES.get(key);
  if (known !== undefined) return known;
  const alias = ruleset.aliases?.[pattern.id];
  const tiles = (alias !== undefined ? ruleset.examples?.[alias] : undefined) ?? ruleset.examples?.[pattern.id];
  let ref: CoachHandRef | null = null;
  if (tiles) {
    const layout = analyseHand({ concealed: tiles, melds: [] }, [pattern], ctx, ruleset.guards, { claims: ruleset.claims }).candidates[0]?.layout ?? [];
    ref = { ...bare(pattern, [pattern], 'example'), layout };
  }
  EXAMPLES.set(key, ref);
  return ref;
}

/**
 * A winner's hand as they laid it down. `hand` is their revealed tiles (which
 * already hold a claimed winning tile) plus their melds, and `ctx` is the
 * winner's own, since the goulash's honour gate reads their seat wind. Falls
 * back to the example, keeping `owner`, when the search can't lay it out.
 */
export function winnerRef(hand: HandInput, pattern: Pattern, ctx: MatchCtx, ruleset: Ruleset, owner: string): CoachHandRef {
  const c = analyseHand(hand, [pattern], ctx, ruleset.guards, { claims: ruleset.claims }).candidates[0];
  if (c?.layout && c.away === 0) return { ...bare(pattern, [pattern], 'winner'), owner, away: 0, layout: c.layout };
  return { ...(exampleRef(pattern, ruleset, ctx) ?? bare(pattern, [pattern], 'example')), owner };
}

/**
 * "Hands this round": one per distinct title, the round's general hands first,
 * then the named ones, each in spec order. The player's own lay-out when a hand
 * of that title is among their nearest; otherwise the example of the first
 * pattern with that title that isn't an alias, so the tiles shown are a hand
 * that's announced under that title.
 */
export function handsThisRound(spec: HandSpec, analysis: HandAnalysis, ruleset: Ruleset, ctx: MatchCtx): CoachHandRef[] {
  const aliases = ruleset.aliases ?? {};
  const general = (p: Pattern) => p.tags?.includes('general') ?? false;
  const byTitle = new Map<string, Pattern[]>();
  for (const p of [...spec.patterns.filter(general), ...spec.patterns.filter((p) => !general(p))]) {
    const title = titleOf(p);
    byTitle.set(title, [...(byTitle.get(title) ?? []), p]);
  }
  return [...byTitle].map(([title, sameTitle]) => {
    const mine = analysis.candidates.find((c) => c.layout && titleOf(c) === title);
    if (mine) return yoursRef(mine, spec.patterns, ruleset, ctx);
    const shown = sameTitle.find((p) => !Object.prototype.hasOwnProperty.call(aliases, p.id)) ?? sameTitle[0]!;
    return exampleRef(shown, ruleset, ctx) ?? bare(shown, spec.patterns, 'example');
  });
}

/**
 * What an open card shows now. A `yours` card follows the player's hand as it
 * changes: the `yours` ref with the same pattern the tutor now holds (plan,
 * runner-up, "Hands this round", or a name in the bubble), else one with the
 * same title, else the card as it was opened. A winner's hand, a hand after a
 * claim and an example don't change.
 */
export function resolveHandRef(coach: CoachState, ref: CoachHandRef): CoachHandRef {
  if (ref.whose !== 'yours') return ref;
  const now = [coach.target?.hand, coach.runnerUp?.hand, ...coach.goal.hands, ...coach.say.map((s) => s.hand)].filter((r): r is CoachHandRef => r?.whose === 'yours');
  return now.find((r) => r.patternId === ref.patternId) ?? now.find((r) => r.title === ref.title) ?? ref;
}

/** Tile size on the card: smaller when a set is longer than seven tiles (a 1 to 9 run), so it still fits one row. */
export function cardTileSize(ref: CoachHandRef): 'xs' | 'sm' {
  return stripGroups(ref.layout).some((g) => g.tiles.length > 7) ? 'xs' : 'sm';
}

/**
 * The card's line under the tiles: whose hand it is, and what's still to find.
 * `name` is a winner's display name, drawn isolated before `text`. Null when
 * there are no tiles to talk about.
 */
export function cardCaption(card: CoachHandRef): { readonly name?: string; readonly text: string } | null {
  if (card.layout.length === 0) return null;
  const away = card.away ?? 0;
  const count = `${card.approximate ? 'about ' : ''}${tilesWord(away)}`;
  switch (card.whose) {
    case 'yours':
      return { text: away <= 0 ? "Every tile's yours. That's the hand, complete." : `The bright tiles are yours; the faded ones you still need. ${capitalise(count)} to go.` };
    case 'ifClaimed':
      return { text: away <= 0 ? "Take it and every tile's yours: that's the hand, complete." : `If you take it, the bright tiles are yours: ${count} to go.` };
    case 'winner':
      return card.owner === undefined || card.owner === 'You' ? { text: 'Your winning hand.' } : { name: card.owner, text: "'s winning hand." };
    case 'example':
      return { text: 'One way it can look.' };
  }
}
