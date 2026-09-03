'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  SEATS,
  acrossFrom,
  initialProgress,
  karachi,
  leftOf,
  legalActions,
  nextHand,
  reduce,
  rightOf,
  simpleBot,
  startHand,
  tileName,
  viewFor,
  type Action,
  type HandState,
  type Seat,
  type TileKind,
} from '@society/engine';
import { Tile } from '@/components/tile';
import { SeatPill } from '@/components/seat-pill';
import { ClaimSheet } from '@/components/claim-sheet';
import { Coach } from '@/components/coach';
import { suggestDiscard } from '@/lib/tutor';

const ME: Seat = 0;
const ruleset = karachi;
/** Local flavour only — the engine knows seats, not names. */
const NAMES: Record<Seat, string> = { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' };

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
  // A fixed seed for the first render so server and client agree (Date.now() would
  // mismatch during hydration); re-seeded for real randomness right after mount.
  const [seed, setSeed] = useState('solo-ssr');
  const [state, setState] = useState<HandState>(() => startHand(ruleset, { seed: 'solo-ssr', progress: initialProgress, dealer: 0 }));
  const [selected, setSelected] = useState<TileKind | null>(null);
  const [tutorOn, setTutorOn] = useState(true);
  const me = state.players[ME];
  const legal = useMemo(() => legalActions(state, ruleset, ME), [state]);
  const myMove = legal.discard || legal.claims || legal.exchange || legal.win;

  useEffect(() => {
    const fresh = `solo-${Date.now()}`;
    setSeed(fresh);
    setState(startHand(ruleset, { seed: fresh, progress: initialProgress, dealer: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const tip = tutorOn && state.phase === 'turn' && state.turn === ME ? suggestDiscard(me.concealed) : null;
  const hasActions = !!legal.win || !!(legal.kong && legal.kong.length > 0) || (state.phase === 'turn' && state.turn === ME);
  // stable sort means duplicates of a newly-drawn kind land last, so this always resolves the tile just drawn
  const drawnIndex = state.drawn ? me.concealed.lastIndexOf(state.drawn) : -1;

  const left = state.players[leftOf(ME)];
  const across = state.players[acrossFrom(ME)];
  const right = state.players[rightOf(ME)];

  const header = (
    <>
      <h1 className="font-display text-xl">{spec.label}</h1>
      <div className="flex items-center gap-2">
        <span className="text-ivory-200/60 text-sm whitespace-nowrap">Wall {state.wall.live.length}</span>
        <button type="button" className={`chip${tutorOn ? ' chip-gold' : ''}`} onClick={() => setTutorOn((v) => !v)}>
          Tutor {tutorOn ? 'on' : 'off'}
        </button>
      </div>
    </>
  );

  const river = (
    <div className="river">
      {state.players.flatMap((p) =>
        p.discards.map((k, i) => (
          <Tile key={`${p.seat}-${i}`} kind={k} size="sm" claimable={state.phase === 'claim' && state.lastDiscard?.from === p.seat && i === p.discards.length - 1} />
        )),
      )}
    </div>
  );

  const actions = (
    <>
      {legal.win && (
        <button className="btn btn-gold" onClick={() => act({ type: 'declareWin', seat: ME })}>
          Mahjong!
        </button>
      )}
      {legal.kong?.map((k) => (
        <button key={k} className="btn btn-ghost" onClick={() => act({ type: 'declareKong', seat: ME, tile: k })}>
          Kong {tileName(k)}
        </button>
      ))}
      {state.phase === 'turn' &&
        state.turn === ME &&
        (selected ? (
          <button className="btn btn-primary" onClick={() => act({ type: 'discard', seat: ME, tile: selected })}>
            Discard {tileName(selected)}
          </button>
        ) : tip ? (
          <button className="btn btn-primary" onClick={() => act({ type: 'discard', seat: ME, tile: tip.tile })}>
            Discard {tileName(tip.tile)}
          </button>
        ) : null)}
    </>
  );

  const handTiles = (size: 'md' | 'lg') =>
    me.concealed.map((k, i) => {
      const isDrawn = i === drawnIndex && state.turn === ME && state.phase === 'turn';
      return (
        <Tile
          key={`${k}-${i}`}
          kind={k}
          size={size}
          selectable={state.phase === 'turn' && state.turn === ME}
          selected={selected === k}
          fresh={isDrawn}
          coached={!!tip && tip.tile === k && selected !== k}
          className={isDrawn ? 'drawn' : undefined}
          onClick={() => setSelected(selected === k ? null : k)}
        />
      );
    });

  const myMelds = <div className="meld">{me.melds.flatMap((m, i) => m.tiles.map((k, j) => <Tile key={`${i}-${j}`} kind={k} size="xs" />))}</div>;

  return (
    <>
      {/* Portrait phone: hand rail bottom, compact river centre, opponents as slim strips. */}
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 px-4 pt-11 pb-[max(1rem,env(safe-area-inset-bottom))] md:landscape:hidden">
        <header className="flex items-baseline justify-between">{header}</header>

        <div className="flex flex-wrap justify-center gap-2">
          {[left, across, right].map((p) => (
            <SeatPill key={p.seat} wind={p.seatWind} name={NAMES[p.seat]} concealedCount={p.concealed.length} melds={p.melds} isTurn={state.turn === p.seat} />
          ))}
        </div>

        <section className="felt flex-1 rounded-2xl p-3">
          <p className="label mb-2 text-center">River</p>
          {river}
        </section>

        {tip && <Coach>{tip.message}</Coach>}

        {hasActions && <div className="flex flex-wrap gap-2">{actions}</div>}

        <section>
          {me.melds.length > 0 && <div className="mb-1">{myMelds}</div>}
          <div className="hand-rail">{handTiles('md')}</div>
          {me.bonus.length > 0 && (
            <div className="mt-1 flex gap-1">
              {me.bonus.map((k, i) => (
                <Tile key={i} kind={k} size="xs" />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Landscape tablet: the full square table. */}
      <div className="mx-auto hidden h-dvh max-w-5xl grid-cols-[120px_1fr_120px] grid-rows-[auto_1fr_auto] gap-3 p-6 box-border md:landscape:grid">
        <div className="col-span-3 flex items-center justify-between">{header}</div>

        <SeatPill wind={left.seatWind} name={NAMES[left.seat]} concealedCount={left.concealed.length} melds={left.melds} isTurn={state.turn === left.seat} orientation="column" meldTileSize="sm" rotateMelds />

        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex justify-center">
            <SeatPill wind={across.seatWind} name={NAMES[across.seat]} concealedCount={across.concealed.length} melds={across.melds} isTurn={state.turn === across.seat} />
          </div>
          <section className="felt flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl p-4">
            <p className="label">River</p>
            {river}
          </section>
        </div>

        <SeatPill wind={right.seatWind} name={NAMES[right.seat]} concealedCount={right.concealed.length} melds={right.melds} isTurn={state.turn === right.seat} orientation="column" meldTileSize="sm" rotateMelds />

        {tip && (
          <div className="col-span-3">
            <Coach>{tip.message}</Coach>
          </div>
        )}

        <div className="col-span-3 flex items-end justify-between gap-6 pt-2">
          {myMelds}
          <div className="hand-rail flex-1 justify-center">{handTiles('lg')}</div>
          {hasActions && <div className="flex flex-none flex-wrap justify-end gap-2">{actions}</div>}
        </div>
      </div>

      {state.phase === 'claim' && legal.claims && state.lastDiscard && (
        <ClaimSheet
          discardKind={state.lastDiscard.kind}
          discarderName={NAMES[state.lastDiscard.from]}
          heldCount={me.concealed.filter((k) => k === state.lastDiscard!.kind).length}
          options={legal.claims}
          onClaim={(claim) => act({ type: 'claim', seat: ME, claim })}
          onPass={() => act({ type: 'pass', seat: ME })}
        />
      )}

      {state.phase === 'preplay' && legal.exchange && <ExchangeSheet hand={me.concealed} count={legal.exchange.count} onDone={(tiles) => act({ type: 'exchange', seat: ME, tiles })} />}

      {state.phase === 'finished' && (
        <ResultSheet
          state={state}
          onNext={() => {
            const n = nextHand(state, ruleset);
            setState(n ? startHand(ruleset, { seed, ...n }) : startHand(ruleset, { seed: `${seed}-again`, progress: initialProgress, dealer: 0 }));
          }}
        />
      )}
    </>
  );
}

function ExchangeSheet({ hand, count, onDone }: { hand: readonly TileKind[]; count: number; onDone: (tiles: TileKind[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        <h2 className="font-display mb-1 text-xl">Goulash exchange</h2>
        <p className="text-ivory-200/70 mb-3 text-sm">Choose {count} tiles to pass.</p>
        <div className="flex flex-wrap gap-1">
          {hand.map((k, i) => (
            <Tile key={i} kind={k} size="md" selectable selected={picked.includes(i)} onClick={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < count ? [...p, i] : p))} />
          ))}
        </div>
        <button className="btn btn-primary btn-block mt-3" disabled={picked.length !== count} onClick={() => onDone(picked.map((i) => hand[i]!))}>
          Pass tiles
        </button>
      </div>
    </>
  );
}

function ResultSheet({ state, onNext }: { state: HandState; onNext: () => void }) {
  const result = state.result;
  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        {result?.type === 'win' ? (
          <p className="text-lg">
            Seat {state.players[result.winner].seatWind} wins with <strong className="font-medium">{result.patternId}</strong>
            {result.selfDrawn ? ' (self-drawn)' : ''}.
          </p>
        ) : (
          <p className="text-lg">Wall exhausted. No winner.</p>
        )}
        <button className="btn btn-primary btn-block mt-4" onClick={onNext}>
          Next hand
        </button>
      </div>
    </>
  );
}
