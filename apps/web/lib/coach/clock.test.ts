import { describe, expect, it } from 'vitest';
import {
  STEP_ASIDE_MS,
  cardClockFor,
  cardClockLine,
  claimBar,
  claimSheetClock,
  claimTimer,
  mmss,
  msLeft,
  pauseCountdown,
  resumeCountdown,
  startCountdown,
  stepsAside,
  type CardClock,
} from './clock';

describe('a countdown that can be held', () => {
  it('runs down from where it started', () => {
    const c = startCountdown(8000, 1000);
    expect(msLeft(c, 1000)).toBe(8000);
    expect(msLeft(c, 3500)).toBe(5500);
  });

  it('holds while paused and runs on from there when resumed', () => {
    const paused = pauseCountdown(startCountdown(8000, 0), 2500);
    expect(paused).toEqual({ left: 5500, since: null });
    // Twenty seconds of reading cost nothing.
    expect(msLeft(paused, 22_500)).toBe(5500);
    const resumed = resumeCountdown(paused, 22_500);
    expect(msLeft(resumed, 22_500)).toBe(5500);
    expect(msLeft(resumed, 26_500)).toBe(1500);
  });

  it('pausing twice or resuming a running one changes nothing', () => {
    const paused = pauseCountdown(startCountdown(8000, 0), 1000);
    expect(pauseCountdown(paused, 5000)).toBe(paused);
    const running = startCountdown(8000, 0);
    expect(resumeCountdown(running, 5000)).toBe(running);
  });

  it('holds and resumes over and over without losing or gaining time', () => {
    let c = startCountdown(8000, 0);
    let now = 0;
    for (let i = 0; i < 5; i++) {
      now += 1000; // a second running
      c = pauseCountdown(c, now);
      now += 10_000; // ten seconds held
      c = resumeCountdown(c, now);
    }
    expect(msLeft(c, now)).toBe(3000);
  });

  it('never goes below nought, and a clock going backwards takes nothing off', () => {
    expect(msLeft(startCountdown(8000, 0), 60_000)).toBe(0);
    expect(msLeft(pauseCountdown(startCountdown(8000, 0), 60_000), 70_000)).toBe(0);
    expect(msLeft(startCountdown(8000, 5000), 1000)).toBe(8000);
    expect(startCountdown(-5, 0).left).toBe(0);
  });
});

describe('whose clock the claim sheet runs on', () => {
  it("runs a live window on the table's clock, even one that arrives in its last moments", () => {
    expect(claimSheetClock(8500)).toEqual({ claimMs: 8500, clock: 'server' });
    // Under the margin the live table sends 0: still the table's clock, passing after a second, never the bots' eight.
    expect(claimSheetClock(0)).toEqual({ claimMs: 1000, clock: 'server' });
    expect(claimSheetClock(400)).toEqual({ claimMs: 1000, clock: 'server' });
  });

  it('leaves solo, which passes nothing, to its own countdown', () => {
    expect(claimSheetClock(undefined)).toEqual({});
    expect(claimSheetClock(null)).toEqual({});
    expect(claimSheetClock(undefined, true, 1500)).toEqual({});
  });

  it("runs a live win's bar to the table's own deadline: the margin kept for a pass goes back on", () => {
    expect(claimSheetClock(8500, true, 1500)).toEqual({ claimMs: 10_000, clock: 'server' });
    expect(claimSheetClock(0, true, 1500)).toEqual({ claimMs: 1500, clock: 'server' });
    // Anything else still runs to the moment the sheet passes.
    expect(claimSheetClock(8500, false, 1500)).toEqual({ claimMs: 8500, clock: 'server' });
  });
});

describe('when the claim sheet passes for the player', () => {
  it('passes on anything but a win, on the bots and at a live table, when its bar runs out', () => {
    expect(claimTimer('solo', false)).toEqual({ bar: true, passes: true });
    expect(claimTimer('server', false)).toEqual({ bar: true, passes: true });
  });

  it('never times a win on the bots', () => {
    expect(claimTimer('solo', true)).toEqual({ bar: false, passes: false });
  });

  it("shows a live win's clock but never passes on it: the table's stand-in takes the win when the clock runs out", () => {
    expect(claimTimer('server', true)).toEqual({ bar: true, passes: false });
  });
});

describe("the claim sheet's bar", () => {
  it('drains over the whole window and is empty when the table runs out, however late a fresh table comes', () => {
    // A win on a new player's turn clock: ninety seconds. The page looks again every twelve.
    expect(claimBar(90_000, 90_000)).toEqual({ durationMs: 90_000, delayMs: 0 });
    for (const gone of [12_000, 24_000, 36_000, 48_000, 84_000]) {
      const { durationMs, delayMs } = claimBar(90_000, 90_000 - gone);
      // Drawn part-drained, as far in as the time already gone ...
      expect(-delayMs / durationMs).toBeCloseTo(gone / 90_000);
      // ... with exactly what's left to run.
      expect(durationMs + delayMs).toBe(90_000 - gone);
    }
  });

  it('is full, never over, when a fresh table brings more time than the first; and empty at nought', () => {
    expect(claimBar(8_000, 9_000)).toEqual({ durationMs: 9_000, delayMs: 0 });
    expect(claimBar(8_000, 0)).toEqual({ durationMs: 8_000, delayMs: -8_000 });
    expect(claimBar(8_000, -500)).toEqual({ durationMs: 8_000, delayMs: -8_000 });
  });
});

describe('the clock a card or a word shows', () => {
  const none = { claimOpen: false, soloClaimTimed: false, clock: null, myTurn: false, exchange: false, winOffered: false, passMarginMs: 1500 } as const;

  it('holds a solo claim with a countdown', () => {
    expect(cardClockFor({ ...none, claimOpen: true, soloClaimTimed: true })).toEqual({ kind: 'paused' });
  });

  it("shows a live claim's time until the sheet passes, less the margin", () => {
    expect(cardClockFor({ ...none, claimOpen: true, clock: { kind: 'claim', ms: 10_000 } })).toEqual({ kind: 'running', what: 'claim', ms: 8500 });
    // In the window's last moments there is nothing left to show, and never less than nothing.
    expect(cardClockFor({ ...none, claimOpen: true, clock: { kind: 'claim', ms: 900 } })).toEqual({ kind: 'running', what: 'claim', ms: 0 });
  });

  it("shows a live win's time until the table's clock runs out, since the sheet never passes on it", () => {
    expect(cardClockFor({ ...none, claimOpen: true, winOffered: true, clock: { kind: 'claim', ms: 10_000 } })).toEqual({ kind: 'running', what: 'claim', ms: 10_000 });
    expect(cardClockFor({ ...none, claimOpen: true, winOffered: true, clock: { kind: 'claim', ms: 900 } })).toEqual({ kind: 'running', what: 'claim', ms: 900 });
  });

  it("shows the player's own turn clock", () => {
    expect(cardClockFor({ ...none, myTurn: true, clock: { kind: 'turn', ms: 42_000 } })).toEqual({ kind: 'running', what: 'turn', ms: 42_000 });
  });

  it("shows the exchange's clock", () => {
    expect(cardClockFor({ ...none, exchange: true, clock: { kind: 'turn', ms: 30_000 } })).toEqual({ kind: 'running', what: 'exchange', ms: 30_000 });
  });

  it("shows nothing when no clock of the player's is running", () => {
    // Solo: no table clock, and a claim with a win offered has no countdown.
    expect(cardClockFor({ ...none, claimOpen: true })).toBeNull();
    expect(cardClockFor({ ...none, myTurn: true })).toBeNull();
    // Someone else's turn, or someone else's claim at a live table.
    expect(cardClockFor({ ...none, clock: { kind: 'turn', ms: 30_000 } })).toBeNull();
    expect(cardClockFor({ ...none, clock: { kind: 'claim', ms: 30_000 } })).toBeNull();
    // A claim clock isn't a turn clock, nor the other way round.
    expect(cardClockFor({ ...none, myTurn: true, clock: { kind: 'claim', ms: 30_000 } })).toBeNull();
    expect(cardClockFor({ ...none, claimOpen: true, clock: { kind: 'turn', ms: 30_000 } })).toBeNull();
  });

  it('prefers the held claim, then a live claim, then the turn, then the exchange', () => {
    const all = { claimOpen: true, soloClaimTimed: true, clock: { kind: 'claim', ms: 9000 }, myTurn: true, exchange: true, winOffered: false, passMarginMs: 1500 } as const;
    expect(cardClockFor(all)?.kind).toBe('paused');
    expect(cardClockFor({ ...all, soloClaimTimed: false })).toMatchObject({ what: 'claim' });
    expect(cardClockFor({ ...all, soloClaimTimed: false, clock: { kind: 'turn', ms: 9000 } })).toMatchObject({ what: 'turn' });
    expect(cardClockFor({ ...all, soloClaimTimed: false, myTurn: false, clock: { kind: 'turn', ms: 9000 } })).toMatchObject({ what: 'exchange' });
  });

  it('says each in words', () => {
    expect(cardClockLine({ kind: 'paused' })).toBe("Your claim's on hold while you read.");
    expect(cardClockLine({ kind: 'running', what: 'claim', ms: 8500 })).toBe("The table's clock is still running: 0:09.");
    expect(cardClockLine({ kind: 'running', what: 'turn', ms: 75_000 })).toBe("Your turn's clock is still running: 1:15.");
    expect(cardClockLine({ kind: 'running', what: 'exchange', ms: 0 })).toBe('Your exchange clock is still running: 0:00.');
    expect(cardClockLine(null)).toBeNull();
  });

  it('writes m:ss rounded up, as the table does', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(1)).toBe('0:01');
    expect(mmss(59_001)).toBe('1:00');
    expect(mmss(600_000)).toBe('10:00');
    expect(mmss(-500)).toBe('0:00');
  });

  it('steps aside with four seconds left on a live clock, never on a held claim', () => {
    const at = (ms: number): CardClock => ({ kind: 'running', what: 'claim', ms });
    expect(stepsAside(at(STEP_ASIDE_MS + 1))).toBe(false);
    expect(stepsAside(at(STEP_ASIDE_MS))).toBe(true);
    expect(stepsAside(at(1))).toBe(true);
    expect(stepsAside({ kind: 'running', what: 'turn', ms: 3000 })).toBe(true);
    expect(stepsAside({ kind: 'paused' })).toBe(false);
    expect(stepsAside(null)).toBe(false);
  });

  it("doesn't step aside for a clock that's stopped at nought, waiting for the table to settle it", () => {
    expect(stepsAside({ kind: 'running', what: 'claim', ms: 0 })).toBe(false);
    expect(stepsAside({ kind: 'running', what: 'turn', ms: 0 })).toBe(false);
    expect(stepsAside({ kind: 'running', what: 'exchange', ms: 0 })).toBe(false);
  });
});
