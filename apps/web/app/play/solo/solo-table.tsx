'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  SEATS,
  acrossFrom,
  initialProgress,
  karachi,
  leftOf,
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
import { Coach, CoachLine } from '@/components/coach';
import { River } from '@/components/river';
import { riverOrder } from '@/lib/river';
import { tableFlow } from '@/lib/table-flow';
import { analyseFor, coachFor, stageFor, type CoachState } from '@/lib/coach';

/** Custom properties are not part of React's CSSProperties, so name the one we set. */
type HandStyle = React.CSSProperties & { '--hand-n'?: number };

const ME: Seat = 0;
const ruleset = karachi;
/** Local flavour only — the engine knows seats, not names. */
const NAMES: Record<Seat, string> = { 0: 'You', 1: 'Bilal', 2: 'Sana', 3: 'Ayesha' };
/** Every kind is in the wall four times, which is what makes "already dead" answerable. */
const COPIES = 4;

/** What the coach has watched this player do, which is how it decides how much to say. */
interface Progress {
  readonly handsFinished: number;
  readonly wins: number;
  readonly discardsMade: number;
}
const NO_PROGRESS: Progress = { handsFinished: 0, wins: 0, discardsMade: 0 };

function botStep(state: HandState): HandState {
  let s = state;
  for (const seat of SEATS) {
    if (seat === ME || s.phase === 'finished') continue;
    const a = simpleBot(viewFor(s, ruleset, seat));
    if (a) s = reduce(s, a, ruleset);
  }
  return s;
}

export function SoloTable({ seed }: { seed: string }) {
  // The seed is dealt by the server (see page.tsx) so the first client render
  // matches the HTML it hydrates without a re-seed after mount.
  const [state, setState] = useState<HandState>(() => startHand(ruleset, { seed, progress: initialProgress, dealer: 0 }));
  const [selected, setSelected] = useState<TileKind | null>(null);
  const [tutorOn, setTutorOn] = useState(true);
  const [progress, setProgress] = useState<Progress>(NO_PROGRESS);
  const me = state.players[ME];

  const view = useMemo(() => viewFor(state, ruleset, ME), [state]);
  const legal = view.legal;
  const flow = tableFlow(state, legal, ME);
  const myMove = flow === 'mine';

  // The analysis is the expensive part (a bounded search per pattern), so it is
  // memoised on the state it was taken from and handed to the coach.
  const analysis = useMemo(() => analyseFor(view, ruleset), [view]);
  const stage = stageFor(progress);
  const coach: CoachState = useMemo(() => coachFor({ view, ruleset, analysis, stage, names: NAMES }), [view, analysis, stage]);

  // Let bots act whenever it is not our move, paced so the table reads as a conversation.
  useEffect(() => {
    if (flow === 'over' || flow === 'mine') return;
    // Nothing claimable for us, but the engine still wants our response before
    // the window can close; it is given without the bots' pause.
    const autoPass = (s: HandState) => (s.phase === 'claim' && s.claims[ME] === undefined ? reduce(s, { type: 'pass', seat: ME }, ruleset) : s);
    const t = flow === 'auto-pass' ? setTimeout(() => setState(autoPass), 0) : setTimeout(() => setState((s) => botStep(s)), 450);
    return () => clearTimeout(t);
  }, [state, flow]);

  const act = (a: Action) => {
    setSelected(null);
    if (a.type === 'discard') setProgress((p) => ({ ...p, discardsMade: p.discardsMade + 1 }));
    setState((s) => reduce(s, a, ruleset));
  };

  const spec = ruleset.handSpec(state.progress);
  const myTurn = state.phase === 'turn' && state.turn === ME;
  // The tutor chip silences the advice; it never silences the result sheet, which
  // is reporting what happened rather than coaching.
  const advice = tutorOn ? coach : null;
  const suggested = advice && advice.action.kind === 'discard' ? advice.action.tile : null;
  const hasActions = !!legal.win || !!legal.kong?.length || (myTurn && (selected !== null || suggested !== null));
  // stable sort means duplicates of a newly-drawn kind land last, so this always resolves the tile just drawn
  const drawnIndex = state.drawn ? me.concealed.lastIndexOf(state.drawn) : -1;

  const left = state.players[leftOf(ME)];
  const across = state.players[acrossFrom(ME)];
  const right = state.players[rightOf(ME)];

  const riverTiles = useMemo(() => riverOrder(state), [state]);
  const selectedOut = selected ? riverTiles.filter((t) => t.kind === selected).length : 0;

  const header = (
    <>
      <h1 className="font-display truncate text-xl">{spec.label}</h1>
      <div className="flex flex-none items-center gap-2">
        <span className="text-ivory-200/60 text-sm whitespace-nowrap">Wall {state.wall.live.length}</span>
        <button type="button" className={`chip${tutorOn ? ' chip-gold' : ''}`} onClick={() => setTutorOn((v) => !v)}>
          Tutor {tutorOn ? 'on' : 'off'}
        </button>
      </div>
    </>
  );

  const riverHeader = (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <p className="label">River</p>
      <p className="label whitespace-nowrap">{selected ? `${selectedOut} of ${COPIES} out` : `${riverTiles.length} discarded`}</p>
    </div>
  );
  const river = <River tiles={riverTiles} claimable={state.phase === 'claim'} highlight={selected} />;

  const bubble = advice ? <Coach plan={advice.plan} say={advice.say} /> : null;

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
      {myTurn &&
        (selected ? (
          <button className="btn btn-primary" onClick={() => act({ type: 'discard', seat: ME, tile: selected })}>
            Discard {tileName(selected)}
          </button>
        ) : suggested ? (
          <button className="btn btn-primary" onClick={() => act({ type: 'discard', seat: ME, tile: suggested })}>
            Discard {tileName(suggested)}
          </button>
        ) : null)}
    </>
  );

  const handTiles = (size: 'md' | 'lg') =>
    me.concealed.map((k, i) => {
      const isDrawn = i === drawnIndex && myTurn;
      return (
        <Tile
          key={`${k}-${i}`}
          kind={k}
          size={size}
          selectable={myTurn}
          selected={selected === k}
          fresh={isDrawn}
          coached={!!advice && advice.highlight.includes(k) && selected !== k}
          className={isDrawn ? 'drawn' : undefined}
          onClick={() => setSelected(selected === k ? null : k)}
        />
      );
    });

  const myMelds = (
    <div className="meld-row">
      {me.melds.map((m, i) => (
        <span key={i} className="meld">
          {m.tiles.map((k, j) => (
            <Tile key={j} kind={k} size="xs" />
          ))}
        </span>
      ))}
    </div>
  );

  const bonus = (
    <div className="meld-row justify-center">
      {me.bonus.map((k, i) => (
        <Tile key={i} kind={k} size="xs" />
      ))}
    </div>
  );

  // The rail and the landscape tray size their tiles from how many there
  // actually are, which CSS can only know if we tell it.
  const handStyle: HandStyle = { '--hand-n': Math.max(me.concealed.length, 1) };

  return (
    <>
      {/* Phone, either way up: hand at the bottom, river taking whatever is left over. */}
      <div className="table-stage">
        <header className="flex flex-none items-baseline justify-between gap-2">{header}</header>

        <div className="seat-strip grid flex-none grid-cols-3 gap-2">
          {[left, across, right].map((p) => (
            <SeatPill key={p.seat} wind={p.seatWind} name={NAMES[p.seat]} concealedCount={p.concealed.length} melds={p.melds} isTurn={state.turn === p.seat} />
          ))}
        </div>

        <section className="felt flex min-h-0 flex-1 flex-col rounded-2xl p-2">
          {riverHeader}
          {river}
        </section>

        {bubble}

        {hasActions && <div className="action-row flex-none">{actions}</div>}

        <section className="hand-dock flex-none">
          {me.melds.length > 0 && myMelds}
          <div className="hand-tray" style={handStyle}>
            {handTiles('md')}
          </div>
          {me.bonus.length > 0 && bonus}
        </section>
      </div>

      {/* Landscape tablet: the full square table. */}
      <div className="table-grid mx-auto h-dvh max-w-5xl grid-cols-[120px_1fr_120px] grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3 overflow-hidden px-6 pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]">
        <div className="col-span-3 flex items-center justify-between gap-3">{header}</div>

        <SeatPill wind={left.seatWind} name={NAMES[left.seat]} concealedCount={left.concealed.length} melds={left.melds} isTurn={state.turn === left.seat} orientation="column" />

        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex justify-center">
            <SeatPill wind={across.seatWind} name={NAMES[across.seat]} concealedCount={across.concealed.length} melds={across.melds} isTurn={state.turn === across.seat} />
          </div>
          <section className="felt flex min-h-0 flex-1 flex-col rounded-2xl p-4">
            {riverHeader}
            {river}
          </section>
        </div>

        <SeatPill wind={right.seatWind} name={NAMES[right.seat]} concealedCount={right.concealed.length} melds={right.melds} isTurn={state.turn === right.seat} orientation="column" />

        <div className="col-span-3">{bubble}</div>

        <div className="hand-dock col-span-3">
          {me.melds.length > 0 && myMelds}
          <div className="hand-rail" style={handStyle}>
            {handTiles('lg')}
          </div>
          {me.bonus.length > 0 && bonus}
          {hasActions && <div className="action-row">{actions}</div>}
        </div>
      </div>

      {flow === 'mine' && legal.claims && state.lastDiscard && (
        <ClaimSheet
          discardKind={state.lastDiscard.kind}
          discarderName={NAMES[state.lastDiscard.from]}
          coach={coach}
          options={legal.claims}
          onClaim={(claim) => act({ type: 'claim', seat: ME, claim })}
          onPass={() => act({ type: 'pass', seat: ME })}
        />
      )}

      {state.phase === 'preplay' && legal.exchange && (
        <ExchangeSheet hand={me.concealed} count={legal.exchange.count} coach={coach} onDone={(tiles) => act({ type: 'exchange', seat: ME, tiles })} />
      )}

      {state.phase === 'finished' && (
        <ResultSheet
          coach={coach}
          onNext={() => {
            setProgress((p) => ({ ...p, handsFinished: p.handsFinished + 1, wins: p.wins + (state.result?.type === 'win' && state.result.winner === ME ? 1 : 0) }));
            const n = nextHand(state, ruleset);
            setState(n ? startHand(ruleset, { seed, ...n }) : startHand(ruleset, { seed: `${seed}-again`, progress: initialProgress, dealer: 0 }));
          }}
        />
      )}
    </>
  );
}

function ExchangeSheet({ hand, count, coach, onDone }: { hand: readonly TileKind[]; count: number; coach: CoachState; onDone: (tiles: TileKind[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  // The coach has already worked out which tiles no candidate hand is using; the
  // player can overrule it, but the sheet opens on its answer rather than empty.
  const suggested = coach.action.kind === 'exchange' ? coach.action.tiles : [];
  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        <h2 className="font-display mb-1 text-xl">Goulash exchange</h2>
        <p className="text-ivory-200/70 mb-3 text-sm">
          Choose {count} tiles to pass. <CoachLine say={coach.say} />
        </p>
        <div className="flex flex-wrap justify-center gap-1">
          {hand.map((k, i) => (
            <Tile
              key={i}
              kind={k}
              size="md"
              selectable
              selected={picked.includes(i)}
              coached={picked.length === 0 && suggested.includes(k)}
              onClick={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < count ? [...p, i] : p))}
            />
          ))}
        </div>
        <button className="btn btn-primary btn-block mt-3" disabled={picked.length !== count} onClick={() => onDone(picked.map((i) => hand[i]!))}>
          Pass tiles
        </button>
      </div>
    </>
  );
}

/**
 * The debrief. A beginner learns more here than anywhere else in the hand, so it
 * shows the winning tiles laid out and names the hand the way players name it —
 * never the engine's pattern id.
 */
function ResultSheet({ coach, onNext }: { coach: CoachState; onNext: () => void }) {
  const outcome = coach.outcome;
  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        <h2 className="font-display mb-2 text-xl">{outcome?.type === 'win' ? (outcome.winnerIsMe ? 'Mahjong!' : `${outcome.winnerName} wins`) : 'Washed out'}</h2>
        {outcome?.tiles && outcome.tiles.length > 0 && (
          <div className="mb-3 flex flex-wrap justify-center gap-1">
            {outcome.tiles.map((k, i) => (
              <Tile key={i} kind={k} size="xs" />
            ))}
          </div>
        )}
        <p className="text-ivory-100/90 text-sm">
          <CoachLine say={coach.say} />
        </p>
        <button className="btn btn-primary btn-block mt-4" onClick={onNext}>
          Next hand
        </button>
      </div>
    </>
  );
}
