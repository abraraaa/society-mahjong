/**
 * Clocks under a card. Reading a word or a hand's card mustn't cost the player
 * a claim. On the bots the claim sheet's own countdown holds while a card or a
 * word is open over it. At a live table nobody can hold the table's clock, so
 * the card shows it, and gets out of the way with a few seconds left.
 */

/** A countdown that can be held: what was left when it last started, resumed or stopped, and since when it has run (null while held). */
export interface Countdown {
  readonly left: number;
  readonly since: number | null;
}

export function startCountdown(ms: number, now: number): Countdown {
  return { left: Math.max(0, ms), since: now };
}

/** Holds it where it stands. Holding one already held changes nothing. */
export function pauseCountdown(c: Countdown, now: number): Countdown {
  return c.since === null ? c : { left: msLeft(c, now), since: null };
}

/** Lets it run on from where it was held. One already running is unchanged. */
export function resumeCountdown(c: Countdown, now: number): Countdown {
  return c.since === null ? { left: c.left, since: now } : c;
}

/** What's left, never below nought. A clock that seems to go backwards takes nothing off. */
export function msLeft(c: Countdown, now: number): number {
  if (c.since === null) return c.left;
  return Math.max(0, c.left - Math.max(0, now - c.since));
}

/**
 * Whose clock the claim sheet runs on. A live table always passes `claimMs` in a
 * claim window, and 0 in its last moments, so it's told from solo by null, never
 * by truth: a window that arrives that late still passes on the table's clock,
 * after a second, rather than getting the bots' eight seconds. Solo passes
 * nothing, and the sheet keeps its own countdown.
 */
export function claimSheetClock(claimMs: number | null | undefined): { readonly claimMs: number; readonly clock: 'server' } | Record<string, never> {
  return claimMs != null ? { claimMs: Math.max(1000, claimMs), clock: 'server' } : {};
}

/**
 * What a card or a word says about the clock under it: the claim held (on the
 * bots), a live clock still running and how long it has, or nothing.
 */
export type CardClock = { readonly kind: 'paused' } | { readonly kind: 'running'; readonly what: 'claim' | 'turn' | 'exchange'; readonly ms: number } | null;

export function cardClockFor(i: {
  readonly claimOpen: boolean;
  /** a solo claim sheet with a countdown (no win offered) */
  readonly soloClaimTimed: boolean;
  /** the live table's ticking clock */
  readonly clock: { readonly kind: 'turn' | 'claim'; readonly ms: number } | null;
  readonly myTurn: boolean;
  readonly exchange: boolean;
  /** how early the claim sheet passes for the player, ahead of the table's deadline */
  readonly passMarginMs: number;
}): CardClock {
  if (i.soloClaimTimed) return { kind: 'paused' };
  // The time until the sheet passes for the player, which is the time they really have.
  if (i.claimOpen && i.clock?.kind === 'claim') return { kind: 'running', what: 'claim', ms: Math.max(0, i.clock.ms - i.passMarginMs) };
  if (i.myTurn && i.clock?.kind === 'turn') return { kind: 'running', what: 'turn', ms: i.clock.ms };
  if (i.exchange && i.clock?.kind === 'turn') return { kind: 'running', what: 'exchange', ms: i.clock.ms };
  return null;
}

/** m:ss, rounded up, as the table's own clock shows it, so the two never disagree. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const RUNNING: Record<'claim' | 'turn' | 'exchange', string> = {
  claim: "The table's clock is still running",
  turn: "Your turn's clock is still running",
  exchange: 'Your exchange clock is still running',
};

/** The line at the top of a card or a word. */
export function cardClockLine(c: CardClock): string | null {
  if (c === null) return null;
  if (c.kind === 'paused') return "Your claim's on hold while you read.";
  return `${RUNNING[c.what]}: ${mmss(c.ms)}.`;
}

/** With this little left on a live clock, an open card or word closes, so the player can still act in time. */
export const STEP_ASIDE_MS = 4000;

export function stepsAside(c: CardClock): boolean {
  return c?.kind === 'running' && c.ms <= STEP_ASIDE_MS;
}
