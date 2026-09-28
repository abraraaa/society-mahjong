import { SEATS, type Wind } from '@society/engine';
import { finalStandings } from '@/lib/live/final';
import { SHARE, hereCount, seatTag, startLabel, topLine, waitingForHost } from '@/lib/live/lifecycle-copy';
import type { RoomSnapshot } from '@/lib/live/snapshot';

const WINDS: readonly Wind[] = ['E', 'S', 'W', 'N'];

/**
 * The room lobby, before the first game and between games: who sits where,
 * who isn't here yet, how the last game ended, the link to send, and the
 * host's button (or who everyone's waiting for).
 */
export function RoomWaiting({
  room,
  ruleset,
  starting,
  error,
  copied,
  onStart,
  onShare,
  onLeave,
}: {
  room: RoomSnapshot;
  ruleset: string;
  starting?: boolean;
  error?: string | null;
  /** the link went to the clipboard (a phone that can't share): the button says so */
  copied?: boolean;
  onStart?: () => void;
  onShare?: () => void;
  onLeave?: () => void;
}) {
  // Before the first game, with a seat still empty, sending the link is the thing to do; Start steps back until it's needed.
  const shareFirst = room.status === 'lobby' && room.seats.some((s) => s === null);
  const shareLabel = copied ? SHARE.copied : SHARE.button;
  const last = room.lastGame ?? null;
  const lastLine =
    last &&
    topLine(
      finalStandings(
        SEATS.map((seat) => last.rows.find((r) => r.seat === seat) ?? null),
        SEATS.map((seat) => last.rows.find((r) => r.seat === seat)?.score ?? 0),
      ),
      last.me,
      'then',
    );
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pt-[84px] pb-10">
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">Room code</p>
          <p className="font-display text-5xl leading-none tracking-[0.08em]">{room.code}</p>
          <p className="text-ivory-200/60 text-sm">
            {SHARE.line}
            {onShare && !shareFirst && (
              <>
                {' '}
                <button type="button" className="underline decoration-ivory-200/40 underline-offset-2" onClick={onShare}>
                  {shareLabel}
                </button>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {WINDS.map((wind, i) => {
            const s = room.seats[i] ?? null;
            const filled = s !== null;
            return (
              <div key={wind} className="flex items-center gap-3 rounded-2xl bg-felt-800/60 px-3.5 py-3" style={{ opacity: filled && !s.notHere ? 1 : 0.6 }}>
                <span
                  className="grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-medium text-ink-900"
                  style={{ background: filled ? 'var(--color-ivory-50)' : 'rgb(251 247 238 / 0.25)' }}
                >
                  {wind}
                </span>
                <span className="flex-1 text-base">{s ? s.name : 'Waiting…'}</span>
                <span className="text-ivory-200/55 text-xs">{seatTag(room, i)}</span>
              </div>
            );
          })}
        </div>

        {lastLine && (
          <div className="flex flex-col gap-1">
            <p className="eyebrow">Last game</p>
            <p className="text-ivory-200/80 text-sm">{lastLine}</p>
          </div>
        )}

        <div className="flex gap-2">
          <span className="chip">{ruleset}</span>
          <span className="chip chip-gold">Tutor on</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {error && <p className="text-center text-sm text-red-300">{error}</p>}
        {onShare && shareFirst && (
          <button type="button" className="btn btn-primary btn-block min-h-[52px] text-[18px]" onClick={onShare}>
            {shareLabel}
          </button>
        )}
        {room.isHost ? (
          <button className={shareFirst ? 'btn btn-ghost btn-block' : 'btn btn-primary btn-block min-h-[52px] text-[18px]'} onClick={onStart} disabled={starting}>
            {starting ? 'Dealing…' : startLabel(room)}
          </button>
        ) : (
          <p className="text-ivory-200/60 text-center text-sm">{waitingForHost(room)}</p>
        )}
        <p className="text-ivory-200/60 text-center text-sm">{hereCount(room, ruleset)}</p>
      </div>
      {onLeave && (
        <p className="mt-4 text-center">
          <button type="button" className="link-quiet" onClick={onLeave}>
            Leave the room
          </button>
        </p>
      )}
    </main>
  );
}
