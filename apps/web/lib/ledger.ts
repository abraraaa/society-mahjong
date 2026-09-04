import { SEATS, type HandResult, type Seat } from '@society/engine';

/** Running totals per seat, in the ruleset's scoring unit. */
export type Scores = Readonly<Record<Seat, number>>;

export const NO_SCORES: Scores = { 0: 0, 1: 0, 2: 0, 3: 0 };

/** Apply a finished hand's settlement. A washed-out hand moves nothing. */
export function applyResult(scores: Scores, result: HandResult | null): Scores {
  if (!result || result.type !== 'win') return scores;
  const next: Record<Seat, number> = { ...scores };
  for (const t of result.settlement.transfers) {
    next[t.from] -= t.amount;
    next[t.to] += t.amount;
  }
  return next;
}

/** What this hand did to each seat, for the result sheet. */
export function handDeltas(result: HandResult | null): Record<Seat, number> {
  return applyResult(NO_SCORES, result) as Record<Seat, number>;
}

export function standings(scores: Scores): Seat[] {
  return [...SEATS].sort((a, b) => scores[b] - scores[a]);
}

/** "+4,000" / "−2,000" / "0" */
export function signed(n: number): string {
  if (n === 0) return '0';
  const abs = Math.abs(n).toLocaleString('en-GB');
  return n > 0 ? `+${abs}` : `\u2212${abs}`;
}

export function scoresFrom(list: readonly number[] | null | undefined): Scores {
  if (!list || list.length !== 4) return NO_SCORES;
  return { 0: list[0]!, 1: list[1]!, 2: list[2]!, 3: list[3]! };
}
