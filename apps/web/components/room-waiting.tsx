import type { Wind } from '@society/engine';

export type LobbySeat = { readonly kind: 'human' | 'bot'; readonly name: string } | null;
const WINDS: readonly Wind[] = ['E', 'S', 'W', 'N'];

/** The room lobby, before the host starts the table. */
export function RoomWaiting({
  code,
  seats,
  me,
  ruleset,
  isHost,
  starting,
  error,
  onStart,
  onShare,
}: {
  code: string;
  seats: readonly LobbySeat[];
  me: number | null;
  ruleset: string;
  isHost: boolean;
  starting?: boolean;
  error?: string | null;
  onStart?: () => void;
  onShare?: () => void;
}) {
  const humans = seats.filter((s) => s?.kind === 'human').length;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pt-[84px] pb-10">
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">Room code</p>
          <p className="font-display text-5xl leading-none tracking-[0.08em]">{code}</p>
          <p className="text-ivory-200/60 text-sm">
            Share it, or send the link.{' '}
            {onShare && (
              <button type="button" className="underline decoration-ivory-200/40 underline-offset-2" onClick={onShare}>
                Copy link
              </button>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {WINDS.map((wind, i) => {
            const s = seats[i] ?? null;
            const filled = s !== null;
            return (
              <div key={wind} className="flex items-center gap-3 rounded-2xl bg-felt-800/60 px-3.5 py-3" style={{ opacity: filled ? 1 : 0.6 }}>
                <span
                  className="grid h-8 w-8 flex-none place-items-center rounded-full text-[13px] font-medium text-ink-900"
                  style={{ background: filled ? 'var(--color-ivory-50)' : 'rgb(251 247 238 / 0.25)' }}
                >
                  {wind}
                </span>
                <span className="flex-1 text-base">{s ? s.name : 'Waiting…'}</span>
                <span className="text-ivory-200/55 text-xs">{i === me ? 'you' : s?.kind === 'bot' ? 'bot' : i === 0 ? 'host' : ''}</span>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <span className="chip">{ruleset}</span>
          <span className="chip chip-gold">Tutor on</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {error && <p className="text-center text-sm text-red-300">{error}</p>}
        {isHost ? (
          <button className="btn btn-primary btn-block min-h-[52px] text-[18px]" onClick={onStart} disabled={starting}>
            {starting ? 'Dealing…' : humans === 4 ? 'Start' : 'Start, bots in the empty seats'}
          </button>
        ) : (
          <p className="text-ivory-200/60 text-center text-sm">Waiting for the host to start.</p>
        )}
        <p className="text-ivory-200/60 text-center text-sm">
          {humans} of 4 seated · {ruleset}
        </p>
      </div>
    </main>
  );
}
