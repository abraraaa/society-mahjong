/**
 * Clocks under a card. Reading a word or a hand's card mustn't cost the player
 * a claim. On the bots the claim sheet's own countdown holds while a card or a
 * word is open over it. At a live table nobody can hold the table's clock, so
 * the card shows it, and gets out of the way once, with a few seconds left.
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
 * Whether the claim sheet shows a countdown, and whether it passes for the
 * player when the countdown runs out. On the bots a winning tile is never
 * taken away by the clock, so it has neither. At a live table the table's
 * deadline applies to a win too (a long one, the turn clock), so the bar shows,
 * because a clock you can't see is a trap. But the sheet never passes on a win:
 * the table's clock runs out and its stand-in takes the win for the player
 * (`resolveExpired`, lib/live/table.ts). Anything else passes when its bar runs out.
 */
export function claimTimer(clock: 'solo' | 'server', win: boolean): { readonly bar: boolean; readonly passes: boolean } {
  return { bar: clock === 'server' || !win, passes: !win };
}

/**
 * Whose clock the claim sheet runs on, and how long its bar runs. A live table
 * always passes `claimMs` in a claim window: the time until the sheet passes
 * for the player, `passMarginMs` ahead of the table's deadline, and 0 in the
 * window's last moments. So it's told from solo by null, never by truth: a
 * window that arrives that late still passes on the table's clock, after a
 * second, rather than getting the bots' eight seconds. A win on offer isn't
 * passed for the player (`claimTimer`), so its bar runs to the table's own
 * deadline. Solo passes nothing, and the sheet keeps its own countdown.
 */
export function claimSheetClock(
  claimMs: number | null | undefined,
  winOffered = false,
  passMarginMs = 0,
): { readonly claimMs: number; readonly clock: 'server' } | Record<string, never> {
  return claimMs != null ? { claimMs: Math.max(1000, claimMs + (winOffered ? passMarginMs : 0)), clock: 'server' } : {};
}

/**
 * The claim sheet's bar, as a CSS animation: it drains over the window's whole
 * length, `fullMs`, the time it had when the sheet first showed it, and starts
 * `fullMs - leftMs` in, so it's empty exactly when what's left runs out. A
 * live table sends what's left with every fresh table (the slow poll, a poke
 * from someone else's move, a reconnect), and the bar is drawn again from
 * there, part-drained. Stretching what's left over the time already gone would
 * empty it early: halfway through a win's ninety seconds, with forty left.
 * Never more than full, if a fresh table brings more time than the first.
 */
export function claimBar(fullMs: number, leftMs: number): { readonly durationMs: number; readonly delayMs: number } {
  const left = Math.max(0, leftMs);
  const duration = Math.max(fullMs, left);
  return { durationMs: duration, delayMs: left - duration };
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
  /** the claim window offers the player a win, which the sheet never passes on (`claimTimer`) */
  readonly winOffered: boolean;
  /** how early the claim sheet passes for the player, ahead of the table's deadline */
  readonly passMarginMs: number;
}): CardClock {
  if (i.soloClaimTimed) return { kind: 'paused' };
  // The time until the sheet passes for the player, which is the time they really have. A win isn't passed on: the
  // player has until the table's clock runs out, and then its stand-in takes the win for them.
  if (i.claimOpen && i.clock?.kind === 'claim') return { kind: 'running', what: 'claim', ms: Math.max(0, i.clock.ms - (i.winOffered ? 0 : i.passMarginMs)) };
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

/**
 * Whether a live clock is in its last few seconds. Only while it's still
 * counting: at nought it has stopped (the sheet has passed, or the table is
 * settling it, or the phone can't reach the table to), and nothing's left to
 * make way for.
 */
export function stepsAside(c: CardClock): boolean {
  return c?.kind === 'running' && c.ms > 0 && c.ms <= STEP_ASIDE_MS;
}
