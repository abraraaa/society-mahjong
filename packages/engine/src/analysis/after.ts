import type { ClaimOption } from '../game/types';
import type { HandInput, Meld, Seat } from '../hand';
import type { TileKind } from '../tiles';

/**
 * The hand as it would stand after taking `kind` with `option`, for a
 * like-for-like re-analysis. Null for a win (there is no "after") or when the
 * hand does not actually hold the tiles the option says it would put down.
 *
 * Shared by the coach and the bots: "does this claim help" has one honest
 * answer, which is to analyse the hand the claim would leave behind.
 */
export function handAfterClaim(hand: HandInput, option: ClaimOption, kind: TileKind, from: Seat): HandInput | null {
  if (option.type === 'win') return null;
  const taken = option.tiles ?? [];
  const concealed = [...hand.concealed];
  for (const t of taken) {
    const i = concealed.indexOf(t);
    if (i < 0) return null;
    concealed.splice(i, 1);
  }
  const meld: Meld = { type: option.type, tiles: [...taken, kind], concealed: false, from };
  return { ...hand, concealed, melds: [...hand.melds, meld] };
}

/** The hand after declaring a kong of `kind`: four from hand, or a held pung promoted. */
export function handAfterKong(hand: HandInput, kind: TileKind): HandInput {
  const held = hand.concealed.filter((t) => t === kind).length;
  const concealed = hand.concealed.filter((t) => t !== kind);
  if (held === 4) {
    return { ...hand, concealed, melds: [...hand.melds, { type: 'kong', tiles: [kind, kind, kind, kind], concealed: true }] };
  }
  const melds = hand.melds.map((m) => (m.type === 'pung' && m.tiles[0] === kind ? { ...m, type: 'kong' as const, tiles: [kind, kind, kind, kind] } : m));
  return { ...hand, concealed, melds };
}
