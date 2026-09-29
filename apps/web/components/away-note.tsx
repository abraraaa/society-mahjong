'use client';

/**
 * What a player comes back to while a bot is playing their tiles: why, what
 * it has done for them so far, and one button to take their seat back.
 *
 * A bottom sheet, but not a question: no scrim and no grabber, so the table
 * above it stays in view and the header's buttons stay tappable. It covers
 * the hand dock, whose tiles aren't theirs to play until they're back, and the
 * table draws it in place of the claim and pass sheets.
 */
export function AwayNote({ title, detail, actionLabel, busy, onAction }: { title: string; detail: string; actionLabel: string; busy: boolean; onAction: () => void }) {
  return (
    <div className="sheet" role="region" aria-labelledby="away-title">
      <p id="away-title" className="font-display mb-1 text-lg">
        {title}
      </p>
      <p className="text-ivory-200/70 mb-4 text-sm leading-snug">{detail}</p>
      <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={onAction}>
        {busy ? 'One moment…' : actionLabel}
      </button>
    </div>
  );
}
