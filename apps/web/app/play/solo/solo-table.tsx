'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  SEATS,
  initialProgress,
  karachi,
  legalActions,
  nextHand,
  reduce,
  simpleBot,
  startHand,
  viewFor,
  type Action,
  type HandState,
  type Seat,
  type TileKind,
} from '@society/engine';
import { Tile } from '@/components/tile';

const ME: Seat = 0;
const ruleset = karachi;

function botStep(state: HandState): HandState {
  let s = state;
  for (const seat of SEATS) {
    if (seat === ME || s.phase === 'finished') continue;
    const a = simpleBot(viewFor(s, ruleset, seat));
    if (a) s = reduce(s, a, ruleset);
  }
  return s;
}

export function SoloTable() {
  const [seed] = useState(() => `solo-${Date.now()}`);
  const [state, setState] = useState<HandState>(() => startHand(ruleset, { seed, progress: initialProgress, dealer: 0 }));
  const [selected, setSelected] = useState<TileKind | null>(null);
  const me = state.players[ME];
  const legal = useMemo(() => legalActions(state, ruleset, ME), [state]);
  const myMove = legal.discard || legal.claims || legal.exchange || legal.win;

  // Let bots act whenever it is not our move, paced so the table reads as a conversation.
  useEffect(() => {
    if (state.phase === 'finished' || myMove) return;
    const t = setTimeout(() => setState((s) => botStep(s)), 450);
    return () => clearTimeout(t);
  }, [state, myMove]);

  const act = (a: Action) => {
    setSelected(null);
    setState((s) => reduce(s, a, ruleset));
  };

  const spec = ruleset.handSpec(state.progress);

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">{spec.label}</h1>
        <span className="text-ivory-200/60 text-sm">Wall {state.wall.live.length}</span>
      </header>

      <section className="grid grid-cols-3 gap-2 text-xs text-ivory-200/70">
        {([1, 2, 3] as const).map((seat) => {
          const p = state.players[seat];
          return (
            <div key={seat} className="rounded-xl bg-felt-800/60 p-2">
              <div className="mb-1 flex justify-between">
                <span>Seat {p.seatWind}</span>
                <span>{state.turn === seat && state.phase === 'turn' ? '●' : ''}</span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {p.melds.map((m, i) => (
                  <span key={i} className="rounded bg-ivory-50/90 px-1 text-ink-900">
                    {m.tiles.join(' ')}
                  </span>
                ))}
                {p.concealed.map((_, i) => (
                  <span key={i} className="inline-block h-3 w-2 rounded-sm bg-felt-700" />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex-1 rounded-2xl bg-felt-800/40 p-3">
        <p className="text-ivory-200/50 mb-2 text-xs uppercase tracking-widest">River</p>
        <div className="flex flex-wrap gap-1">
          {state.players.flatMap((p) => p.discards.map((k, i) => <Tile key={`${p.seat}-${i}`} kind={k} />))}
        </div>
      </section>

      {state.phase === 'claim' && legal.claims && (
        <div className="flex flex-wrap gap-2">
          {legal.claims.map((c, i) => (
            <button key={i} className="rounded-full bg-brass-400 px-4 py-2 font-medium text-ink-900" onClick={() => act({ type: 'claim', seat: ME, claim: c })}>
              {c.type === 'win' ? 'Mahjong!' : c.type[0]!.toUpperCase() + c.type.slice(1)}
            </button>
          ))}
          <button className="rounded-full bg-ivory-50/10 px-4 py-2" onClick={() => act({ type: 'pass', seat: ME })}>
            Pass
          </button>
        </div>
      )}

      {state.phase === 'turn' && state.turn === ME && (
        <div className="flex flex-wrap gap-2">
          {legal.win && (
            <button className="rounded-full bg-brass-400 px-4 py-2 font-medium text-ink-900" onClick={() => act({ type: 'declareWin', seat: ME })}>
              Mahjong!
            </button>
          )}
          {legal.kong?.map((k) => (
            <button key={k} className="rounded-full bg-ivory-50/10 px-4 py-2" onClick={() => act({ type: 'declareKong', seat: ME, tile: k })}>
              Kong {k}
            </button>
          ))}
          {selected && (
            <button className="rounded-full bg-ivory-50 px-4 py-2 font-medium text-ink-900" onClick={() => act({ type: 'discard', seat: ME, tile: selected })}>
              Discard
            </button>
          )}
        </div>
      )}

      {state.phase === 'preplay' && legal.exchange && (
        <ExchangePicker hand={me.concealed} count={legal.exchange.count} onDone={(tiles) => act({ type: 'exchange', seat: ME, tiles })} />
      )}

      {state.phase === 'finished' && (
        <div className="rounded-2xl bg-ivory-50 p-4 text-ink-900">
          {state.result?.type === 'win' ? (
            <p>
              Seat {state.players[state.result.winner].seatWind} wins with <strong>{state.result.patternId}</strong>
              {state.result.selfDrawn ? ' (self-drawn)' : ''}.
            </p>
          ) : (
            <p>Wall exhausted. No winner.</p>
          )}
          <button
            className="mt-3 rounded-full bg-ink-900 px-4 py-2 text-ivory-50"
            onClick={() => {
              const n = nextHand(state, ruleset);
              setState(n ? startHand(ruleset, { seed, ...n }) : startHand(ruleset, { seed: `${seed}-again`, progress: initialProgress, dealer: 0 }));
            }}
          >
            Next hand
          </button>
        </div>
      )}

      <section>
        <div className="mb-1 flex gap-1">{me.melds.map((m, i) => m.tiles.map((k, j) => <Tile key={`${i}-${j}`} kind={k} />))}</div>
        <div className="flex flex-wrap gap-1">
          {me.concealed.map((k, i) => (
            <Tile key={`${k}-${i}`} kind={k} selectable={state.phase === 'turn' && state.turn === ME} selected={selected === k} onClick={() => setSelected(selected === k ? null : k)} />
          ))}
        </div>
        {me.bonus.length > 0 && <div className="mt-1 flex gap-1">{me.bonus.map((k, i) => <Tile key={i} kind={k} />)}</div>}
      </section>
    </div>
  );
}

function ExchangePicker({ hand, count, onDone }: { hand: readonly TileKind[]; count: number; onDone: (tiles: TileKind[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <div className="rounded-2xl bg-ivory-50 p-3 text-ink-900">
      <p className="mb-2 text-sm">Goulash: choose {count} tiles to pass.</p>
      <div className="flex flex-wrap gap-1">
        {hand.map((k, i) => (
          <Tile key={i} kind={k} selectable selected={picked.includes(i)} onClick={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < count ? [...p, i] : p))} />
        ))}
      </div>
      <button className="mt-2 rounded-full bg-ink-900 px-4 py-2 text-ivory-50 disabled:opacity-40" disabled={picked.length !== count} onClick={() => onDone(picked.map((i) => hand[i]!))}>
        Pass tiles
      </button>
    </div>
  );
}
