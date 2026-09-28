'use client';
import { useEffect, useRef } from 'react';
import { tileName, type ClaimOption, type TileKind } from '@society/engine';
import type { CoachState } from '@/lib/coach';
import { msLeft, pauseCountdown, resumeCountdown, startCountdown, type Countdown } from '@/lib/coach/clock';
import type { Lesson } from '@/lib/coach/teach';
import { CoachLine, CoachNotes, useSheetOpen } from './coach';
import { Tile } from './tile';

/** Solo default; a live table passes the server's deadline instead. Mirrors --claim-seconds in globals.css. */
const CLAIM_MS = 8000;

type ClaimType = ClaimOption['type'];
const GRID: readonly ClaimType[] = ['pung', 'chow', 'kong'];
const LABEL: Record<ClaimType, string> = { pung: 'Pung', chow: 'Chow', kong: 'Kong', win: 'Mahjong' };

/**
 * Bottom sheet for the 8-second claim window. Every claim type the ruleset can
 * ever offer is shown — unavailable ones stay visible but dimmed, so the
 * vocabulary is learned (Design Guide, rules of the table §4). A type the
 * ruleset never allows (Chow in Karachi) is left out rather than dimmed: a button
 * that can never light up teaches that the move exists. The window auto-passes
 * if nobody taps a button in time. On the bots, the countdown holds while a
 * word or a hand's card is open over the sheet: reading mustn't cost the claim.
 *
 * The caption and the highlighted button both come from the coach, which has
 * re-analysed the hand as it would stand after each claim. That is the only
 * honest way to answer "does this help me": in Karachi a pung can shut a hand
 * out of the round's chow patterns entirely.
 */
export function ClaimSheet({
  discardKind,
  discarderName,
  discardCount,
  coach,
  lesson = null,
  options,
  onClaim,
  onPass,
  claimMs = CLAIM_MS,
  clock = 'solo',
  busy = false,
}: {
  discardKind: TileKind;
  discarderName: string;
  /**
   * Which discard of the hand this is. A new one is a new claim window, even when
   * the sheet stays up for it (a live table's reply to a pass can bring the next
   * window straight away), so the caption and the timer start again with it, and
   * a card opened from the last window's caption closes.
   */
  discardCount: number;
  coach: CoachState;
  /** the first-sight footnotes for the line, from `useLesson`: they go full width under it, the first time a hand is named here */
  lesson?: Lesson | null;
  options: readonly ClaimOption[];
  onClaim: (option: ClaimOption) => void;
  onPass: () => void;
  claimMs?: number;
  /** whose clock: the sheet's own eight seconds, or a server deadline that applies to a win too */
  clock?: 'solo' | 'server';
  /** an answer is already on its way to the table: every button waits for it */
  busy?: boolean;
}) {
  const onPassRef = useRef(onPass);
  useEffect(() => {
    onPassRef.current = onPass;
  });

  const win = options.find((o) => o.type === 'win');
  // On a solo table a winning tile is never taken away by the clock. On a live
  // table the server's deadline applies to a win too (a long one, the turn
  // clock), so the bar has to show: a clock you cannot see is a trap.
  const timed = clock === 'server' || !win;
  // A card or a word open over the sheet holds the bots' countdown. The table's
  // clock can't be held, so a live sheet runs on, and the card shows that clock.
  const sheetOpen = useSheetOpen();
  const paused = clock === 'solo' && timed && sheetOpen;
  // Kept on Date.now(), which is the clock Playwright drives.
  const countdown = useRef<Countdown | null>(null);
  // One countdown per discard, started again when the server sends a fresh
  // deadline. A sheet that opens under a card starts held (the effect below).
  useEffect(() => {
    countdown.current = timed ? startCountdown(claimMs, Date.now()) : null;
  }, [discardCount, claimMs, timed]);
  // Held, or running with the pass set for whatever is left.
  useEffect(() => {
    const c = countdown.current;
    if (!c) return;
    const now = Date.now();
    if (paused) {
      countdown.current = pauseCountdown(c, now);
      return;
    }
    const running = resumeCountdown(c, now);
    countdown.current = running;
    const t = setTimeout(() => onPassRef.current(), msLeft(running, now));
    return () => clearTimeout(t);
  }, [paused, discardCount, claimMs, timed]);
  const byType = (t: ClaimType) => options.find((o) => o.type === t);
  const advised = coach.action.kind === 'claim' ? coach.action.option : null;
  const grid = GRID.filter((type) => type !== 'chow' || coach.goal.chowsClaimable);

  return (
    <>
      <div className="scrim" />
      <div className="sheet" data-sheet="claim">
        <div className="grabber" />
        {timed && (
          <div key={discardCount} className="timer mb-4" data-paused={paused || undefined} style={{ '--claim-seconds': `${Math.round(claimMs / 1000)}s` } as React.CSSProperties}>
            <i />
          </div>
        )}
        <div className="mb-4 flex items-center gap-4">
          <Tile kind={discardKind} size="lg" />
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">
              <bdi>{discarderName}</bdi> discards {tileName(discardKind)}
            </h2>
            <p className="text-ivory-200/70 text-sm">
              <CoachLine key={discardCount} say={coach.say} origin="claim" />
            </p>
          </div>
        </div>
        <CoachNotes coach={coach} lesson={lesson} where="sheet" />
        {(coach.stage === 'new' || coach.stage === 'first_hand') && (
          <p className="text-ivory-200/60 mb-3 text-xs leading-snug">
            Pung takes it to make three of a kind, Kong four; either lays the set face up. Pass lets it go and the turn moves on.
          </p>
        )}
        {win && (
          <button className="btn btn-gold btn-block mb-3" disabled={busy} onClick={() => onClaim(win)}>
            Mahjong!
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {grid.map((type) => {
            const opt = byType(type);
            return (
              <button key={type} className={`btn ${opt && opt === advised ? 'btn-primary' : 'btn-ghost'}`} disabled={busy || !opt} onClick={() => opt && onClaim(opt)}>
                {LABEL[type]}
              </button>
            );
          })}
          <button className={`btn col-span-2 ${coach.action.kind === 'pass' ? 'btn-ghost' : 'btn-quiet'}`} disabled={busy} onClick={onPass}>
            Pass
          </button>
        </div>
      </div>
    </>
  );
}
