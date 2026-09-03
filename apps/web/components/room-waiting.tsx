import type { Wind } from '@society/engine';

export interface RoomSeat {
  readonly wind: Wind;
  readonly name: string;
  readonly note: string;
  readonly filled: boolean;
}

/**
 * "Waiting for friends" — the room lobby, before four seats are filled.
 * Illustrative for now: Society Mahjong doesn't have real rooms yet
 * (see docs/PLAN.md, milestone M2), so `onFillWithBots` is the only seat
 * the host can actually take today — straight into the solo table.
 */
export function RoomWaiting({
  code,
  seats,
  ruleset,
  goulash,
  tutor,
  onFillWithBots,
}: {
  code: string;
  seats: readonly RoomSeat[];
  ruleset: string;
  goulash: boolean;
  tutor: boolean;
  onFillWithBots: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pt-[84px] pb-10">
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">Room code</p>
          <p className="font-display text-5xl leading-none tracking-[0.08em]">{code}</p>
          <p className="text-ivory-200/60 text-sm">Share it, or send the link.</p>
        </div>

        <div className="flex flex-col gap-2">
          {seats.map((s) => (
            <div key={s.wind} className="flex items-center gap-3 rounded-2xl bg-felt-800/60 px-3.5 py-3" style={{ opacity: s.filled ? 1 : 0.6 }}>
              <span
                className="grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-medium text-ink-900"
                style={{ background: s.filled ? 'var(--color-ivory-50)' : 'rgb(251 247 238 / 0.25)' }}
              >
                {s.wind}
              </span>
              <span className="flex-1 text-base">{s.name}</span>
              <span className="text-ivory-200/55 text-xs">{s.note}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <span className="chip">{ruleset}</span>
          {goulash && <span className="chip">Goulash on</span>}
          {tutor && <span className="chip chip-gold">Tutor on</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <button className="btn btn-primary btn-block min-h-[52px] text-[18px]" onClick={onFillWithBots}>
          Fill empty seats with bots
        </button>
        <p className="text-ivory-200/60 text-center text-sm">Starts when four are seated.</p>
      </div>
    </main>
  );
}
