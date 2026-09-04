'use client';
import { useEffect, useRef } from 'react';
import { tileName, type ClaimOption, type TileKind } from '@society/engine';
import type { CoachState } from '@/lib/coach';
import { CoachLine } from './coach';
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
 * if nobody taps a button in time.
 *
 * The caption and the highlighted button both come from the coach, which has
 * re-analysed the hand as it would stand after each claim. That is the only
 * honest way to answer "does this help me": in Karachi a pung can shut a hand
 * out of the round's chow patterns entirely.
 */
export function ClaimSheet({
  discardKind,
  discarderName,
  coach,
  options,
  onClaim,
  onPass,
  claimMs = CLAIM_MS,
  clock = 'solo',
}: {
  discardKind: TileKind;
  discarderName: string;
  coach: CoachState;
  options: readonly ClaimOption[];
  onClaim: (option: ClaimOption) => void;
  onPass: () => void;
  claimMs?: number;
  /** whose clock: the sheet's own eight seconds, or a server deadline that applies to a win too */
  clock?: 'solo' | 'server';
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
  useEffect(() => {
    if (!timed) return;
    const t = setTimeout(() => onPassRef.current(), claimMs);
    return () => clearTimeout(t);
    // one countdown per discard: discardKind + discarderName changes whenever a new one arrives
  }, [discardKind, discarderName, claimMs, timed]);
  const byType = (t: ClaimType) => options.find((o) => o.type === t);
  const advised = coach.action.kind === 'claim' ? coach.action.option : null;
  const grid = GRID.filter((type) => type !== 'chow' || coach.goal.chowsClaimable);

  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        {timed && (
          <div className="timer mb-4" style={{ '--claim-seconds': `${Math.round(claimMs / 1000)}s` } as React.CSSProperties}>
            <i />
          </div>
        )}
        <div className="mb-4 flex items-center gap-4">
          <Tile kind={discardKind} size="lg" />
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">
              {discarderName} discards {tileName(discardKind)}
            </h2>
            <p className="text-ivory-200/70 text-sm">
              <CoachLine say={coach.say} />
            </p>
          </div>
        </div>
        {(coach.stage === 'new' || coach.stage === 'first_hand') && (
          <p className="text-ivory-200/60 mb-3 text-xs leading-snug">
            Pung takes it to make three of a kind, Kong four; either lays the set face up. Pass lets it go and the turn moves on.
          </p>
        )}
        {win && (
          <button className="btn btn-gold btn-block mb-3" onClick={() => onClaim(win)}>
            Mahjong!
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {grid.map((type) => {
            const opt = byType(type);
            return (
              <button key={type} className={`btn ${opt && opt === advised ? 'btn-primary' : 'btn-ghost'}`} disabled={!opt} onClick={() => opt && onClaim(opt)}>
                {LABEL[type]}
              </button>
            );
          })}
          <button className={`btn col-span-2 ${coach.action.kind === 'pass' ? 'btn-ghost' : 'btn-quiet'}`} onClick={onPass}>
            Pass
          </button>
        </div>
      </div>
    </>
  );
}
