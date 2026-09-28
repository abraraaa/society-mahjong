import Link from 'next/link';
import { NO_SEAT, NO_SEAT_OVER, takeSeatCopy } from '@/lib/live/lifecycle-copy';
import type { SeatOffer } from '@/lib/live/seating';

/**
 * Someone not seated at a game in play, with a bot's seat they can take over:
 * their own seat back, the seat kept for them since the deal, or another
 * bot's, with the points they'd carry on with. One tap takes it; a quiet link
 * goes back.
 */
export function TakeSeat({ offer, busy, error, onTake, cancelHref = '/' }: { offer: SeatOffer; busy: boolean; error?: string | null; onTake: () => void; cancelHref?: string }) {
  const { title, body, confirmLabel, cancelLabel } = takeSeatCopy(offer);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl">{title}</h1>
        <p className="text-ivory-200/70 text-sm">{body}</p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <button type="button" className="btn btn-primary btn-block min-h-[52px] text-[18px]" disabled={busy} onClick={onTake}>
          {busy ? 'One moment…' : confirmLabel}
        </button>
        {error && (
          <p className="text-center text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <Link href={cancelHref} className="link-quiet">
          {cancelLabel}
        </Link>
      </div>
    </main>
  );
}

/**
 * Someone not seated at a game with no seat for them: every seat is a
 * person's, so the next game is theirs to join; or the game is over, and the
 * room is where the next one starts.
 */
export function NoSeat({ over = false, roomCode }: { over?: boolean; roomCode?: string }) {
  const { heading, line, link } = over ? NO_SEAT_OVER : NO_SEAT;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="font-display text-3xl">{heading}</h1>
        <p className="text-ivory-200/70 text-sm">{line}</p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <Link href={over && roomCode ? `/r/${roomCode}` : '/'} className="link-quiet">
          {link}
        </Link>
      </div>
    </main>
  );
}
