'use client';
import { useEffect, useRef } from 'react';
import { tileName, type ClaimOption, type TileKind } from '@society/engine';
import type { CoachState } from '@/lib/coach';
import { CoachLine } from './coach';
import { Tile } from './tile';

const CLAIM_MS = 8000; // mirrors --claim-seconds in globals.css

type ClaimType = ClaimOption['type'];
const GRID: readonly ClaimType[] = ['pung', 'chow', 'kong'];
const LABEL: Record<ClaimType, string> = { pung: 'Pung', chow: 'Chow', kong: 'Kong', win: 'Mahjong' };

/**
 * Bottom sheet for the 8-second claim window. All claim types are always
 * shown — unavailable ones stay visible but dimmed, so the vocabulary is
 * learned (Design Guide, rules of the table §4) — and the window
 * auto-passes if nobody taps a button in time.
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
}: {
  discardKind: TileKind;
  discarderName: string;
  coach: CoachState;
  options: readonly ClaimOption[];
  onClaim: (option: ClaimOption) => void;
  onPass: () => void;
}) {
  const onPassRef = useRef(onPass);
  useEffect(() => {
    onPassRef.current = onPass;
  });

  useEffect(() => {
    const t = setTimeout(() => onPassRef.current(), CLAIM_MS);
    return () => clearTimeout(t);
    // one countdown per discard: discardKind + discarderName changes whenever a new one arrives
  }, [discardKind, discarderName]);

  const win = options.find((o) => o.type === 'win');
  const byType = (t: ClaimType) => options.find((o) => o.type === t);
  const advised = coach.action.kind === 'claim' ? coach.action.option : null;

  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        <div className="timer mb-4">
          <i />
        </div>
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
        {win && (
          <button className="btn btn-gold btn-block mb-3" onClick={() => onClaim(win)}>
            Mahjong!
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {GRID.map((type) => {
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
