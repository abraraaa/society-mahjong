'use client';
import { useEffect, useRef } from 'react';
import { tileName, type ClaimOption, type TileKind } from '@society/engine';
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
 */
export function ClaimSheet({
  discardKind,
  discarderName,
  heldCount,
  options,
  onClaim,
  onPass,
}: {
  discardKind: TileKind;
  discarderName: string;
  /** how many of the discarded kind is already in your hand, for the coach-style caption */
  heldCount: number;
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
  const best = byType('kong') ?? byType('pung') ?? byType('chow');
  const caption = win
    ? 'This completes your hand.'
    : best
      ? `You hold ${heldCount}. ${LABEL[best.type]} completes a set.`
      : "Nobody's collecting this one.";

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
            <p className="text-ivory-200/60 text-sm">{caption}</p>
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
              <button key={type} className={`btn ${type === best?.type ? 'btn-primary' : 'btn-ghost'}`} disabled={!opt} onClick={() => opt && onClaim(opt)}>
                {LABEL[type]}
              </button>
            );
          })}
          <button className="btn btn-quiet col-span-2" onClick={onPass}>
            Pass
          </button>
        </div>
      </div>
    </>
  );
}
